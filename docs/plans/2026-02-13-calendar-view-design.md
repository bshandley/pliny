# Calendar View Design

## Problem

The Kanban board has no way to visualize cards by date. Users can set due dates on cards, but there's no calendar overview. Users want to see what's due when, drag unscheduled cards onto dates, and move cards between dates.

## Design

### Navigation & URL Routing

Toggle icon buttons in the board header (columns icon / calendar icon). Active view is highlighted.

| URL | View |
|-----|------|
| `/my-board` | Kanban board (default) |
| `/my-board/calendar` | Calendar view |

App.tsx parses trailing `/calendar` on board slugs. A `viewMode` state (`'board' | 'calendar'`) is passed to KanbanBoard. Filter bar stays visible in both views.

### Month View

- CSS Grid with 7 columns (Sun-Sat)
- Sub-header with prev/next arrows, month/year label, "Today" button, and Month/Week toggle
- Cards shown as compact chips (title + column color indicator)
- 3+ cards on a day: show first 2 + "+N more" expandable
- Days outside current month shown grayed but still droppable
- Today highlighted with accent border/background
- Each day cell is a `Droppable` (type `"CALENDAR"`), cards are `Draggable`
- Dropping a card on a day calls `api.updateCard(id, { due_date })` and reloads

### Week View

- Same CSS Grid, 7 cells in one row, taller cells
- Navigation steps by week, sub-header shows date range (e.g. "Feb 9 - 15, 2026")
- Cards show more detail: title, column badge, due status
- Same DnD behavior as month view

### Unscheduled Sidebar

- Right side, collapsible. Header: "Unscheduled" + count badge + collapse toggle
- Shows all cards with no `due_date`, same compact chip style
- Scrollable, filtered by the existing filter bar
- Is a `Droppable` (type `"CALENDAR"`)
- Drag from sidebar to day: sets `due_date`
- Drag from day to sidebar: clears `due_date`
- Mobile: collapsible bottom sheet instead of side panel

### Card Popover

- Clicking a card on the calendar shows a read-only popover (not full edit form)
- Contents: title, column name, due date badge, assignees, labels, checklist progress, description preview (first 2 lines)
- "Open in Board" button at bottom: navigates to Kanban view and auto-opens that card
- Dismiss: click outside or Escape

### Files

**New:**
- `client/src/components/CalendarView.tsx` — month grid, week grid, navigation, card chips, popovers
- `client/src/components/UnscheduledSidebar.tsx` — collapsible sidebar with unscheduled cards

**Modified:**
- `client/src/App.tsx` — parse `/board-slug/calendar` URLs, pass `viewMode`
- `client/src/components/KanbanBoard.tsx` — view toggle buttons, conditionally render CalendarView vs columns, share DragDropContext, handle "Open in Board"
- `client/src/index.css` — calendar grid, card chips, popover, sidebar, week view, mobile bottom sheet

### What Stays the Same

- All existing Kanban board functionality
- Card data model (no schema changes — `due_date` already exists)
- API endpoints (existing `updateCard` with `due_date`)
- Filter bar works for both views
- Socket.IO real-time sync

### Key Interactions

| Action | Result |
|--------|--------|
| Drag card from sidebar to day | Sets `due_date` |
| Drag card from day to different day | Updates `due_date` |
| Drag card from day to sidebar | Clears `due_date` |
| Click card on calendar | Shows read-only popover |
| "Open in Board" in popover | Switches to Kanban, opens card |
| Month/Week toggle | Switches calendar granularity |
| Prev/Next arrows | Navigate month or week |
