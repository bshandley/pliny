# Assignee Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Merge `card_members` and `card_assignees` into a single `card_assignees` table with optional `user_id` for linked (real user) vs unlinked (free-text) assignments. Drop `board_assignees`. Unify checklist item assignees too.

**Architecture:** Single `card_assignees` table with UUID PK, optional `user_id` FK, optional `display_name`. Linked assignees derive display name via JOIN to users table. Unlinked use `display_name` directly. Partial unique constraints prevent duplicates. Card update API accepts `{ user_id?, display_name? }[]` with server-side auto-linking when a display_name matches a board member.

**Tech Stack:** PostgreSQL 16, Express + TypeScript (server), React + TypeScript (client), Socket.io

**Design doc:** `docs/plans/2026-02-25-assignee-unification-design.md`

---

### Task 1: Migration 017 — New card_assignees Schema

**Files:**
- Create: `server/src/migrations/017-unify-assignees.sql`
- Modify: `server/src/migrations/schema.sql`

**Step 1: Write the migration**

Create `server/src/migrations/017-unify-assignees.sql`:

```sql
-- 1. Rename old card_assignees
ALTER TABLE card_assignees RENAME TO card_assignees_old;

-- 2. Create new card_assignees
CREATE TABLE card_assignees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT card_assignees_must_have_identity CHECK (user_id IS NOT NULL OR display_name IS NOT NULL)
);

CREATE UNIQUE INDEX idx_card_assignees_linked ON card_assignees (card_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_card_assignees_unlinked ON card_assignees (card_id, display_name) WHERE user_id IS NULL;
CREATE INDEX idx_card_assignees_card_id ON card_assignees (card_id);
CREATE INDEX idx_card_assignees_user_id ON card_assignees (user_id) WHERE user_id IS NOT NULL;

-- 3. Migrate card_members → linked assignees
INSERT INTO card_assignees (card_id, user_id, created_at)
SELECT cm.card_id, cm.user_id, cm.created_at
FROM card_members cm
ON CONFLICT DO NOTHING;

-- 4. Migrate card_assignees_old → auto-link where possible, else unlinked
-- 4a. Auto-link: assignee_name matches a user's username, and no linked row exists yet
INSERT INTO card_assignees (card_id, user_id, created_at)
SELECT cao.card_id, u.id, cao.added_at
FROM card_assignees_old cao
JOIN users u ON LOWER(u.username) = LOWER(cao.assignee_name)
ON CONFLICT DO NOTHING;

-- 4b. Unlinked: remaining assignees that weren't auto-linked
INSERT INTO card_assignees (card_id, display_name, created_at)
SELECT cao.card_id, cao.assignee_name, cao.added_at
FROM card_assignees_old cao
WHERE NOT EXISTS (
  SELECT 1 FROM card_assignees ca
  WHERE ca.card_id = cao.card_id
  AND (
    -- Already linked via user match
    (ca.user_id IS NOT NULL AND ca.user_id IN (
      SELECT u.id FROM users u WHERE LOWER(u.username) = LOWER(cao.assignee_name)
    ))
    OR
    -- Already exists as same display_name
    (ca.display_name = cao.assignee_name)
  )
)
ON CONFLICT DO NOTHING;

-- 5. Add assignee_user_id to checklist items
ALTER TABLE card_checklist_items ADD COLUMN IF NOT EXISTS assignee_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- 5a. Auto-link existing checklist assignee_names to users
UPDATE card_checklist_items ci
SET assignee_user_id = u.id
FROM users u
WHERE LOWER(ci.assignee_name) = LOWER(u.username)
AND ci.assignee_name IS NOT NULL
AND ci.assignee_user_id IS NULL;

-- 6. Drop old tables
DROP TABLE IF EXISTS card_assignees_old;
DROP TABLE IF EXISTS card_members;
DROP TABLE IF EXISTS board_assignees;
```

**Step 2: Update schema.sql**

In `server/src/migrations/schema.sql`:
- Replace the `board_assignees` table definition (lines 28-34) with nothing
- Replace the `card_assignees` table definition (lines 60-66) with the new schema
- Replace the `card_members` table definition (lines 129-138) with nothing
- Remove old indexes: `idx_board_assignees_board_id`, old `idx_card_assignees_card_id`, `idx_card_members_card_id`, `idx_card_members_user_id`
- Add new indexes
- Add `assignee_user_id` column to `card_checklist_items`

