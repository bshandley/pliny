# Table View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a spreadsheet-like table view to boards with sortable columns, row grouping by status/assignee/label, inline editing for admins, and a column picker — all using existing board data with no schema changes.

**Architecture:** A new `TableView` component renders board cards as table rows using a `<table>` with sticky headers. A `TableCell` component handles type-specific inline editors (text, dropdown, date, multi-select). App.tsx routing is extended so `/board-slug/table` loads the board in table mode. Sorting and grouping are client-side operations on the existing board data. Column visibility is persisted in localStorage per board.

**Tech Stack:** React, TypeScript, CSS (sticky positioning, CSS Grid for mobile), existing API (`api.updateCard`), localStorage.

---

### Task 1: Extend URL Routing for Table View Mode

**Files:**
- Modify: `client/src/App.tsx`

**Step 1: Update boardViewMode type**

Change the `boardViewMode` state type (line 48) from `'board' | 'calendar'` to `'board' | 'calendar' | 'table'`:

```tsx
const [boardViewMode, setBoardViewMode] = useState<'board' | 'calendar' | 'table'>('board');
```

**Step 2: Update resolveUrlRoute**

In the `resolveUrlRoute` function (lines 81–119), extend the suffix detection (around line 103) to also detect `/table`:

```tsx
let boardSlug = slug;
let resolvedViewMode: 'board' | 'calendar' | 'table' = 'board';
if (slug.endsWith('/calendar')) {
  boardSlug = slug.slice(0, -'/calendar'.length);
  resolvedViewMode = 'calendar';
} else if (slug.endsWith('/table')) {
  boardSlug = slug.slice(0, -'/table'.length);
  resolvedViewMode = 'table';
}
```

**Step 3: Update handleViewChange**

In `handleViewChange` (lines 353–359), update the URL path logic:

```tsx
const handleViewChange = (viewMode: 'board' | 'calendar' | 'table') => {
  if (!currentBoardId) return;
  const slug = getPathSlug().replace(/\/(calendar|table)$/, '');
  const suffix = viewMode === 'board' ? '' : '/' + viewMode;
  const path = '/' + slug + suffix;
  setBoardViewMode(viewMode);
  window.history.pushState({ page: 'board', boardId: currentBoardId, viewMode }, '', path);
};
```

**Step 4: Update popstate handler**

In `handlePopState`, ensure the viewMode restoration handles the new type (the existing `state.viewMode ?? 'board'` already covers this if the type is updated).

**Step 5: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: Extend URL routing for table view mode"
```

---

### Task 2: Add Table View Toggle Icon to KanbanBoard Header

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx`

**Step 1: Update props type**

Update the `viewMode` prop type in KanbanBoardProps and the destructuring:

```tsx
viewMode: 'board' | 'calendar' | 'table';
onViewChange: (mode: 'board' | 'calendar' | 'table') => void;
```

**Step 2: Add third toggle button**

In the `.view-toggle` div (lines 503–522), add a table icon button after the calendar button:

```tsx
<button
  className={`btn-icon view-toggle-btn${viewMode === 'table' ? ' active' : ''}`}
  onClick={() => onViewChange('table')}
  title="Table view"
>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M3 9h18M3 15h18M9 3v18"/>
  </svg>
</button>
```

**Step 3: Conditionally render TableView**

Extend the view conditional (lines 637–649) to include table view:

```tsx
{viewMode === 'calendar' ? (
  <div className="calendar-layout">
    <CalendarView ... />
  </div>
) : viewMode === 'table' ? (
  <TableView
    board={board}
    filterCard={filterCard}
    isAdmin={isAdmin}
    onCardUpdate={() => { loadBoard(); }}
    onCardClick={(cardId) => setEditingCardId(cardId)}
  />
) : (
  <Droppable ...>
    {/* board columns */}
  </Droppable>
)}
```

**Step 4: Commit**

```bash
git add client/src/components/KanbanBoard.tsx
git commit -m "feat: Add table view toggle and conditional rendering"
```

---

### Task 3: Create TableView Component — Table Structure and Rendering

**Files:**
- Create: `client/src/components/TableView.tsx`
- Modify: `client/src/index.css`

**Step 1: Create TableView.tsx**

