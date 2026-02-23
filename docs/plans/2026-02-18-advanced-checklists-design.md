# Advanced Checklists / Subtasks Design

## Problem

Current checklists are simple text + checkbox. Teams need subtasks with ownership, deadlines, and priority. "Fix login bug" might have sub-items assigned to different people with different due dates. Without this, teams track subtask details externally or create separate cards for what should be sub-items.

## Design

### Schema Change (Migration 014)

Add three columns to `card_checklist_items`:

```sql
ALTER TABLE card_checklist_items ADD COLUMN assignee_name VARCHAR(100) NULL;
ALTER TABLE card_checklist_items ADD COLUMN due_date DATE NULL;
ALTER TABLE card_checklist_items ADD COLUMN priority VARCHAR(10) NULL;

ALTER TABLE card_checklist_items ADD CONSTRAINT chk_priority
  CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high'));
```

**Assignee source**: Board assignees (string names), consistent with how card assignees work. No FK constraint — same loose coupling as `card_assignees`.

**Priority values**: `low`, `medium`, `high`, or NULL (unset). CHECK constraint enforces valid values.

### API Changes

**Checklist endpoints** (existing, extended):

`POST /api/cards/:cardId/checklist` — accepts optional `assignee_name`, `due_date`, `priority` in request body.

`PUT /api/checklist/:id` — accepts optional `assignee_name`, `due_date`, `priority` alongside existing `checked` and `text`.

`GET /api/cards/:cardId/checklist` — response includes new fields on each item.

**Board fetch enhancement** (`GET /boards/:id`):
- Existing checklist summary on each card: `{ total, checked }`
- Enhanced to: `{ total, checked, overdue }` — where `overdue` counts items with `due_date < today AND checked = false`

### UI: Card Detail View

Each checklist item row expands from simple `[☑] Task text` to:

```
┌──────────────────────────────────────────────────┐
│ [☑] Fix the login validation bug                 │
│     👤 Alice  📅 Feb 20  🔴 High    [⋮]        │
└──────────────────────────────────────────────────┘
```

**Item row layout:**
- Row 1: checkbox + text (existing, unchanged)
- Row 2 (metadata): assignee chip + due date chip + priority chip + kebab menu
- Metadata row only shows when at least one property is set, or when hovering (admin)
- Clicking any chip opens an inline picker

**Assignee picker:**
- Small dropdown listing board assignees
- Search/filter if > 5 assignees
- "Unassign" option to clear
- Selecting an assignee saves immediately (PUT)

**Due date picker:**
- Native `<input type="date">` (same pattern as card due_date and calendar mobile kebab)
- On mobile: triggers `showPicker()` for native date selector
- "Remove date" option to clear
- Overdue dates highlighted in red

**Priority selector:**
- Three-option toggle: Low (gray/blue), Medium (yellow/orange), High (red)
- Click to cycle or use dropdown
- Visual indicators:
  - Low: subtle gray dot or no indicator
  - Medium: orange dot
  - High: red dot + bold text

**Kebab menu per item (admin only):**
- Set assignee
- Set due date
- Set priority
- Delete item

### UI: Collapsed Card Display

Current: progress bar showing `checked/total`.

Enhanced:
- Progress bar remains
- If any checklist items are overdue: red badge with overdue count (e.g., "2 overdue")
- Badge appears next to the progress indicator

```
[████████░░] 6/10  ⚠ 2 overdue
```

### Calendar Integration

Checklist items with `due_date` appear in the calendar view as distinct chips:
- Styled differently from card chips: smaller, dashed border or italic text
- Show as: "☐ Item text" (or "☑" if checked)
- Clicking opens the parent card
- Filter: checkbox in calendar toolbar "Show subtasks" (default: off, to avoid clutter)

### Table View Integration

When Table View (Feature 2) is implemented:
- Subtask due dates visible in a "Subtasks" column showing `checked/total (N overdue)`
- No inline editing of subtasks from table view — click to open card

### Filtering

Extended filter bar:
- New filter option: "Has overdue subtasks" — shows only cards with overdue checklist items
- This is a boolean filter in the due date filter dropdown (add option alongside "Overdue", "Due soon", "No date")

### Files

**New:**
- `server/src/migrations/014-advanced-checklists.sql` — add columns + constraint

**Modified:**
- `server/src/routes/checklists.ts` — accept/return new fields in POST, PUT, GET
- `server/src/routes/boards.ts` — enhance checklist summary to include overdue count
- `client/src/types.ts` — update ChecklistItem type with assignee_name, due_date, priority
- `client/src/components/KanbanCard.tsx` — checklist item metadata row, pickers, collapsed overdue badge
- `client/src/components/KanbanBoard.tsx` — extend filterCard for overdue subtasks
- `client/src/components/CalendarView.tsx` — render subtask chips, "Show subtasks" toggle
- `client/src/api.ts` — update checklist API methods to include new fields
- `client/src/index.css` — checklist metadata styles, priority indicators, overdue badges

### What Stays the Same

- Checklist item creation flow (add text, optionally set properties after)
- Checkbox toggle behavior
- Checklist item reordering (by position)
- Card-level due date (separate from subtask due dates)
- Existing checklist progress display (enhanced, not replaced)

### Key Interactions

| Action | Result |
|--------|--------|
| Admin clicks assignee chip on subtask | Dropdown with board assignees, select to assign |
| Admin clicks date chip on subtask | Date picker opens, select date |
| Admin clicks priority indicator | Cycles through low/medium/high/none |
| Subtask due date passes | Item shows red highlight, card shows overdue badge |
| User views calendar with "Show subtasks" on | Subtask chips appear on their due dates |
| User filters "Has overdue subtasks" | Only cards with overdue items shown |
| Non-admin views subtask | Sees metadata (read-only), cannot edit |
| Subtask checked off | Overdue status clears, progress bar updates |