**Step 3: Verify migration runs**

```bash
cd server && npx ts-node -e "
const pool = require('./src/db').default;
const fs = require('fs');
const sql = fs.readFileSync('./src/migrations/017-unify-assignees.sql', 'utf8');
pool.query(sql).then(() => { console.log('OK'); pool.end(); }).catch(e => { console.error(e); pool.end(); });
"
```

**Step 4: Commit**

```bash
git add server/src/migrations/017-unify-assignees.sql server/src/migrations/schema.sql
git commit -m "feat: migration 017 — unified card_assignees schema"
```

---

### Task 2: Server — Update Types and Delete Old Routes

**Files:**
- Delete: `server/src/routes/cardMembers.ts`
- Delete: `server/src/routes/assignees.ts`
- Modify: `server/src/index.ts` (lines 16, 69, 178-181)
- Modify: `server/src/types.ts` (line 43)

**Step 1: Delete old route files**

```bash
rm server/src/routes/cardMembers.ts server/src/routes/assignees.ts
```

**Step 2: Update server/src/index.ts**

- Remove import of `cardMembersRoutes` (line 16)
- Remove import of `assigneesRoutes` (find it near other route imports)
- Remove `app.use('/api', cardMembersRoutes)` (line 69)
- Remove `app.use('/api', assigneesRoutes)` (find it near other route mounts)
- Update the due-date reminder query (lines 178-181) from:
  ```typescript
  const members = await pool.query(
    'SELECT user_id FROM card_members WHERE card_id = $1',
    [card.id]
  );
  ```
  to:
  ```typescript
  const members = await pool.query(
    'SELECT user_id FROM card_assignees WHERE card_id = $1 AND user_id IS NOT NULL',
    [card.id]
  );
  ```

**Step 3: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

Fix any remaining references to deleted routes.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: remove cardMembers and assignees routes, update index.ts"
```

---

### Task 3: Server — Update notificationHelper.ts

**Files:**
- Modify: `server/src/services/notificationHelper.ts` (lines 200-204)

**Step 1: Update query**

Change the card members query in `notifyCardMembers()` (line 201-203) from:
```typescript
const membersResult = await pool.query(
  'SELECT user_id FROM card_members WHERE card_id = $1',
  [cardId]
);
```
to:
```typescript
const membersResult = await pool.query(
  'SELECT user_id FROM card_assignees WHERE card_id = $1 AND user_id IS NOT NULL',
  [cardId]
);
```

**Step 2: Commit**

```bash
git add server/src/services/notificationHelper.ts
git commit -m "feat: notificationHelper uses unified card_assignees table"
```

---

### Task 4: Server — Update boards.ts Board Fetch

**Files:**
- Modify: `server/src/routes/boards.ts` (lines 77-84, 138-155, 203-206)

**Step 1: Replace the two separate queries with one unified query**

Remove the old `card_assignees` query (lines 77-84) and `card_members` query (lines 138-146). Replace with a single query:

```typescript
const assigneesResult = await pool.query(
  `SELECT ca.card_id, ca.id, ca.user_id, ca.display_name, u.username
   FROM card_assignees ca
   LEFT JOIN users u ON ca.user_id = u.id
   INNER JOIN cards c ON ca.card_id = c.id
   INNER JOIN columns col ON c.column_id = col.id
   WHERE col.board_id = $1`,
  [id]
);
```

**Step 2: Replace the two grouping blocks with one**

Remove the `assigneesByCard` grouping (that maps to `string[]`) and the `membersByCard` grouping (that maps to `{id, username}[]`). Replace with:

```typescript
const assigneesByCard: Record<string, { id: string; user_id: string | null; username: string | null; display_name: string | null }[]> = {};
assigneesResult.rows.forEach((row: any) => {
  if (!assigneesByCard[row.card_id]) {
    assigneesByCard[row.card_id] = [];
  }
  assigneesByCard[row.card_id].push({
    id: row.id,
    user_id: row.user_id,
    username: row.username,
    display_name: row.display_name,
  });
});
```

**Step 3: Update card object construction**

In the cards mapping, replace `assignees: assigneesByCard[card.id] || []` and `members: membersByCard[card.id] || []` with:

```typescript
assignees: assigneesByCard[card.id] || [],
```

Remove the `members` property entirely.

**Step 4: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add server/src/routes/boards.ts
git commit -m "feat: board fetch returns unified assignees array"
```

---

### Task 5: Server — Update cards.ts Card Update