```typescript
import { useState, useMemo } from 'react';
import { Board, Card, Column } from '../types';
import TableCell from './TableCell';

interface TableViewProps {
  board: Board;
  filterCard: (card: Card) => boolean;
  isAdmin: boolean;
  onCardUpdate: () => void;
  onCardClick: (cardId: string) => void;
}

type SortDir = 'asc' | 'desc' | null;
type GroupBy = 'column' | 'assignee' | 'label' | 'none';

interface ColumnDef {
  key: string;
  label: string;
  width: string;
  visible: boolean;
}
```

**Default columns:**

```typescript
const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'title', label: 'Title', width: 'flex', visible: true },
  { key: 'status', label: 'Status', width: '140px', visible: true },
  { key: 'assignees', label: 'Assignees', width: '160px', visible: true },
  { key: 'due_date', label: 'Due Date', width: '120px', visible: true },
  { key: 'labels', label: 'Labels', width: '160px', visible: true },
  { key: 'description', label: 'Description', width: '200px', visible: false },
];
```

**Column visibility from localStorage:**

```typescript
const storageKey = `table-columns-${board.id}`;
const [columns, setColumns] = useState<ColumnDef[]>(() => {
  const saved = localStorage.getItem(storageKey);
  return saved ? JSON.parse(saved) : DEFAULT_COLUMNS;
});
```

**Flattened card list with column info:**

```typescript
const allCards = useMemo(() => {
  const result: { card: Card; column: Column }[] = [];
  board.columns?.forEach(col => {
    col.cards?.filter(c => !c.archived && filterCard(c)).forEach(card => {
      result.push({ card, column: col });
    });
  });
  return result;
}, [board, filterCard]);
```

**Sorting logic:**

```typescript
const [sortKey, setSortKey] = useState<string | null>(null);
const [sortDir, setSortDir] = useState<SortDir>(null);

const handleSort = (key: string) => {
  if (sortKey === key) {
    if (sortDir === 'asc') setSortDir('desc');
    else if (sortDir === 'desc') { setSortKey(null); setSortDir(null); }
  } else {
    setSortKey(key);
    setSortDir('asc');
  }
};

const sortedCards = useMemo(() => {
  if (!sortKey || !sortDir) return allCards;
  return [...allCards].sort((a, b) => {
    let aVal: any, bVal: any;
    switch (sortKey) {
      case 'title': aVal = a.card.title; bVal = b.card.title; break;
      case 'status': aVal = a.column.position; bVal = b.column.position; break;
      case 'assignees': aVal = (a.card.assignees || []).join(','); bVal = (b.card.assignees || []).join(','); break;
      case 'due_date': aVal = a.card.due_date || ''; bVal = b.card.due_date || ''; break;
      default: aVal = ''; bVal = '';
    }
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });
}, [allCards, sortKey, sortDir]);
```

**Grouping logic:**

```typescript
const [groupBy, setGroupBy] = useState<GroupBy>('column');

const groups = useMemo(() => {
  if (groupBy === 'none') return [{ label: 'All cards', cards: sortedCards }];

  const map = new Map<string, { card: Card; column: Column }[]>();

  sortedCards.forEach(item => {
    let keys: string[];
    switch (groupBy) {
      case 'column': keys = [item.column.name]; break;
      case 'assignee': keys = item.card.assignees?.length ? item.card.assignees : ['Unassigned']; break;
      case 'label': keys = item.card.labels?.length ? item.card.labels.map(l => l.name) : ['No label']; break;
      default: keys = ['Other'];
    }
    keys.forEach(k => {
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(item);
    });
  });

  return Array.from(map.entries()).map(([label, cards]) => ({ label, cards }));
}, [sortedCards, groupBy]);
```

**JSX render:**

```tsx
return (
  <div className="table-view">
    <div className="table-toolbar">
      <div className="table-group-selector">
        <label>Group by:</label>
        <select value={groupBy} onChange={e => setGroupBy(e.target.value as GroupBy)}>
          <option value="column">Status</option>
          <option value="assignee">Assignee</option>
          <option value="label">Label</option>
          <option value="none">None</option>
        </select>
      </div>
      <button className="btn-secondary btn-sm" onClick={() => setShowColumnPicker(!showColumnPicker)}>
        Columns
      </button>
      {showColumnPicker && (/* column picker dropdown */)}
    </div>

    <div className="table-scroll">
      <table className="board-table">
        <thead>
          <tr>
            {visibleColumns.map(col => (
              <th
                key={col.key}
                style={{ width: col.width === 'flex' ? undefined : col.width }}
                className={`table-header${sortKey === col.key ? ` sorted-${sortDir}` : ''}`}
                onClick={() => handleSort(col.key)}
              >
                {col.label}
                {sortKey === col.key && <span className="sort-arrow">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(group => (
            <GroupRows key={group.label} group={group} ... />
          ))}
        </tbody>
      </table>
    </div>
  </div>
);
```

