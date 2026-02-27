# Per-Board Permissions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace global-role-based authorization with per-board roles so each board member has an independent ADMIN/COLLABORATOR/READ role governing their actions within that board.

**Architecture:** Add a `role` column to `board_members`. Create a `requireBoardRole(minimumRole)` middleware that resolves the board from the route context, looks up the user's board role, and compares against the minimum. Replace all `requireAdmin` calls on board-scoped routes with `requireBoardRole`. Frontend receives `currentUserRole` from the API and uses it to gate UI.

**Tech Stack:** PostgreSQL (migration), Express middleware (TypeScript), React (frontend gating)

---

### Task 1: Database Migration

**Files:**
- Create: `server/src/migrations/024-board-permissions.sql`
- Modify: `server/src/migrations/schema.sql` (update `board_members` table definition to include `role` column)

**Step 1: Create migration file**

Create `server/src/migrations/024-board-permissions.sql`:

```sql
-- Add role column to board_members
ALTER TABLE board_members
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'COLLABORATOR'
  CHECK (role IN ('ADMIN', 'COLLABORATOR', 'READ'));

-- Ensure board creators are in board_members with ADMIN role
INSERT INTO board_members (board_id, user_id, role)
SELECT b.id, b.created_by, 'ADMIN'
FROM boards b
WHERE b.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM board_members bm
    WHERE bm.board_id = b.id AND bm.user_id = b.created_by
  );

-- Promote existing creator rows to ADMIN
UPDATE board_members bm
SET role = 'ADMIN'
FROM boards b
WHERE bm.board_id = b.id
  AND bm.user_id = b.created_by;
```

**Step 2: Update schema.sql**

In `server/src/migrations/schema.sql`, update the `board_members` table (lines 20-26) to include the role column so fresh installs get the correct schema:

```sql
CREATE TABLE IF NOT EXISTS board_members (
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'COLLABORATOR' CHECK (role IN ('ADMIN', 'COLLABORATOR', 'READ')),
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (board_id, user_id)
);
```

**Step 3: Run migration**

Run: `cd server && npm run migrate`
Expected: Migration applies cleanly, board creators now have ADMIN role in board_members.

**Step 4: Verify**

Run: `psql` and check:
```sql
SELECT bm.board_id, bm.user_id, bm.role, b.created_by
FROM board_members bm
JOIN boards b ON bm.board_id = b.id
WHERE bm.user_id = b.created_by;
```
Expected: All creator rows show `role = 'ADMIN'`.

**Step 5: Commit**

```bash
git add server/src/migrations/024-board-permissions.sql server/src/migrations/schema.sql
git commit -m "feat: add per-board role column to board_members (migration 024)"
```

---

### Task 2: `requireBoardRole` Middleware & Board ID Resolution

**Files:**
- Modify: `server/src/middleware/auth.ts` (lines 101-106, add new middleware after `requireAdmin`)
- Modify: `server/src/types.ts` (lines 77-83, extend `AuthRequest`)

**Step 1: Extend AuthRequest type**

In `server/src/types.ts`, add `boardRole` to the `AuthRequest` interface (line 77-83):

```typescript
export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: 'READ' | 'COLLABORATOR' | 'ADMIN';
  };
  boardRole?: 'READ' | 'COLLABORATOR' | 'ADMIN';
}
```

**Step 2: Add `requireBoardRole` middleware**

In `server/src/middleware/auth.ts`, after the `requireAdmin` function (after line 106), add:

```typescript
export type BoardRole = 'READ' | 'COLLABORATOR' | 'ADMIN';
const ROLE_RANK: Record<BoardRole, number> = { READ: 0, COLLABORATOR: 1, ADMIN: 2 };

async function resolveBoardId(req: AuthRequest): Promise<string | null> {
  // Direct board routes: /boards/:id/... or /boards/:boardId/...
  if (req.params.id && req.baseUrl.includes('/boards')) return req.params.id;
  if (req.params.boardId) return req.params.boardId;

  // Card routes: look up via card -> column -> board
  const cardId = req.params.cardId || req.params.id;
  if (cardId) {
    const result = await pool.query(
      `SELECT col.board_id FROM cards c
       JOIN columns col ON c.column_id = col.id
       WHERE c.id = $1`,
      [cardId]
    );
    if (result.rows.length > 0) return result.rows[0].board_id;
  }

  // Column POST: board_id in body
  if (req.body?.board_id) return req.body.board_id;

  // Column PUT/DELETE: look up via column
  if (req.params.id) {
    const result = await pool.query(
      'SELECT board_id FROM columns WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length > 0) return result.rows[0].board_id;
  }

  // Card POST: column_id in body -> board
  if (req.body?.column_id) {
    const result = await pool.query(
      'SELECT board_id FROM columns WHERE id = $1',
      [req.body.column_id]
    );
    if (result.rows.length > 0) return result.rows[0].board_id;
  }

  return null;
}

export function requireBoardRole(minimumRole: BoardRole) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    // Global ADMIN always has full access
    if (req.user?.role === 'ADMIN') {
      req.boardRole = 'ADMIN';
      return next();
    }

    const boardId = await resolveBoardId(req);
    if (!boardId) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const result = await pool.query(
      'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
      [boardId, req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Not a board member' });
    }

    const userBoardRole = result.rows[0].role as BoardRole;
    if (ROLE_RANK[userBoardRole] < ROLE_RANK[minimumRole]) {
      return res.status(403).json({ error: 'Insufficient board permissions' });
    }

    req.boardRole = userBoardRole;
    next();
  };
}
```

Note: You'll need to import `pool` at the top of `auth.ts`:
```typescript
import pool from '../db';
```

**Step 3: Verify server compiles**

Run: `cd server && npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add server/src/middleware/auth.ts server/src/types.ts
git commit -m "feat: add requireBoardRole middleware with board ID resolution"
```

---

### Task 3: Update Board Routes to Use `requireBoardRole`

**Files:**
- Modify: `server/src/routes/boards.ts`

**Step 1: Add import**

At the top of `server/src/routes/boards.ts`, update the import from auth middleware to include `requireBoardRole`:

```typescript
import { authenticate, requireAdmin, requireBoardRole } from '../middleware/auth';
```

**Step 2: Update board creation to add creator as board member**

In the POST `/` handler (line 374-401), after the board INSERT query (after line 388), add:

```typescript
    // Add creator as board ADMIN
    await pool.query(
      'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)',
      [result.rows[0].id, req.user!.id, 'ADMIN']
    );
```

**Step 3: Update GET /:id to include currentUserRole**

In the GET `/:id` handler (line 38-208), modify the member check (lines 44-52) to also fetch the user's board role. After the existing board query, add the user's role to the response. Replace the access check block:

```typescript
    // Determine user's board role
    let currentUserRole: string = 'READ';
    if (user.role === 'ADMIN') {
      currentUserRole = 'ADMIN';
    } else {
      const memberCheck = await pool.query(
        'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
        [id, user.id]
      );
      if (memberCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Board not found' });
      }
      currentUserRole = memberCheck.rows[0].role;
    }
```

Then include `currentUserRole` in the response object (wherever the board response is assembled near the end of the handler).

**Step 4: Update GET /:id/members to return board role**

In the GET `/:id/members` handler (line 476-499), update the query (lines 480-491) to return `bm.role as board_role` instead of `u.role`:

```sql
SELECT u.id, u.username, u.role as global_role, bm.role as board_role, bm.added_at
FROM board_members bm
INNER JOIN users u ON bm.user_id = u.id
WHERE bm.board_id = $1
UNION
SELECT u.id, u.username, u.role as global_role, 'ADMIN' as board_role, u.created_at as added_at
FROM users u
WHERE u.role = 'ADMIN'
  AND u.id NOT IN (SELECT user_id FROM board_members WHERE board_id = $1)
ORDER BY username
```