**Files:**
- Modify: `server/src/routes/cards.ts` (lines 66-71, 130-139, 155-158, 219-227)

**Step 1: Update assignees destructuring and old-state fetch**

The card update route destructures `assignees` from `req.body` (line 52). Keep the name but change the expected shape. Update the old-assignees fetch (lines 66-71) from:
```typescript
let oldAssignees: string[] = [];
if (assignees !== undefined) {
  const oldAssigneesResult = await pool.query('SELECT assignee_name FROM card_assignees WHERE card_id = $1', [id]);
  oldAssignees = oldAssigneesResult.rows.map((r: any) => r.assignee_name);
}
```
to:
```typescript
let oldAssignees: { user_id: string | null; display_name: string | null }[] = [];
if (assignees !== undefined) {
  const oldAssigneesResult = await pool.query(
    'SELECT user_id, display_name FROM card_assignees WHERE card_id = $1', [id]
  );
  oldAssignees = oldAssigneesResult.rows;
}
```

**Step 2: Rewrite the assignees update block**

Replace lines 130-139 with:

```typescript
// Update assignees if provided
if (assignees !== undefined) {
  await pool.query('DELETE FROM card_assignees WHERE card_id = $1', [id]);
  if (Array.isArray(assignees) && assignees.length > 0) {
    // Get board members for auto-linking
    const boardResult = await pool.query(
      'SELECT col.board_id FROM columns col JOIN cards c ON c.column_id = col.id WHERE c.id = $1',
      [id]
    );
    const thisBoardId = boardResult.rows[0]?.board_id;
    let boardMemberMap: Record<string, string> = {}; // lowercase username -> user_id
    if (thisBoardId) {
      const bmResult = await pool.query(
        'SELECT u.id, u.username FROM board_members bm JOIN users u ON bm.user_id = u.id WHERE bm.board_id = $1',
        [thisBoardId]
      );
      bmResult.rows.forEach((r: any) => { boardMemberMap[r.username.toLowerCase()] = r.id; });
    }

    for (const assignee of assignees) {
      if (assignee.user_id) {
        // Linked assignee
        await pool.query(
          'INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, assignee.user_id]
        );
      } else if (assignee.display_name) {
        // Check if display_name matches a board member -> auto-link
        const matchedUserId = boardMemberMap[assignee.display_name.toLowerCase()];
        if (matchedUserId) {
          await pool.query(
            'INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, matchedUserId]
          );
        } else {
          await pool.query(
            'INSERT INTO card_assignees (card_id, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, assignee.display_name]
          );
        }
      }
    }
  }
}
```

**Step 3: Update the post-update fetch**

Replace the assignees fetch (lines 155-158) with:

```typescript
const assigneesResult = await pool.query(
  `SELECT ca.id, ca.user_id, ca.display_name, u.username
   FROM card_assignees ca
   LEFT JOIN users u ON ca.user_id = u.id
   WHERE ca.card_id = $1`,
  [id]
);
```

**Step 4: Update activity logging**

Replace the assignees_changed logging block (lines 219-227). Use a key function to compare old vs new:

```typescript
if (assignees !== undefined) {
  const keyFn = (a: any) => a.user_id || a.display_name || '';
  const oldKeys = new Set(oldAssignees.map(keyFn));
  const newAssigneeRows = assigneesResult.rows;
  const newKeys = new Set(newAssigneeRows.map(keyFn));
  const nameFn = (a: any) => a.username || a.display_name || '';
  const addedNames = newAssigneeRows.filter((a: any) => !oldKeys.has(keyFn(a))).map(nameFn);
  const removedNames = oldAssignees.filter(a => !newKeys.has(keyFn(a))).map(a => a.display_name || '');
  // Resolve removed linked users' names
  if (addedNames.length > 0 || removedNames.length > 0) {
    logActivity(id, req.user!.id, 'assignees_changed', { added: addedNames, removed: removedNames });
  }
}
```

Also handle notifications for newly added linked assignees — same pattern as the old `cardMembers.ts` PUT handler. After the logging block:

```typescript
if (assignees !== undefined) {
  const oldLinkedIds = new Set(oldAssignees.filter(a => a.user_id).map(a => a.user_id));
  const newLinkedIds = assigneesResult.rows.filter((a: any) => a.user_id).map((a: any) => a.user_id);
  const addedLinkedIds = newLinkedIds.filter((uid: string) => !oldLinkedIds.has(uid));
  if (addedLinkedIds.length > 0) {
    const io = req.app.get('io');
    const userSockets: Map<string, string[]> = req.app.get('userSockets');
    const cardInfo = await pool.query(
      `SELECT c.title, col.board_id, b.name as board_name
       FROM cards c JOIN columns col ON c.column_id = col.id
       JOIN boards b ON col.board_id = b.id WHERE c.id = $1`, [id]
    );
    if (cardInfo.rows.length > 0) {
      const { title: cardTitle, board_id: bId, board_name } = cardInfo.rows[0];
      for (const userId of addedLinkedIds) {
        await createNotification({
          userId, type: 'assigned_card', cardId: id, boardId: bId,
          actorId: req.user!.id, actorUsername: req.user!.username,
          detail: { card_title: cardTitle, board_name }, io, userSockets,
        });
      }
    }
  }
}
```

Make sure `createNotification` is imported at the top of cards.ts.

**Step 5: Update the response object**

The returned card object should include `assignees` as the unified array instead of flat strings:

```typescript
res.json({
  ...result.rows[0],
  assignees: assigneesResult.rows,
  labels: labelsResult.rows,
});
```

**Step 6: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

**Step 7: Commit**

```bash
git add server/src/routes/cards.ts
git commit -m "feat: card update uses unified assignees model"
```

---

### Task 6: Server — Update analytics.ts

**Files:**
- Modify: `server/src/routes/analytics.ts` (lines 49-59)

**Step 1: Update the cards-by-assignee query**

Replace the existing query with:

```sql
SELECT
  COALESCE(u.username, ca.display_name, 'Unassigned') as assignee,
  COUNT(DISTINCT c.id)::int as total,
  COUNT(DISTINCT c.id) FILTER (WHERE c.column_id = $2)::int as completed
FROM cards c
INNER JOIN columns col ON c.column_id = col.id
LEFT JOIN card_assignees ca ON ca.card_id = c.id
LEFT JOIN users u ON ca.user_id = u.id
WHERE col.board_id = $1 AND c.archived = false
GROUP BY COALESCE(u.username, ca.display_name)
ORDER BY total DESC
```

Note: the `$2` parameter is the rightmost column ID for "completed" counting. Check the existing code for how this parameter is determined and keep the same pattern.

**Step 2: Commit**

```bash
git add server/src/routes/analytics.ts
git commit -m "feat: analytics uses unified assignees"
```

---

### Task 7: Server — Update csv.ts

**Files:**
- Modify: `server/src/routes/csv.ts`

**Step 1: Update CSV export**

Find the export section that queries `card_assignees` (lines 53-67). Replace with:

```typescript
const assigneesResult = await pool.query(
  `SELECT ca.card_id, COALESCE(u.username, ca.display_name) as name
   FROM card_assignees ca
   LEFT JOIN users u ON ca.user_id = u.id
   INNER JOIN cards c ON ca.card_id = c.id
   INNER JOIN columns col ON c.column_id = col.id
   WHERE col.board_id = $1 AND c.archived = false`,
  [boardId]
);
```

The grouping logic stays the same but uses `.name` instead of `.assignee_name`.

**Step 2: Update CSV import**

Find the import section (lines 298-434). Remove all references to `board_assignees` (the `existingAssignees` query and `assigneeSet`, and the `INSERT INTO board_assignees` auto-creation). Replace the card assignee insertion block with:

```typescript
// For each assignee name, try to auto-link to a board member
for (const name of assigneeNames) {
  const trimmed = name.trim();
  if (!trimmed) continue;
  // Check if name matches a board member
  const memberMatch = await pool.query(
    `SELECT u.id FROM board_members bm
     JOIN users u ON bm.user_id = u.id
     WHERE bm.board_id = $1 AND LOWER(u.username) = LOWER($2)`,
    [boardId, trimmed]
  );
  if (memberMatch.rows.length > 0) {
    await pool.query(
      'INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [cardId, memberMatch.rows[0].id]
    );
  } else {
    await pool.query(
      'INSERT INTO card_assignees (card_id, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [cardId, trimmed]
    );
  }
}
```

**Step 3: Verify compile**

```bash
cd server && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add server/src/routes/csv.ts
git commit -m "feat: CSV import/export uses unified assignees"
```

---

### Task 8: Server — Update v1.ts Public API

**Files:**
- Modify: `server/src/routes/v1.ts`

