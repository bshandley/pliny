# Advanced Checklists / Subtasks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend checklist items with assignee, due date, and priority metadata. Add inline pickers in card detail view, overdue badges on collapsed cards, subtask chips in calendar view, and a "Has overdue subtasks" filter.

**Architecture:** Migration 014 adds three nullable columns (`assignee_name`, `due_date`, `priority`) to the existing `card_checklist_items` table. The existing checklist routes in `server/src/routes/checklists.ts` are extended to accept/return the new fields using the same dynamic update pattern. The board fetch in `server/src/routes/boards.ts` enhances the checklist summary to include an `overdue` count. On the client, `KanbanCard.tsx` renders a metadata row below each checklist item with assignee/date/priority pickers, and collapsed cards show an overdue badge.

**Tech Stack:** React, TypeScript, Express, PostgreSQL, native `<input type="date">` for date picker, existing API patterns.

---

### Task 1: Create Migration 014 — Advanced Checklist Columns

**Files:**
- Create: `server/src/migrations/014-advanced-checklists.sql`
- Modify: `server/src/migrations/run.ts`

**Step 1: Write the migration SQL**

Create `server/src/migrations/014-advanced-checklists.sql`:

```sql
-- Migration 014: Advanced checklists — add assignee, due date, priority to checklist items

ALTER TABLE card_checklist_items ADD COLUMN IF NOT EXISTS assignee_name VARCHAR(100) NULL;
ALTER TABLE card_checklist_items ADD COLUMN IF NOT EXISTS due_date DATE NULL;
ALTER TABLE card_checklist_items ADD COLUMN IF NOT EXISTS priority VARCHAR(10) NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_checklist_priority'
  ) THEN
    ALTER TABLE card_checklist_items ADD CONSTRAINT chk_checklist_priority
      CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high'));
  END IF;
END
$$;
```

**Step 2: Register in run.ts**

In `server/src/migrations/run.ts`, add after the migration 013 block:

```typescript
// Advanced checklists
const advancedChecklists = fs.readFileSync(
  path.join(__dirname, '014-advanced-checklists.sql'),
  'utf-8'
);
await pool.query(advancedChecklists);
```

**Step 3: Commit**

```bash
git add server/src/migrations/014-advanced-checklists.sql server/src/migrations/run.ts
git commit -m "feat: Add migration 014 for advanced checklist columns"
```

---

### Task 2: Extend Checklist API Routes

**Files:**
- Modify: `server/src/routes/checklists.ts`

**Step 1: Update POST handler to accept new fields**

In the POST `/cards/:cardId/checklist` handler (lines 24–49), extend to accept `assignee_name`, `due_date`, and `priority`:

```typescript
const { text, assignee_name, due_date, priority } = req.body;

// Existing text validation...

// Validate priority
if (priority && !['low', 'medium', 'high'].includes(priority)) {
  return res.status(400).json({ error: 'Priority must be low, medium, or high' });
}

const result = await pool.query(
  `INSERT INTO card_checklist_items (card_id, text, position, assignee_name, due_date, priority)
   VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
  [cardId, text.trim(), position, assignee_name || null, due_date || null, priority || null]
);
```

**Step 2: Update PUT handler to accept new fields**

In the PUT `/checklist/:id` handler (lines 52–90), add the new fields to the dynamic update builder. Follow the existing pattern with `updates[]` / `values[]` / `paramCount`:

```typescript
const { checked, text, assignee_name, due_date, priority } = req.body;

// ... existing text/checked handling ...

