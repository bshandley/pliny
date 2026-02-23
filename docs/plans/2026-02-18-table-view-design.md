# Table View Design

## Problem

The Kanban board is great for workflow visualization, but when users need to scan many cards quickly, compare values across cards, or bulk-edit properties, a spreadsheet-like table view is more efficient. Power users managing 50+ cards per board need sorting, grouping, and fast inline editing.

## Design

### Navigation & URL Routing

Third icon in the view toggle group (board / calendar / table). Active view is highlighted.

| URL | View |
|-----|------|
| `/my-board` | Kanban board (default) |
| `/my-board/calendar` | Calendar view |
| `/my-board/table` | Table view |

App.tsx `boardViewMode` type extends to `'board' | 'calendar' | 'table'`. The `resolveUrlRoute` function detects `/table` suffix the same way it detects `/calendar`.

### Table Columns

Default columns (always visible):

| Column | Width | Content |
|--------|-------|---------|
| Title | flex | Card title (editable) |
| Status | 140px | Column name (dropdown to move card) |
| Assignees | 160px | Comma-separated names (editable) |
| Due Date | 120px | Date display (date picker) |
| Labels | 160px | Label pills |

Additional columns (toggleable via column picker):
- Description (text, 200px)
- Custom Fields (one column per field, from Feature 1 — type-appropriate display)
- Created | Updated (date, 120px)

### Column Picker

Small button (columns icon) in the table toolbar opens a dropdown checklist of available columns. Toggling a column adds/removes it from the table. Column visibility is stored in localStorage per board.

### Sorting

- Click any column header to sort ascending
- Click again to sort descending
- Click a third time to clear sort
- Sort indicator arrow (▲/▼) shown in active header
- Multi-column sort: hold Shift + click for secondary sort (up to 3 levels)
- Default: sorted by column (status) position, then card position within column

### Inline Editing (Admin Only)

Click a cell to enter edit mode:

| Column | Editor | Behavior |
|--------|--------|----------|
| Title | Text input | Save on blur or Enter |
| Status | Dropdown | Options = board columns, selecting moves card |
| Assignees | Multi-select dropdown | Board assignees list |
| Due Date | Native date picker | `<input type="date">` |
| Labels | Checkbox dropdown | Board labels with color dots |
| Description | Textarea (expanding) | Save on blur |
| Custom Fields | Type-specific (see Custom Fields design) | Save on blur/change |

Non-admin users see read-only cells. Collaborators see read-only cells.

### Row Grouping

Rows are grouped by column (status) by default:
- Group headers show column name + card count
- Groups are collapsible (click to toggle)
- Group order matches column position order
- Drag cards between groups = move to that column (same as changing Status dropdown)

Optional grouping by:
- Assignee (one group per assignee + "Unassigned")
- Label (one group per label + "No label")
- None (flat list)

Group selector in table toolbar.

### Filtering

Reuses the existing filter bar (same `filterCard` function). The filter bar renders above the table, same as it does above the board and calendar views.

When Custom Fields (Feature 1) are implemented, custom field filters automatically work in table view since they extend the shared `filterCard`.

### Row Selection & Bulk Actions (Future)

Not in initial implementation. Design placeholder: checkbox column on left, bulk action bar at top (move, assign, delete). This can be added later without schema changes.

### Keyboard Navigation (Future)

Not in initial implementation. Arrow keys to navigate cells, Enter to edit, Escape to cancel. Tab to move between cells.

### No Schema Changes

Table view reads the same board data from `GET /boards/:id`. No new API endpoints needed. Inline edits use existing card update endpoints (`PUT /api/cards/:id`).

### Files

**New:**
- `client/src/components/TableView.tsx` — table rendering, sorting, grouping, column picker
- `client/src/components/TableCell.tsx` — type-specific inline editors per column type

**Modified:**
- `client/src/App.tsx` — extend viewMode type and URL routing for `/table`
- `client/src/components/KanbanBoard.tsx` — render TableView when viewMode is 'table', third view toggle icon
- `client/src/index.css` — table styles, cell editors, group headers, responsive

### Mobile Behavior

On mobile (≤768px):
- Table scrolls horizontally with sticky first column (Title)
- Cell tap opens a full-width editor overlay (same portal pattern as mobile card editing)
- Group headers remain full-width
- Column picker hidden — mobile shows Title, Status, Due Date only (fixed set)

### What Stays the Same

- All existing views (board, calendar) unchanged
- Board data fetching (single GET, no new endpoints)
- Card update API (`PUT /api/cards/:id`)
- Filter bar logic (shared `filterCard` function)
- Socket.IO real-time sync (table refreshes on board-updated events)

### Key Interactions

| Action | Result |
|--------|--------|
| Click table icon in view toggle | Switch to table view, URL changes to `/board-slug/table` |
| Click column header | Sort by that column (toggle asc/desc/none) |
| Click cell (admin) | Inline editor opens for that field |
| Change Status dropdown | Card moves to selected column |
| Click group header | Toggle group collapse |
| Select "Group by: Assignee" | Rows regroup by assignee |
| Toggle column in column picker | Column added/removed from table |
| Filter bar active | Table rows filtered (same as board/calendar) |