**Step 1: Update card response format**

Find where card data is formatted in v1 responses. Ensure `assignees` returns the unified shape `{ id, user_id, username, display_name }` instead of flat strings and separate members.

**Step 2: Update checklist item creation**

The checklist item creation (line 560, 574-577) already accepts `assignee_name`. Add support for `assignee_user_id`:

```typescript
const { text, position, assignee_name, assignee_user_id, due_date, priority } = req.body;
```

Update the INSERT to include `assignee_user_id`:

```sql
INSERT INTO card_checklist_items (card_id, text, position, assignee_name, assignee_user_id, due_date, priority)
VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
```

**Step 3: Commit**

```bash
git add server/src/routes/v1.ts
git commit -m "feat: public API v1 uses unified assignees"
```

---

### Task 9: Client — Update Types

**Files:**
- Modify: `client/src/types.ts`

**Step 1: Replace CardMember and update Card interface**

Remove the `CardMember` interface (lines 66-69). Add a unified `CardAssignee`:

```typescript
export interface CardAssignee {
  id: string;
  user_id?: string | null;
  username?: string | null;
  display_name?: string | null;
}
```

Update the `Card` interface:
- Replace `assignees?: string[];` (line 117) with `assignees?: CardAssignee[];`
- Remove `members?: CardMember[];` (line 124)

Update `ChecklistItem` interface:
- Keep `assignee_name?: string | null;`
- Add `assignee_user_id?: string | null;`

**Step 2: Commit**

```bash
git add client/src/types.ts
git commit -m "feat: unified CardAssignee type, remove CardMember"
```

---

### Task 10: Client — Update api.ts

**Files:**
- Modify: `client/src/api.ts`

**Step 1: Remove board assignee CRUD methods**

Delete `getBoardAssignees`, `addBoardAssignee`, `renameBoardAssignee`, `deleteBoardAssignee` (lines 176-198).

**Step 2: Remove card member methods**

Delete `getCardMembers`, `setCardMembers` (lines 292-301).

**Step 3: Remove CardMember import**

Update the import at the top of the file to remove `CardMember`.

**Step 4: Verify compile**

```bash
cd client && npx tsc --noEmit
```

This will show errors in components that use the removed methods — that's expected; we fix those in subsequent tasks.

**Step 5: Commit**

```bash
git add client/src/api.ts
git commit -m "feat: remove board assignee CRUD and card member API methods"
```

---

### Task 11: Client — Delete BoardAssignees Component

**Files:**
- Delete: `client/src/components/BoardAssignees.tsx`
- Modify: `client/src/components/KanbanBoard.tsx`

**Step 1: Delete the component file**

```bash
rm client/src/components/BoardAssignees.tsx
```

**Step 2: Update KanbanBoard.tsx**

- Remove import of `BoardAssignees` (line 10)
- Remove `showAssignees` state (line 42): delete `const [showAssignees, setShowAssignees] = useState(false);`
- Remove `assignees` state (line 34): delete `const [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]);`
- Remove `loadAssignees` function (lines 195-202)
- Remove the call to `loadAssignees()` wherever it appears in `loadBoard()` or `useEffect`
- Remove `handleAddAssignee` function (lines 447-457)
- Remove the "Assignees" button in the kebab/settings menu (line 642)
- Remove the `{showAssignees && <BoardAssignees .../>}` render (lines 995-1000)
- Update all `<KanbanCard>` renders: remove the `assignees={assignees}` prop and `onAddAssignee={handleAddAssignee}` prop