if (assignee_name !== undefined) {
  updates.push(`assignee_name = $${paramCount++}`);
  values.push(assignee_name || null);
}
if (due_date !== undefined) {
  updates.push(`due_date = $${paramCount++}`);
  values.push(due_date || null);
}
if (priority !== undefined) {
  if (priority && !['low', 'medium', 'high'].includes(priority)) {
    return res.status(400).json({ error: 'Priority must be low, medium, or high' });
  }
  updates.push(`priority = $${paramCount++}`);
  values.push(priority || null);
}
```

**Step 3: Verify GET handler returns new fields**

The GET `/cards/:cardId/checklist` handler already uses `SELECT *`, so `assignee_name`, `due_date`, and `priority` are automatically included in responses.

**Step 4: Commit**

```bash
git add server/src/routes/checklists.ts
git commit -m "feat: Extend checklist routes for assignee, due date, priority"
```

---

### Task 3: Enhance Board Fetch Checklist Summary

**Files:**
- Modify: `server/src/routes/boards.ts`

**Step 1: Add overdue count to checklist aggregation**

In `server/src/routes/boards.ts`, update the checklist summary query (around line 97–107). Change from:

```sql
SELECT ci.card_id, COUNT(*)::int as total, COUNT(*) FILTER (WHERE ci.checked)::int as checked
FROM card_checklist_items ci ...
GROUP BY ci.card_id
```

To:

```sql
SELECT ci.card_id,
       COUNT(*)::int as total,
       COUNT(*) FILTER (WHERE ci.checked)::int as checked,
       COUNT(*) FILTER (WHERE ci.due_date < CURRENT_DATE AND ci.checked = false)::int as overdue
FROM card_checklist_items ci ...
GROUP BY ci.card_id
```

**Step 2: Update the grouping map**

In the `checklistByCard` map construction (around line 140), include the new `overdue` field:

```typescript
checklistByCard[row.card_id] = { total: row.total, checked: row.checked, overdue: row.overdue };
```

**Step 3: Commit**

```bash
git add server/src/routes/boards.ts
git commit -m "feat: Include overdue count in board fetch checklist summary"
```

---

### Task 4: Update Client Types

**Files:**
- Modify: `client/src/types.ts`

**Step 1: Update ChecklistItem interface**

In `client/src/types.ts`, update the `ChecklistItem` interface (line 54) to include the new fields:

```typescript
export interface ChecklistItem {
  id: string;
  card_id: string;
  text: string;
  checked: boolean;
  position: number;
  assignee_name?: string | null;
  due_date?: string | null;
  priority?: 'low' | 'medium' | 'high' | null;
}
```

**Step 2: Update Card checklist type**

In the `Card` interface (line 91), update the checklist summary type:

```typescript
checklist?: { total: number; checked: number; overdue?: number } | null;
```

**Step 3: Commit**

```bash
git add client/src/types.ts
git commit -m "feat: Update ChecklistItem type with assignee, due date, priority"
```

---

### Task 5: Add Checklist Item Metadata UI in Card Detail

**Files:**
- Modify: `client/src/components/KanbanCard.tsx`
- Modify: `client/src/index.css`

**Step 1: Add metadata row to checklist items in renderEditFields**

In the checklist rendering section of `renderEditFields()` (lines 626–631), below each checklist item's checkbox + text row, add a metadata row:

```tsx
{/* Existing: checkbox + text + delete button */}
<div className="checklist-item-row">
  <input type="checkbox" checked={item.checked} onChange={() => handleToggleCheck(item)} />
  <span className={item.checked ? 'checked-text' : ''}>{item.text}</span>
  {canWrite && <button onClick={() => handleDeleteChecklistItem(item.id)}>×</button>}
</div>