**Step 2: Add table CSS**

```css
/* ---- Table View ---- */

.table-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0 1rem 1rem;
}

.table-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0;
  flex-shrink: 0;
}

.table-group-selector {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.8rem;
}

.table-group-selector select {
  font-size: 0.8rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--text);
}

.table-scroll {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.board-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}

.board-table thead {
  position: sticky;
  top: 0;
  z-index: 2;
}

.board-table th {
  background: var(--bg-raised);
  padding: 0.5rem 0.75rem;
  text-align: left;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.board-table th:hover {
  color: var(--text);
}

.sort-arrow {
  font-size: 0.65rem;
}

.board-table td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.85rem;
  vertical-align: middle;
}

.board-table tr:last-child td {
  border-bottom: none;
}

.board-table tr:hover td {
  background: var(--bg-raised);
}

.table-group-header {
  background: var(--bg);
  font-weight: 600;
  font-size: 0.8rem;
  cursor: pointer;
  user-select: none;
}

.table-group-header td {
  padding: 0.625rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

.table-group-count {
  color: var(--text-secondary);
  font-weight: 400;
  margin-left: 0.5rem;
}

.table-title-cell {
  font-weight: 500;
  cursor: pointer;
}

.table-title-cell:hover {
  color: var(--primary);
}

.table-status-badge {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: var(--radius-pill);
  background: var(--bg-raised);
  font-size: 0.75rem;
  font-weight: 500;
}

.table-label-pill {
  display: inline-block;
  padding: 0.0625rem 0.375rem;
  border-radius: var(--radius-pill);
  font-size: 0.65rem;
  font-weight: 600;
  color: white;
  margin-right: 0.25rem;
}

.table-due-cell {
  font-size: 0.8rem;
}

.table-due-cell.overdue {
  color: var(--danger);
  font-weight: 500;
}
```

**Step 3: Commit**

```bash
git add client/src/components/TableView.tsx client/src/index.css
git commit -m "feat: Create TableView component with sorting and grouping"
```

---

### Task 4: Create TableCell Component — Inline Editors

**Files:**
- Create: `client/src/components/TableCell.tsx`
- Modify: `client/src/index.css`

**Step 1: Create TableCell.tsx**

Each cell type has a display mode and an edit mode (triggered by click, admin only):

```typescript
import { useState, useRef, useEffect } from 'react';
import { Card, Column, Label } from '../types';
import { api } from '../api';

interface TableCellProps {
  card: Card;
  column: Column;
  field: string;
  isAdmin: boolean;
  boardColumns: Column[];
  boardLabels: Label[];
  onUpdate: () => void;
}
```

**Type-specific editors:**

- **Title**: Text input, save on blur or Enter. `api.updateCard(card.id, { title })`
- **Status**: `<select>` with board columns as options. Selecting moves card: `api.updateCard(card.id, { column_id: newColumnId })`
- **Assignees**: Comma-separated display. Click → text input for editing. `api.updateCard(card.id, { assignees })`
- **Due Date**: Display as "Mon DD" format. Click → `<input type="date">`. `api.updateCard(card.id, { due_date })`
- **Labels**: Label pills display. Click → checkbox dropdown with board labels.
- **Description**: Truncated text display. Click → expanding textarea. Save on blur.

**Edit mode pattern:**

```tsx
const [editing, setEditing] = useState(false);
const inputRef = useRef<HTMLInputElement>(null);

useEffect(() => {
  if (editing && inputRef.current) inputRef.current.focus();
}, [editing]);

// Display mode
if (!editing) {
  return (
    <td onClick={() => isAdmin && setEditing(true)} className="table-cell">
      {/* display value */}
    </td>
  );
}

// Edit mode
return (
  <td className="table-cell editing">
    <input ref={inputRef} ... onBlur={handleSave} onKeyDown={e => e.key === 'Enter' && handleSave()} />
  </td>
);
```

**Step 2: Add cell editor CSS**