**Step 3: Verify compile (will still have errors in KanbanCard — that's expected)**

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: remove BoardAssignees component and board assignee state from KanbanBoard"
```

---

### Task 12: Client — Rewrite KanbanCard Assignment Picker

**Files:**
- Modify: `client/src/components/KanbanCard.tsx`

This is the largest UI change. The card component needs to:
1. Use a single `assignees` array from the card data (unified `CardAssignee[]`)
2. Remove `editMembers` state — merge into unified `editAssignees`
3. Single autocomplete showing board members first, then free-text entry
4. Save via `onUpdate({ assignees: [...] })` with the new shape

**Step 1: Update the props interface**

In `KanbanCardProps` (lines 9-27):
- Remove `assignees?: { id: string; name: string }[];` (line 18) — no longer needed as a prop (was the board_assignees pool)
- Remove `onAddAssignee: (name: string) => Promise<boolean>;` (line 21) — no more board_assignees creation
- `boardMembers` stays (still needed to show the user picker)

**Step 2: Update state**

Replace the two separate state variables:
```typescript
// OLD:
const [editAssignees, setEditAssignees] = useState<string[]>(card.assignees || []);
const [editMembers, setEditMembers] = useState<string[]>(card.members?.map(m => m.id) || []);
```

With one unified state:
```typescript
const [editAssignees, setEditAssignees] = useState<CardAssignee[]>(card.assignees || []);
```

Import `CardAssignee` from types.

Update the `useEffect` sync (line 185-192):
```typescript
setEditAssignees(card.assignees || []);
```
Remove `setEditMembers(...)` and `card.members` from the dependency array.

**Step 3: Rewrite picker helper functions**

Replace `removeMember`, `selectMember`, `removeAssignee`, `selectAssignee` with unified functions:

```typescript
const addAssignee = (assignee: CardAssignee) => {
  // Prevent duplicates
  const isDup = editAssignees.some(a =>
    (assignee.user_id && a.user_id === assignee.user_id) ||
    (!assignee.user_id && a.display_name === assignee.display_name)
  );
  if (isDup) return;
  const updated = [...editAssignees, assignee];
  setEditAssignees(updated);
  onUpdate({ assignees: updated } as any);
  setShowAutocomplete(false);
  setAutocompleteFilter('');
  if (inputRef.current) inputRef.current.value = '';
};

const removeAssignee = (assignee: CardAssignee) => {
  const updated = editAssignees.filter(a =>
    assignee.user_id ? a.user_id !== assignee.user_id : a.display_name !== assignee.display_name
  );
  setEditAssignees(updated);
  onUpdate({ assignees: updated } as any);
};
```

**Step 4: Rewrite the autocomplete dropdown**

Replace the current two-group autocomplete (Members group + Assignees group) with a single list. The dropdown shows:

1. **Board members** not already assigned (filtered by typed text)
2. A **free-text option** if the typed text doesn't match any member and isn't empty

```tsx
{(() => {
  const filterLower = autocompleteFilter.toLowerCase();
  const assignedUserIds = new Set(editAssignees.filter(a => a.user_id).map(a => a.user_id));
  const assignedNames = new Set(editAssignees.filter(a => !a.user_id).map(a => a.display_name?.toLowerCase()));

  const filteredMembers = boardMembers.filter(m =>
    m.username.toLowerCase().includes(filterLower) &&
    !assignedUserIds.has(m.id)
  );

  const exactMemberMatch = boardMembers.some(m => m.username.toLowerCase() === filterLower);
  const exactAssigned = assignedNames.has(filterLower) || assignedUserIds.has(
    boardMembers.find(m => m.username.toLowerCase() === filterLower)?.id || ''
  );
  const showFreeText = autocompleteFilter.trim() && !exactMemberMatch && !exactAssigned;

  if (!showAutocomplete || (filteredMembers.length === 0 && !showFreeText)) return null;

  return (
    <div className="mention-autocomplete">
      {filteredMembers.map((member, index) => (
        <div key={member.id}
          className={`mention-item ${index === selectedIndex ? 'selected' : ''}`}
          onClick={() => addAssignee({ id: '', user_id: member.id, username: member.username, display_name: null })}
          onMouseEnter={() => setSelectedIndex(index)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          {member.username}
        </div>
      ))}
      {showFreeText && (
        <div
          className={`mention-item mention-item-freetext ${filteredMembers.length === selectedIndex ? 'selected' : ''}`}
          onClick={() => addAssignee({ id: '', user_id: null, username: null, display_name: autocompleteFilter.trim() })}
          onMouseEnter={() => setSelectedIndex(filteredMembers.length)}>
          Add "{autocompleteFilter.trim()}"
        </div>
      )}
    </div>
  );
})()}
```

**Step 5: Update keyboard navigation**

The `handleKeyDown` function (line 420+) needs to use the new unified item count (`filteredMembers.length + (showFreeText ? 1 : 0)`). On Enter, select the item at `selectedIndex` from the unified list.

**Step 6: Update chips rendering**

In the editing view (lines 666-684), replace the two chip loops with one:

```tsx
<div className="assignee-chips">
  {editAssignees.map((assignee, index) => (
    <div key={assignee.user_id || assignee.display_name || index} className={`assignee-chip ${assignee.user_id ? 'member-chip' : ''}`}>
      <span className="chip-name">{assignee.username || assignee.display_name}</span>
      <button type="button" onClick={() => removeAssignee(assignee)} className="chip-remove" aria-label="Remove">×</button>
    </div>
  ))}
</div>
```

**Step 7: Update detail view chips (read-only, lines 1084-1093)**

Replace:
```tsx
{(card.members?.length || card.assignees?.length) ? (
  <div className="card-detail-chips">
    {card.members?.map(...)}
    {card.assignees?.map(...)}
  </div>
) : null}
```

With:
```tsx
{card.assignees?.length ? (
  <div className="card-detail-chips">
    {card.assignees.map((a, i) => (
      <span key={a.id || i} className={`assignee-chip ${a.user_id ? 'member-chip' : ''}`}>
        <span className="chip-name">{a.username || a.display_name}</span>
      </span>
    ))}
  </div>
) : null}
```

**Step 8: Update card footer (collapsed view, lines 1492-1502)**

Replace the two loops with one:
```tsx
{card.assignees?.map((a, i) => (
  <span key={a.id || i} className={`assignee-badge ${a.user_id ? 'member-badge' : ''}`}>
    {a.username || a.display_name}
  </span>
))}
```

Remove the `card.members?.length` checks from `hasFooter`.

**Step 9: Update checklist item assignee dropdown (lines 836-846)**

The dropdown currently shows `assignees` (was board_assignees). Replace with board members + free-text:

```tsx
{assigneeDropdownItemId === item.id && (
  <div className="checklist-assignee-dropdown">
    <button type="button" className="checklist-assignee-option"
      onClick={() => { handleChecklistItemUpdate(item.id, { assignee_name: null, assignee_user_id: null } as any); setAssigneeDropdownItemId(null); }}>
      Unassign
    </button>
    {boardMembers.map(m => (
      <button type="button" key={m.id}
        className={`checklist-assignee-option${item.assignee_user_id === m.id ? ' selected' : ''}`}
        onClick={() => { handleChecklistItemUpdate(item.id, { assignee_user_id: m.id, assignee_name: m.username } as any); setAssigneeDropdownItemId(null); }}>
        {m.username}
      </button>
    ))}
  </div>
)}
```

Update the checklist item display chip (line 831-834) to show `item.assignee_name` (which works for both linked and unlinked since the server returns the resolved name).

**Step 10: Verify compile**

```bash
cd client && npx tsc --noEmit
```

**Step 11: Commit**

```bash
git add client/src/components/KanbanCard.tsx
git commit -m "feat: unified assignment picker in KanbanCard"
```

---

### Task 13: Client — Update TableView and TableCell

**Files:**
- Modify: `client/src/components/TableView.tsx`
- Modify: `client/src/components/TableCell.tsx`

**Step 1: Update TableView**

- Remove the `assignees: { id: string; name: string }[]` prop (line 12) — no longer needed
- Update sorting by assignees (line 119-122): join `card.assignees?.map(a => a.username || a.display_name)` instead of `card.assignees` (which was `string[]`)
- Update grouping by assignee (lines 160-161): use `a.username || a.display_name` for the group key

**Step 2: Update TableCell**

- Remove the `assignees` prop (line 15) — no longer needed
- Rewrite `AssigneesCell` (lines 137-245):
  - Remove `toggleMember` (which called `api.setCardMembers`) — replaced by unified logic
  - Remove `toggleAssignee` (which called `api.updateCard({ assignees: string[] })`)
  - Single `toggleAssignee` that works with the new `CardAssignee` shape
  - `displayNames` comes from `card.assignees?.map(a => a.username || a.display_name)` instead of merging two arrays
  - The dropdown shows `boardMembers` for toggling, same as KanbanCard

**Step 3: Commit**

```bash
git add client/src/components/TableView.tsx client/src/components/TableCell.tsx
git commit -m "feat: table view uses unified assignees"
```

---

### Task 14: Client — Update MentionText and DashboardView

**Files:**
- Modify: `client/src/components/MentionText.tsx`
- Modify: `client/src/components/DashboardView.tsx`

**Step 1: Update MentionText**

The component takes `assignees: { id: string; name: string }[]` (line 6). This was the board_assignees pool. Change the prop to work with the card's assignees or just board members. The mention highlighting should check if `@name` matches any board member username. Remove the assignees prop entirely — only use `boardMembers` for mention resolution.

Update the highlighting logic (lines 17-22): only check `boardMembers.some(m => m.username.toLowerCase() === mention.toLowerCase())`.

**Step 2: Update all MentionText call sites**

Find all `<MentionText` renders in KanbanCard.tsx and remove the `assignees=` prop.

**Step 3: Update DashboardView**

The `cards_by_assignee` data shape stays the same (`{ assignee: string; total: number; completed: number }[]`), so the DashboardView component should need minimal changes. Verify the analytics response still matches.

**Step 4: Commit**

```bash
git add client/src/components/MentionText.tsx client/src/components/DashboardView.tsx client/src/components/KanbanCard.tsx
git commit -m "feat: MentionText and DashboardView use unified model"
```

---

### Task 15: Client — Update KanbanBoard to Pass Correct Props

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx`

**Step 1: Clean up KanbanCard renders**

After Tasks 11 and 12, KanbanCard no longer accepts `assignees` (board pool) or `onAddAssignee` props. Find all `<KanbanCard` renders in KanbanBoard.tsx and ensure:
- Remove `assignees={assignees}` prop
- Remove `onAddAssignee={handleAddAssignee}` prop
- Keep `boardMembers={boardMembers}`

**Step 2: Verify full compile**

```bash
cd client && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add client/src/components/KanbanBoard.tsx
git commit -m "feat: KanbanBoard passes clean props to KanbanCard"
```

---

### Task 16: Server — Update schema.sql Canonical Schema

**Files:**
- Modify: `server/src/migrations/schema.sql`

**Step 1: Update the canonical schema file**

This file should reflect the final DB state. Make the following changes:
- Remove `board_assignees` table definition and its index
- Replace `card_assignees` table definition with the new schema (id, card_id, user_id, display_name, created_at + constraints)
- Remove `card_members` table definition and its indexes
- Add `assignee_user_id` column to `card_checklist_items` definition
- Update indexes section

**Step 2: Commit**

```bash
git add server/src/migrations/schema.sql
git commit -m "feat: schema.sql reflects unified assignee model"
```

---

### Task 17: Cleanup and Verify

**Step 1: Full compile check**

```bash
cd server && npx tsc --noEmit
cd ../client && npx tsc --noEmit
```

**Step 2: Full build check**

```bash
cd client && npx vite build
```

**Step 3: Search for any remaining references**

```bash
grep -r "card_members" server/src/ client/src/ --include="*.ts" --include="*.tsx" -l
grep -r "board_assignees" server/src/ client/src/ --include="*.ts" --include="*.tsx" -l
grep -r "CardMember" client/src/ --include="*.ts" --include="*.tsx" -l
grep -r "getCardMembers\|setCardMembers" client/src/ --include="*.ts" --include="*.tsx" -l
grep -r "getBoardAssignees\|addBoardAssignee\|renameBoardAssignee\|deleteBoardAssignee" client/src/ --include="*.ts" --include="*.tsx" -l
```

All should return empty. Fix any stragglers.

**Step 4: Clean up CSS**

In `client/src/index.css`, remove styles that referenced the deleted components:
- `.add-assignee-form`, `.assignees-list`, `.assignee-item`, `.assignee-name`, `.assignee-rename-input`, `.btn-delete-assignee` (lines ~2464-2540) — these were for BoardAssignees.tsx
- The `mention-item-member` and `mention-item-assignee` classes can be simplified to just `mention-item`
- Add a `.mention-item-freetext` style for the "Add <name>" option in the picker

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: cleanup stale references and CSS for assignee unification"
```

---

### Task 18: Manual Verification

**Step 1: Run the migration against the live database**

Deploy (push to trigger Gitea CI) or run migration manually.

**Step 2: Verify these flows work:**

1. Open a board → cards show unified assignee badges
2. Edit a card → assignment picker shows board members with user icons
3. Type a name → free-text entry appears as "Add <name>" option
4. Type a name matching a board member → auto-links (shows as linked chip)
5. Remove an assignee → works for both linked and unlinked
6. Card footer shows all assignees with correct styling
7. Table view → sort/group by assignee works
8. Dashboard → "Cards by Assignee" chart correct
9. CSV export → assignees column shows resolved names
10. CSV import → assignees auto-link where possible
11. Notifications → linked assignees receive notifications when added
12. Checklist items → can assign board members
13. @mentions in comments → highlight board member names

**Step 3: Check the old "Manage Assignees" menu item is gone**

The board settings dropdown should no longer show "Assignees".