{/* New: metadata row — shows when any property is set, or on hover for admin */}
{(item.assignee_name || item.due_date || item.priority || canWrite) && (
  <div className="checklist-meta-row">
    {/* Assignee picker */}
    <button
      className="checklist-meta-chip"
      onClick={() => canWrite && setEditingItemMeta({ id: item.id, field: 'assignee' })}
    >
      {item.assignee_name || (canWrite ? 'Assign' : '')}
    </button>

    {/* Due date picker */}
    <button
      className={`checklist-meta-chip${item.due_date && new Date(item.due_date) < new Date() && !item.checked ? ' overdue' : ''}`}
      onClick={() => canWrite && openDatePicker(item.id)}
    >
      {item.due_date
        ? new Date(item.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : (canWrite ? 'Set date' : '')}
    </button>

    {/* Priority toggle */}
    <button
      className={`checklist-meta-chip priority-${item.priority || 'none'}`}
      onClick={() => canWrite && cyclePriority(item)}
    >
      {item.priority ? item.priority.charAt(0).toUpperCase() + item.priority.slice(1) : (canWrite ? 'Priority' : '')}
    </button>
  </div>
)}
```

**Step 2: Add handlers**

```typescript
const cyclePriority = async (item: ChecklistItem) => {
  const cycle: (string | null)[] = [null, 'low', 'medium', 'high'];
  const currentIdx = cycle.indexOf(item.priority || null);
  const nextPriority = cycle[(currentIdx + 1) % cycle.length];
  try {
    await api.updateChecklistItem(item.id, { priority: nextPriority });
    onUpdate();
  } catch (err) {
    console.error('Failed to update priority:', err);
  }
};

const openDatePicker = (itemId: string) => {
  // Use a hidden <input type="date"> ref and trigger showPicker()
  // Same pattern as calendar mobile kebab date picker
  const input = document.createElement('input');
  input.type = 'date';
  input.style.position = 'absolute';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    try {
      await api.updateChecklistItem(itemId, { due_date: input.value || null });
      onUpdate();
    } catch (err) {
      console.error('Failed to update due date:', err);
    }
    document.body.removeChild(input);
  });
  input.addEventListener('blur', () => {
    if (document.body.contains(input)) document.body.removeChild(input);
  });
  input.showPicker();
};
```

**Assignee picker dropdown:** When `editingItemMeta.field === 'assignee'`, render a small dropdown listing board assignees (from the board data). Selecting one calls `api.updateChecklistItem(item.id, { assignee_name })`. "Unassign" option clears the value.

**Step 3: Add read-only metadata in renderDetailFields**

In `renderDetailFields()` (lines 812–837), add metadata display below each item (read-only, no pickers):

```tsx
{(item.assignee_name || item.due_date || item.priority) && (
  <div className="checklist-meta-row read-only">
    {item.assignee_name && <span className="checklist-meta-chip">{item.assignee_name}</span>}
    {item.due_date && (
      <span className={`checklist-meta-chip${isOverdue(item) ? ' overdue' : ''}`}>
        {formatShortDate(item.due_date)}
      </span>
    )}
    {item.priority && <span className={`checklist-meta-chip priority-${item.priority}`}>{item.priority}</span>}
  </div>
)}
```

**Step 4: Add CSS**

```css
/* ---- Checklist Metadata ---- */

.checklist-meta-row {
  display: flex;
  gap: 0.375rem;
  padding: 0.125rem 0 0.25rem 1.75rem;
  flex-wrap: wrap;
}

.checklist-meta-row.read-only {
  pointer-events: none;
}

.checklist-meta-chip {
  font-size: 0.65rem;
  padding: 0.0625rem 0.375rem;
  border-radius: var(--radius-pill);
  background: var(--bg-raised);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
}

.checklist-meta-chip:hover {
  background: var(--bg);
  color: var(--text);
}