```css
/* ---- Table Cell Editors ---- */

.table-cell {
  cursor: default;
}

.table-cell.editable:hover {
  background: var(--primary-subtle);
  cursor: pointer;
}

.table-cell.editing {
  padding: 0.25rem;
}

.table-cell-input {
  width: 100%;
  font-size: 0.85rem;
  padding: 0.25rem 0.5rem;
  border: 2px solid var(--primary);
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  color: var(--text);
  outline: none;
}

.table-cell-select {
  width: 100%;
  font-size: 0.85rem;
  padding: 0.25rem 0.375rem;
  border: 2px solid var(--primary);
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  color: var(--text);
}
```

**Step 3: Commit**

```bash
git add client/src/components/TableCell.tsx client/src/index.css
git commit -m "feat: Create TableCell component with inline editors"
```

---

### Task 5: Add Column Picker Dropdown

**Files:**
- Modify: `client/src/components/TableView.tsx`
- Modify: `client/src/index.css`

**Step 1: Add column picker state and UI**

```typescript
const [showColumnPicker, setShowColumnPicker] = useState(false);

const toggleColumn = (key: string) => {
  const updated = columns.map(c => c.key === key ? { ...c, visible: !c.visible } : c);
  setColumns(updated);
  localStorage.setItem(storageKey, JSON.stringify(updated));
};

const visibleColumns = columns.filter(c => c.visible);
```

**Column picker dropdown:**

```tsx
{showColumnPicker && (
  <div className="column-picker-dropdown">
    {columns.map(col => (
      <label key={col.key} className="column-picker-item">
        <input
          type="checkbox"
          checked={col.visible}
          onChange={() => toggleColumn(col.key)}
          disabled={col.key === 'title'} // Title always visible
        />
        {col.label}
      </label>
    ))}
  </div>
)}
```

**Step 2: Add CSS**

```css
.column-picker-dropdown {
  position: absolute;
  right: 0;
  top: 100%;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 0.5rem;
  z-index: 10;
  min-width: 160px;
}

.column-picker-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  font-size: 0.8rem;
  cursor: pointer;
  border-radius: var(--radius-sm);
}

.column-picker-item:hover {
  background: var(--bg-raised);
}
```

**Step 3: Commit**

```bash
git add client/src/components/TableView.tsx client/src/index.css
git commit -m "feat: Add column picker for table view"
```

---

### Task 6: Mobile Responsiveness

**Files:**
- Modify: `client/src/index.css`

**Step 1: Add mobile table styles**

In the existing `@media (max-width: 768px)` block:

```css
/* Table mobile */
.table-scroll {
  -webkit-overflow-scrolling: touch;
}

.board-table th:first-child,
.board-table td:first-child {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--card-bg);
  border-right: 1px solid var(--border);
}

.board-table thead th:first-child {
  background: var(--bg-raised);
  z-index: 3;
}

.table-toolbar {
  flex-wrap: wrap;
  gap: 0.5rem;
}
```

On mobile, the table shows only Title, Status, and Due Date columns (hide others via media query or JS check for `isMobile`).

**Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "style: Add mobile responsiveness for table view"
```

---

### Task 7: Manual Testing Checklist

**No code changes — just verification.**

**Step 1: Test view toggle and URL routing**
- Click table icon in view toggle → table view renders, URL changes to `/board-slug/table`
- Direct URL `/board-slug/table` → table loads
- Browser back/forward between board/calendar/table works
- View toggle shows three icons with correct active state

**Step 2: Test table rendering**
- All non-archived cards appear as rows
- Cards grouped by column (default) with group headers
- Group headers show card count
- Click group header → collapses/expands

**Step 3: Test sorting**
- Click Title header → sort ascending alphabetically
- Click again → descending
- Click again → clear sort
- Sort arrow indicator shows correctly
- Sort works for Status, Due Date, Assignees

**Step 4: Test inline editing (admin)**
- Click title cell → text input appears, edit, blur → saves
- Click status cell → dropdown with columns, select → card moves
- Click due date cell → date picker, select → date updates
- Click labels cell → label checkbox dropdown
- Non-admin users: cells are not editable

**Step 5: Test grouping**
- "Group by: Assignee" → rows grouped by assignee + "Unassigned"
- "Group by: Label" → rows grouped by label + "No label"
- "Group by: None" → flat list

**Step 6: Test column picker**
- Click "Columns" button → dropdown with checkboxes
- Toggle Description off → column hidden
- Toggle Description on → column reappears
- Reload page → column visibility persisted (localStorage)

**Step 7: Test mobile**
- Table scrolls horizontally
- Title column sticks to left edge
- Reduced column set on small screens
- Cell tap opens editor