**Step 5: Replace `requireAdmin` with `requireBoardRole` on board-scoped routes**

Make these replacements in `server/src/routes/boards.ts`:

| Line | Current | New |
|------|---------|-----|
| 404 | `authenticate, requireAdmin` | `authenticate, requireBoardRole('ADMIN')` |
| 455 | `authenticate, requireAdmin` | `authenticate, requireBoardRole('ADMIN')` |
| 502 | `authenticate, requireAdmin` | `authenticate, requireBoardRole('ADMIN')` |
| 536 | `authenticate, requireAdmin` | `authenticate, requireBoardRole('ADMIN')` |
| 560 | `authenticate, requireAdmin` | `authenticate, requireBoardRole('ADMIN')` |
| 582 | `authenticate, requireAdmin` | `authenticate, requireBoardRole('ADMIN')` |

Keep `requireAdmin` on `POST /` (line 374) — board creation stays global admin only.

**Step 6: Update POST /:id/members to accept role parameter**

In the POST `/:id/members` handler (lines 502-533), update to accept a `role` parameter:

```typescript
    const { user_id, role } = req.body;
    const memberRole = role || 'COLLABORATOR';

    // Validate role
    if (!['ADMIN', 'COLLABORATOR', 'READ'].includes(memberRole)) {
      return res.status(400).json({ error: 'Invalid role. Must be ADMIN, COLLABORATOR, or READ' });
    }
```

And update the INSERT query (line 523-525):
```sql
INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
```
with params `[id, user_id, memberRole]`.

**Step 7: Add last-admin guard to member removal**

In the DELETE `/:id/members/:userId` handler (lines 582-600), before the DELETE query, add:

```typescript
    // Check if removing the last ADMIN
    const targetMember = await pool.query(
      'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
      [id, userId]
    );
    if (targetMember.rows.length > 0 && targetMember.rows[0].role === 'ADMIN') {
      const adminCount = await pool.query(
        'SELECT COUNT(*) FROM board_members WHERE board_id = $1 AND role = $2',
        [id, 'ADMIN']
      );
      if (parseInt(adminCount.rows[0].count) <= 1) {
        return res.status(400).json({
          error: 'Cannot remove the last board admin. Transfer admin to another member first.'
        });
      }
    }
```

**Step 8: Add PUT /:id/members/:userId/role endpoint for changing roles**

Add a new route after the DELETE members route:

```typescript
// Change board member role (board admin only)
router.put('/:id/members/:userId/role', authenticate, requireBoardRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const { id, userId } = req.params;
    const { role } = req.body;

    if (!role || !['ADMIN', 'COLLABORATOR', 'READ'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be ADMIN, COLLABORATOR, or READ' });
    }

    // Check if demoting the last ADMIN
    const currentRole = await pool.query(
      'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
      [id, userId]
    );
    if (currentRole.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    if (currentRole.rows[0].role === 'ADMIN' && role !== 'ADMIN') {
      const adminCount = await pool.query(
        'SELECT COUNT(*) FROM board_members WHERE board_id = $1 AND role = $2',
        [id, 'ADMIN']
      );
      if (parseInt(adminCount.rows[0].count) <= 1) {
        return res.status(400).json({
          error: 'Cannot demote the last board admin. Promote another member first.'
        });
      }
    }

    await pool.query(
      'UPDATE board_members SET role = $1 WHERE board_id = $2 AND user_id = $3',
      [role, id, userId]
    );

    res.json({ message: 'Role updated' });
  } catch (error) {
    console.error('Change member role error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Step 9: Verify server compiles**

Run: `cd server && npx tsc --noEmit`

**Step 10: Commit**

```bash
git add server/src/routes/boards.ts
git commit -m "feat: use requireBoardRole on board routes, add role management"
```

---

### Task 4: Update Card, Column, Comment, Checklist, Label Routes

**Files:**
- Modify: `server/src/routes/cards.ts` (lines 12, 49, 351)
- Modify: `server/src/routes/columns.ts` (lines 9, 30, 56)
- Modify: `server/src/routes/comments.ts` (lines 30, 130)
- Modify: `server/src/routes/checklists.ts` (lines 25, 56, 144)
- Modify: `server/src/routes/labels.ts` (lines 24, 51, 81, 99, 115)

**Step 1: Update cards.ts**

Add import: `import { authenticate, requireAdmin, requireBoardRole } from '../middleware/auth';`

Replace `requireAdmin` with `requireBoardRole('COLLABORATOR')` on:
- Line 12: `POST /` (create card)
- Line 49: `PUT /:id` (update card)
- Line 351: `DELETE /:id` (delete card) — also add `requireBoardRole('COLLABORATOR')` here

**Step 2: Update columns.ts**

Add `requireBoardRole` to import.

Replace `requireAdmin` with `requireBoardRole('ADMIN')` on:
- Line 9: `POST /` (create column)
- Line 30: `PUT /:id` (update column)
- Line 56: `DELETE /:id` (delete column)

**Step 3: Update comments.ts**

Add `requireBoardRole` to import.

Replace `authenticate` with `authenticate, requireBoardRole('COLLABORATOR')` on:
- Line 30: `POST /cards/:cardId/comments` (add comment — was unprotected)
- Line 130: `DELETE /comments/:id` (delete comment — was unprotected)

Note: The delete handler (line 130) currently checks `comment.user_id === req.user!.id || req.user!.role === 'ADMIN'`. Keep this check — COLLABORATOR can only delete their own comments, board/global ADMIN can delete any.

For the delete comment route, `resolveBoardId` needs the card_id. The current handler fetches the comment to check ownership. You'll need to look up the card_id from the comment, then the board from the card. Since `requireBoardRole` needs the board at middleware time, and comment routes use `/comments/:id`, add resolution logic: query `SELECT c.column_id FROM card_comments cc JOIN cards c ON cc.card_id = c.id WHERE cc.id = $1` then resolve board from column. Alternatively, since this is complex, keep `authenticate` on the delete route and do the board role check inline after fetching the comment.

**Step 4: Update checklists.ts**

Add `requireBoardRole` to import.

Replace `requireAdmin` with `requireBoardRole('COLLABORATOR')` on:
- Line 25: `POST /cards/:cardId/checklist`
- Line 56: `PUT /checklist/:id`
- Line 144: `DELETE /checklist/:id`

For PUT/DELETE on `/checklist/:id`, `resolveBoardId` needs to resolve: checklist_item -> card -> column -> board. Add this resolution path to `resolveBoardId` in auth.ts, or handle inline.

**Step 5: Update labels.ts**

Add `requireBoardRole` to import.

Replace `requireAdmin` with `requireBoardRole('ADMIN')` on:
- Line 24: `POST /boards/:boardId/labels`
- Line 51: `PUT /labels/:id`
- Line 81: `DELETE /labels/:id`
- Line 99: `POST /cards/:cardId/labels` (add label to card) — use `requireBoardRole('COLLABORATOR')` since assigning labels is a card-level action
- Line 115: `DELETE /cards/:cardId/labels/:labelId` — use `requireBoardRole('COLLABORATOR')`

For `PUT /labels/:id` and `DELETE /labels/:id`, the label ID needs to resolve to a board. Add resolution: `SELECT board_id FROM board_labels WHERE id = $1`.

**Step 6: Extend `resolveBoardId` for additional entity types**

Back in `server/src/middleware/auth.ts`, extend `resolveBoardId` to handle:
- Checklist items: `SELECT col.board_id FROM checklist_items ci JOIN cards c ON ci.card_id = c.id JOIN columns col ON c.column_id = col.id WHERE ci.id = $1`
- Labels: `SELECT board_id FROM board_labels WHERE id = $1`
- Comments: `SELECT col.board_id FROM card_comments cc JOIN cards c ON cc.card_id = c.id JOIN columns col ON c.column_id = col.id WHERE cc.id = $1`

The resolution order in `resolveBoardId` should be:
1. Check `req.params.boardId` or `req.params.id` on board routes
2. Check `req.params.cardId` (card-scoped routes like comments, checklists, attachments)
3. Check `req.body.column_id` (card creation)
4. Check `req.body.board_id` (column creation)
5. For bare `:id` params, try each entity table in order until one matches

For step 5, a practical approach: use the route's `baseUrl` to determine which table to query. E.g., if `req.baseUrl` includes `/columns`, query columns table; if it includes `/labels`, query board_labels; etc.

**Step 7: Verify server compiles**

Run: `cd server && npx tsc --noEmit`

**Step 8: Commit**

```bash
git add server/src/routes/cards.ts server/src/routes/columns.ts server/src/routes/comments.ts server/src/routes/checklists.ts server/src/routes/labels.ts server/src/middleware/auth.ts
git commit -m "feat: apply requireBoardRole to card/column/comment/checklist/label routes"
```

---

### Task 5: Fix Security Gaps (Analytics, Attachments, Custom Fields)

**Files:**
- Modify: `server/src/routes/analytics.ts` (line 8)
- Modify: `server/src/routes/attachments.ts` (lines 18-36, 39, 152)
- Modify: `server/src/routes/customFields.ts` (lines 24, 58, 102, 134)

**Step 1: Fix analytics.ts**

Add import for `requireBoardRole`. Change line 8 from:
```typescript
router.get('/boards/:boardId/analytics', authenticate, async (req: Request, res: Response) => {
```
to:
```typescript
router.get('/boards/:boardId/analytics', authenticate, requireBoardRole('READ'), async (req: AuthRequest, res: Response) => {
```

Import `AuthRequest` from types and `requireBoardRole` from middleware.

**Step 2: Fix attachments.ts**

The attachments routes already have a `getBoardIdForCard` helper (lines 18-36) that checks board membership. Update this helper to also check the board role:

Replace the simple membership check with a role check. Since attachments require COLLABORATOR, update `getBoardIdForCard` to return the board role as well:

```typescript
async function getBoardIdForCard(cardId: string, userId: string, userRole: string): Promise<{ boardId: string; boardRole: string } | null> {
  const result = await pool.query(
    `SELECT col.board_id FROM cards c
     JOIN columns col ON c.column_id = col.id
     WHERE c.id = $1`,
    [cardId]
  );
  if (result.rows.length === 0) return null;
  const boardId = result.rows[0].board_id;

  if (userRole === 'ADMIN') {
    return { boardId, boardRole: 'ADMIN' };
  }

  const member = await pool.query(
    'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
    [boardId, userId]
  );
  if (member.rows.length === 0) return null;
  return { boardId, boardRole: member.rows[0].role };
}
```

Then in POST (upload, line 39) and DELETE (line 152) handlers, check that `boardRole` is at least COLLABORATOR. In GET handlers (list, download), check at least READ.

**Step 3: Fix customFields.ts**

Add `requireBoardRole` import. Replace `requireAdmin` with:
- `requireBoardRole('ADMIN')` on POST/PUT/DELETE custom field definitions (lines 24, 58, 102)
- `requireBoardRole('COLLABORATOR')` on PUT card field values (line 134) — setting values is a card-level action

Custom fields routes use `req.body.board_id` or query params for board context. Verify `resolveBoardId` handles these paths.

**Step 4: Verify server compiles**

Run: `cd server && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add server/src/routes/analytics.ts server/src/routes/attachments.ts server/src/routes/customFields.ts
git commit -m "fix: add board-membership checks to analytics, attachments, and custom fields"
```

---

### Task 6: Block User Deletion When It Would Orphan Boards

**Files:**
- Modify: `server/src/routes/users.ts` (lines 92-115)

**Step 1: Add orphan check before user deletion**

In the DELETE `/:id` handler (line 92-115), after the self-deletion check (line 97-99), add:

```typescript
    // Check if deleting this user would orphan any boards (leave them with no ADMIN)
    const orphanCheck = await pool.query(
      `SELECT bm.board_id, b.name
       FROM board_members bm
       JOIN boards b ON bm.board_id = b.id
       WHERE bm.user_id = $1 AND bm.role = 'ADMIN'
         AND (SELECT COUNT(*) FROM board_members bm2
              WHERE bm2.board_id = bm.board_id AND bm2.role = 'ADMIN') = 1`,
      [id]
    );
    if (orphanCheck.rows.length > 0) {
      const boardNames = orphanCheck.rows.map(r => r.name).join(', ');
      return res.status(400).json({
        error: `Cannot delete user: they are the sole admin on board(s): ${boardNames}. Reassign admin role first.`
      });
    }
```

**Step 2: Verify server compiles**

Run: `cd server && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add server/src/routes/users.ts
git commit -m "fix: block user deletion when it would orphan boards"
```

---

### Task 7: Update Client Types and API

**Files:**
- Modify: `client/src/types.ts` (lines 24-29 — BoardMember interface)
- Modify: `client/src/api.ts` (lines 120-135 — board member API methods)

**Step 1: Update BoardMember type**

In `client/src/types.ts`, update the `BoardMember` interface (lines 24-29) to include `board_role`:

```typescript
export interface BoardMember {
  id: string;
  username: string;
  role: 'READ' | 'COLLABORATOR' | 'ADMIN';       // global role
  board_role: 'READ' | 'COLLABORATOR' | 'ADMIN';  // per-board role
  added_at: string;
}
```

**Step 2: Add Board type field for currentUserRole**

Add to the Board interface (lines 11-22):

```typescript
export interface Board {
  id: string;
  name: string;
  description: string;
  archived?: boolean;
  public_token?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  currentUserRole?: 'READ' | 'COLLABORATOR' | 'ADMIN';
}
```

**Step 3: Update API methods**

In `client/src/api.ts`, update `addBoardMember` (lines 124-128) to accept a role parameter:

```typescript
  async addBoardMember(boardId: string, userId: string, role: string = 'COLLABORATOR'): Promise<void> {
    return this.fetch(`/boards/${boardId}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, role }),
    }, 'addBoardMember');
  }
```

Add a new method for changing roles:

```typescript
  async changeBoardMemberRole(boardId: string, userId: string, role: string): Promise<void> {
    return this.fetch(`/boards/${boardId}/members/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }, 'changeBoardMemberRole');
  }
```

**Step 4: Commit**

```bash
git add client/src/types.ts client/src/api.ts
git commit -m "feat: update client types and API for per-board roles"
```

---

### Task 8: Update BoardMembers Component

**Files:**
- Modify: `client/src/components/BoardMembers.tsx`

**Step 1: Accept currentUserRole prop**

Update the props interface (lines 6-9):

```typescript
interface BoardMembersProps {
  boardId: string;
  onClose: () => void;
  currentUserRole: 'READ' | 'COLLABORATOR' | 'ADMIN';
}
```

**Step 2: Add role picker state**

Add state for the role picker when adding members:

```typescript
const [selectedRole, setSelectedRole] = useState<string>('COLLABORATOR');
```

**Step 3: Update available users filter**

Replace the filter (lines 60-63) to show ALL non-member users instead of just READ:

```typescript
const availableUsers = allUsers.filter(
  (u) => !members.some((m) => m.id === u.id)
);
```

**Step 4: Update handleAddMember to pass role**

Update the add handler (lines 37-47):

```typescript
const handleAddMember = async () => {
  if (!selectedUserId) return;
  try {
    await api.addBoardMember(boardId, selectedUserId, selectedRole);
    setSelectedUserId('');
    setSelectedRole('COLLABORATOR');
    loadData();
  } catch (err: any) {
    alert(err.message || 'Failed to add member');
  }
};
```

**Step 5: Add role change handler**

```typescript
const handleChangeRole = async (userId: string, newRole: string) => {
  try {
    await api.changeBoardMemberRole(boardId, userId, newRole);
    loadData();
  } catch (err: any) {
    alert(err.message || 'Failed to change role');
  }
};
```

**Step 6: Update the add member section**

Add a role dropdown next to the user selector (after the select element, before the Add button). Only show the add section if `currentUserRole === 'ADMIN'`:

```tsx
{currentUserRole === 'ADMIN' && availableUsers.length > 0 && (
  <div className="add-member-section">
    <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} className="member-select">
      <option value="">Select a user to add...</option>
      {availableUsers.map((user) => (
        <option key={user.id} value={user.id}>{user.username}</option>
      ))}
    </select>
    <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} className="role-select">
      <option value="ADMIN">Admin</option>
      <option value="COLLABORATOR">Collaborator</option>
      <option value="READ">Read</option>
    </select>
    <button onClick={handleAddMember} className="btn-primary btn-sm" disabled={!selectedUserId}>Add</button>
  </div>
)}
```

**Step 7: Update member list to show board role with dropdown**

Replace the member row rendering (lines 107-122) to show the board role and a role change dropdown for admins:

```tsx
members.map((member) => (
  <div key={member.id} className="member-row">
    <div className="member-info">
      <span className="member-name">{member.username}</span>
      {currentUserRole === 'ADMIN' ? (
        <select
          value={member.board_role}
          onChange={(e) => handleChangeRole(member.id, e.target.value)}
          className="role-select-inline"
        >
          <option value="ADMIN">Admin</option>
          <option value="COLLABORATOR">Collaborator</option>
          <option value="READ">Read</option>
        </select>
      ) : (
        <span className={`role-badge role-${member.board_role.toLowerCase()}`}>
          {member.board_role}
        </span>
      )}
    </div>
    {currentUserRole === 'ADMIN' && (
      <button onClick={() => handleRemoveMember(member.id, member.username)} className="btn-sm btn-danger">
        Remove
      </button>
    )}
  </div>
))
```

**Step 8: Update subtitle text**

Replace the subtitle (lines 69-71):

```tsx
<p className="modal-subtitle">
  Board members and their roles. {currentUserRole === 'ADMIN' ? 'You can add members and change roles.' : 'Contact a board admin to change roles.'}
</p>
```

**Step 9: Commit**

```bash
git add client/src/components/BoardMembers.tsx
git commit -m "feat: update BoardMembers UI with role picker and role management"
```

---

### Task 9: Update KanbanBoard and App to Use Board Role

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx` (line 23, 75)
- Modify: `client/src/App.tsx` (line 510)

**Step 1: Fetch board role from API response**

In `client/src/components/KanbanBoard.tsx`, the board data is fetched and includes columns/cards. After fetching board data, extract `currentUserRole` from the response and use it instead of the global `userRole` prop.

Change the `userRole` prop usage (line 75): Instead of `const isAdmin = userRole === 'ADMIN'`, use:

```typescript
const [boardRole, setBoardRole] = useState<'READ' | 'COLLABORATOR' | 'ADMIN'>(userRole);
```

When fetching the board, set `boardRole` from the API response:

```typescript
setBoardRole(data.currentUserRole || userRole);
```

Then update `isAdmin` to use board role:

```typescript
const isAdmin = boardRole === 'ADMIN';
const canEdit = boardRole === 'COLLABORATOR' || boardRole === 'ADMIN';
```

Replace all `isAdmin` gating for card operations with `canEdit`:
- Card drag/drop: use `canEdit` (not `isAdmin`)
- Add card button: use `canEdit`
- Card editing: use `canEdit`
- Comment input: use `canEdit`

Keep `isAdmin` for:
- Column drag/drop
- Column add/edit/delete
- Board settings (name, description)

**Step 2: Pass boardRole to child components**

Wherever `userRole` or `isAdmin` is passed to child components, pass `boardRole` instead. Key locations:
- CardDetail component: pass `boardRole`
- BulkActionToolbar: pass `boardRole`
- BoardMembers: pass `currentUserRole={boardRole}`

**Step 3: Update App.tsx**

In `client/src/App.tsx` (line 510), keep passing `userRole={user?.role || 'READ'}` — this is the global role used as a fallback. KanbanBoard will override with the board-specific role once loaded.

**Step 4: Verify frontend compiles**

Run: `cd client && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add client/src/components/KanbanBoard.tsx client/src/App.tsx
git commit -m "feat: use board-level role for UI gating in KanbanBoard"
```

---

### Task 10: Update BoardList UI

**Files:**
- Modify: `client/src/components/BoardList.tsx` (lines 30, 145-154, 175)

**Step 1: Review what's gated by isAdmin**

Currently `isAdmin` (line 30) gates:
- Create board button (line 145-154) — should stay global admin only
- Board kebab menu (line 175) — should check per-board role, but we don't have it on the list page

For the board list page, the global role determines:
- Whether you see the "New Board" and "Admin" buttons (global ADMIN only)
- Board cards themselves don't need per-board role gating on the list view — actions happen inside the board

No changes needed here for now. The board list already correctly shows only boards the user is a member of.

**Step 2: Commit (skip if no changes)**

No changes needed for BoardList.tsx.

---

### Task 11: Manual Testing Checklist

No automated test suite exists in this project. Test manually:

**Migration:**
1. Run `npm run migrate` — migration applies cleanly
2. Check `board_members` table has `role` column
3. Board creators have `ADMIN` role

**Board creation:**
1. As global ADMIN, create a board — creator is added to `board_members` with `ADMIN` role
2. As global COLLABORATOR, cannot create boards (403)

**Board role enforcement:**
1. Add a user to a board as COLLABORATOR
2. As that user, create/edit/delete cards — should work
3. As that user, try to create/delete columns — should get 403
4. As that user, try to manage members — should get 403

5. Add a user to a board as READ
6. As that user, view the board — should work
7. As that user, try to create a card — should get 403
8. As that user, try to comment — should get 403

**Global ADMIN override:**
1. As global ADMIN, access a board you're not a member of — should work
2. All operations should succeed regardless of board_members entry

**Role management:**
1. As board ADMIN, change a member's role — should work
2. Try to demote yourself when you're the last ADMIN — should get 400
3. Try to remove the last ADMIN — should get 400

**User deletion guard:**
1. Try to delete a user who is the sole ADMIN on a board — should get 400 with board names
2. Promote another member to ADMIN, then delete — should succeed

**UI verification:**
1. As board ADMIN: see role dropdowns, add/remove members, see all board settings
2. As COLLABORATOR: see read-only member list, can edit cards, cannot see column management
3. As READ: see board content, cannot interact with cards/comments

**Step 1: Commit this testing checklist (optional)**

This is documented in the plan file itself. No separate commit needed.

---

### Summary of all commits

1. `feat: add per-board role column to board_members (migration 024)`
2. `feat: add requireBoardRole middleware with board ID resolution`
3. `feat: use requireBoardRole on board routes, add role management`
4. `feat: apply requireBoardRole to card/column/comment/checklist/label routes`
5. `fix: add board-membership checks to analytics, attachments, and custom fields`
6. `fix: block user deletion when it would orphan boards`
7. `feat: update client types and API for per-board roles`
8. `feat: update BoardMembers UI with role picker and role management`
9. `feat: use board-level role for UI gating in KanbanBoard`