.checklist-meta-chip.overdue {
  background: var(--danger-subtle, #fef2f2);
  color: var(--danger);
  border-color: var(--danger);
}

.checklist-meta-chip.priority-low {
  color: var(--text-secondary);
}

.checklist-meta-chip.priority-medium {
  background: #fff8e1;
  color: #f59e0b;
  border-color: #f59e0b;
}

.checklist-meta-chip.priority-high {
  background: #fef2f2;
  color: var(--danger);
  border-color: var(--danger);
  font-weight: 600;
}

.checklist-meta-chip.priority-none {
  opacity: 0.5;
}
```

**Step 5: Commit**

```bash
git add client/src/components/KanbanCard.tsx client/src/index.css
git commit -m "feat: Add checklist item metadata UI with assignee, date, priority pickers"
```

---

### Task 6: Add Overdue Badge to Collapsed Card

**Files:**
- Modify: `client/src/components/KanbanCard.tsx`
- Modify: `client/src/index.css`

**Step 1: Render overdue badge in collapsed card footer**

In the collapsed card's checklist badge area (lines 1127–1131), extend to show the overdue count:

```tsx
{card.checklist && (
  <span className={`checklist-badge${card.checklist.checked === card.checklist.total ? ' checklist-done' : ''}`}>
    {card.checklist.checked}/{card.checklist.total}
  </span>
)}
{card.checklist && card.checklist.overdue && card.checklist.overdue > 0 && (
  <span className="checklist-overdue-badge">
    {card.checklist.overdue} overdue
  </span>
)}
```

**Step 2: Add badge CSS**

```css
.checklist-overdue-badge {
  font-size: 0.6rem;
  font-weight: 600;
  padding: 0.0625rem 0.375rem;
  border-radius: var(--radius-pill);
  background: var(--danger-subtle, #fef2f2);
  color: var(--danger);
  white-space: nowrap;
}
```

**Step 3: Commit**

```bash
git add client/src/components/KanbanCard.tsx client/src/index.css
git commit -m "feat: Show overdue subtask badge on collapsed cards"
```

---

### Task 7: Add Subtask Chips to Calendar View

**Files:**
- Modify: `client/src/components/CalendarView.tsx`
- Modify: `client/src/index.css`

**Step 1: Add "Show subtasks" toggle**

In the CalendarView navigation bar, add a toggle checkbox:

```tsx
const [showSubtasks, setShowSubtasks] = useState(false);

// In the nav bar:
<label className="calendar-subtask-toggle">
  <input type="checkbox" checked={showSubtasks} onChange={e => setShowSubtasks(e.target.checked)} />
  Show subtasks
</label>
```

**Step 2: Collect subtask chips for each date**

Build a list of checklist items with due dates from all board cards:

```typescript
const subtaskChips = useMemo(() => {
  if (!showSubtasks) return {};
  const byDate: Record<string, { item: ChecklistItem; cardTitle: string; cardId: string }[]> = {};

  board.columns?.forEach(col => {
    col.cards?.filter(c => !c.archived && filterCard(c)).forEach(card => {
      // Need to fetch checklist items — these come from the detail fetch,
      // not the board summary. For efficiency, only show subtasks if we
      // have them loaded (e.g., from a separate fetch or cached data).
      // Alternative: extend board fetch to include checklist items with due_date.
    });
  });

  return byDate;
}, [board, showSubtasks, filterCard]);
```

**Note:** For this to work without N+1 queries, the board fetch should be extended to include checklist items that have a `due_date`. Add a new query in `boards.ts` GET /:id:

```sql
SELECT ci.card_id, ci.id, ci.text, ci.checked, ci.due_date
FROM card_checklist_items ci
INNER JOIN cards c ON ci.card_id = c.id
INNER JOIN columns col ON c.column_id = col.id
WHERE col.board_id = $1 AND ci.due_date IS NOT NULL
```

Include these in the board response as `checklist_items_with_dates` and render them as subtask chips on the calendar.

**Step 3: Render subtask chips in day cells**

```tsx
{showSubtasks && subtaskChips[dateKey]?.map(({ item, cardTitle }) => (
  <div
    key={item.id}
    className={`calendar-subtask-chip${item.checked ? ' checked' : ''}`}
    onClick={() => onCardClick(/* parent card */)}
  >
    <span className="subtask-check">{item.checked ? '☑' : '☐'}</span>
    <span className="chip-title">{item.text}</span>
  </div>
))}
```

**Step 4: Add CSS**

```css
.calendar-subtask-toggle {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.calendar-subtask-chip {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.0625rem 0.25rem;
  font-size: 0.65rem;
  color: var(--text-secondary);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.calendar-subtask-chip:hover {
  background: var(--bg-raised);
}

.calendar-subtask-chip.checked {
  opacity: 0.5;
  text-decoration: line-through;
}

.subtask-check {
  font-size: 0.7rem;
}
```

**Step 5: Commit**

```bash
git add client/src/components/CalendarView.tsx server/src/routes/boards.ts client/src/index.css
git commit -m "feat: Add subtask chips to calendar view with toggle"
```

---

### Task 8: Extend Filter Bar for Overdue Subtasks

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx`

**Step 1: Add filter option**

In the existing `filterDue` dropdown (the due date filter around the filter bar), add a new option:

```tsx
<option value="overdue-subtasks">Has overdue subtasks</option>
```

**Step 2: Extend filterCard function**

In the `filterCard` function (lines 203–226), add a check for overdue subtasks:

```typescript
if (filterDue === 'overdue-subtasks') {
  if (!card.checklist?.overdue || card.checklist.overdue === 0) return false;
}
```

**Step 3: Commit**

```bash
git add client/src/components/KanbanBoard.tsx
git commit -m "feat: Add 'Has overdue subtasks' filter option"
```

---

### Task 9: Update API Client for New Checklist Fields

**Files:**
- Modify: `client/src/api.ts`

**Step 1: Verify updateChecklistItem accepts new fields**

The existing `api.updateChecklistItem` method passes through the data object to `PUT /api/checklist/:id`. Since it uses `body: JSON.stringify(data)`, the new fields (`assignee_name`, `due_date`, `priority`) are automatically included when passed. No code change needed — just ensure the TypeScript types allow the new fields.

If the method signature is restrictive, update it:

```typescript
async updateChecklistItem(id: string, data: Partial<{ checked: boolean; text: string; assignee_name: string | null; due_date: string | null; priority: string | null }>): Promise<ChecklistItem> {
  return this.fetch(`/checklist/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}
```

Similarly for `addChecklistItem`:

```typescript
async addChecklistItem(cardId: string, data: { text: string; assignee_name?: string; due_date?: string; priority?: string }): Promise<ChecklistItem> {
  return this.fetch(`/cards/${cardId}/checklist`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
```

**Step 2: Commit**

```bash
git add client/src/api.ts
git commit -m "feat: Update checklist API methods for new metadata fields"
```

---

### Task 10: Manual Testing Checklist

**No code changes — just verification.**

**Step 1: Test schema**
- Run migrations → `assignee_name`, `due_date`, `priority` columns exist on `card_checklist_items`
- CHECK constraint enforces valid priority values

**Step 2: Test API**
- `POST /api/cards/:id/checklist` with `{ text, assignee_name, due_date, priority }` → creates item with metadata
- `PUT /api/checklist/:id` with `{ assignee_name: "Alice" }` → updates assignee only
- `PUT /api/checklist/:id` with `{ priority: "invalid" }` → 400 error
- `GET /api/cards/:id/checklist` → items include new fields

**Step 3: Test card detail UI (admin)**
- Open card → checklist items show metadata row
- Click assignee chip → dropdown with board assignees, select one → saves
- Click date chip → date picker opens, select date → saves
- Click priority chip → cycles through none → low → medium → high → none
- Overdue items (date in past, unchecked) show red highlight

**Step 4: Test card detail UI (read-only)**
- Non-admin users see metadata chips but cannot interact
- No pickers open on click

**Step 5: Test collapsed card**
- Card with overdue checklist items shows "N overdue" badge
- Card with no overdue items → no badge
- Checking off an overdue item → badge count decreases

**Step 6: Test board fetch summary**
- `checklist` on card includes `overdue` count
- Count matches actual overdue items (due_date < today, unchecked)

**Step 7: Test calendar integration**
- Toggle "Show subtasks" → subtask chips appear on their due dates
- Checked items show strikethrough
- Click subtask chip → opens parent card

**Step 8: Test filter**
- Select "Has overdue subtasks" filter → only cards with overdue checklist items shown
- Cards with no overdue items hidden
