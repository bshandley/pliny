# Timeline / Gantt View Design

## Problem

Project managers need to visualize card schedules as a timeline — seeing how tasks overlap, identifying scheduling gaps, and understanding project duration at a glance. The calendar view shows individual dates but doesn't convey task duration or dependencies. A Gantt-style timeline with horizontal bars representing start-to-end date ranges fills this gap.

## Design

### Schema Change (Migration 013)

Add `start_date` to cards:

```sql
ALTER TABLE cards ADD COLUMN start_date DATE NULL;
```

- `start_date` = when work begins
- `due_date` (existing) = when work ends / deadline
- Cards with both dates → rendered as duration bars
- Cards with only `due_date` → single-day marker (diamond/dot)
- Cards with only `start_date` → bar extending to "today" (open-ended)
- Cards with neither → appear in unscheduled sidebar

### API Changes

**Card update** (`PUT /api/cards/:id`): Accept `start_date` field. Activity log records `start_date_changed`.

**Board fetch** (`GET /boards/:id`): Card objects now include `start_date` in the response (already returned by `SELECT *`, just needs TypeScript type update).

### Navigation & URL Routing

Fourth icon in the view toggle group (board / calendar / table / timeline).

| URL | View |
|-----|------|
| `/my-board` | Kanban board (default) |
| `/my-board/calendar` | Calendar view |
| `/my-board/table` | Table view |
| `/my-board/timeline` | Timeline view |

App.tsx `boardViewMode` type extends to `'board' | 'calendar' | 'table' | 'timeline'`.

### Timeline Layout

**Structure:**
```
┌──────────────────────────────────────────────────┐
│  [←] [Today] [→]   February 2026   [Day|Wk|Mo]  │  ← Navigation bar
├──────────┬───────────────────────────────────────┤
│ Swimlane │  Time axis with gridlines             │
│ labels   │  ████ Card Bar ████                   │  ← Scrollable area
│          │       ██████ Card Bar ██████           │
│          │  ◆ Single-date marker                 │
├──────────┤───────────────────────────────────────┤
│ Group 2  │  ████████ Card Bar ████████           │
│          │  ██ Short ██                          │
└──────────┴───────────────────────────────────────┘
```

- Left panel: swimlane labels (fixed width, 180px)
- Right panel: scrollable time axis with card bars
- Time axis header: date labels (day numbers, week ranges, or month names depending on zoom)
- Vertical gridlines on day/week/month boundaries
- Today line: red vertical line marking current date

### Zoom Levels

Toggle in the navigation bar:

| Zoom | Column width | Visible range | Grid lines |
|------|-------------|---------------|------------|
| Day | 40px per day | ~3 weeks | Per day |
| Week | 120px per week | ~3 months | Per week |
| Month | 160px per month | ~1 year | Per month |

Default: Week zoom. Auto-scroll to center on today.

### Card Bars

Each card renders as a horizontal bar:
- Background color: column color (or primary color if no column color)
- Height: 28px
- Text: card title (truncated with ellipsis)
- Left edge: `start_date` position on timeline
- Right edge: `due_date` position on timeline
- Hover tooltip: full title, dates, assignees
- Click: opens card popover (same pattern as calendar view)
- Single-date markers (only `due_date`): diamond shape, 12px

**Bar overflow:**
- If a card bar extends beyond the visible area, it clips at the edges
- Multiple cards in the same swimlane row stack vertically (auto height)

### Grouping (Swimlanes)

Default: group by column (status). Options in toolbar:

| Group By | Swimlane labels | Sort |
|----------|----------------|------|
| Column | Column names | Column position order |
| Assignee | Assignee names + "Unassigned" | Alphabetical |
| Label | Label names + "No label" | Alphabetical |
| None | Single flat list | Card position |

Each swimlane:
- Collapsible (click header to toggle)
- Shows card count in header
- Cards sorted by start_date within swimlane

### Drag Interactions (Admin Only)

Two drag types:

**Move bar**: Drag the bar body to shift both start_date and due_date by the same offset (preserves duration).
- Visual feedback: ghost bar follows cursor, snap to day boundaries
- On drop: `PUT /api/cards/:id` with updated start_date and due_date

**Resize bar**: Drag the left or right edge to change start_date or due_date independently.
- Left edge drag: changes start_date
- Right edge drag: changes due_date
- Minimum duration: 1 day (can't make end before start)
- Visual feedback: bar stretches/shrinks, cursor changes to col-resize

### Unscheduled Sidebar

Same pattern as calendar view — right sidebar showing cards with no dates:
- Reuses `UnscheduledSidebar` component (or variant)
- Cards with neither start_date nor due_date
- Drag from sidebar to timeline: sets start_date to the drop position day, due_date to start_date + 1 day
- Collapsible

### Mobile Behavior

On mobile (≤768px):
- Timeline is not practical at small sizes
- Show a simplified **date range list** instead:
  - Cards grouped by swimlane
  - Each card shows: title, date range ("Feb 10 – Feb 14"), column badge
  - Sorted by start_date
  - Tap card → same card popover as calendar
- No horizontal scrolling or bar rendering on mobile

### Files

**New:**
- `server/src/migrations/013-card-start-date.sql` — add start_date column
- `client/src/components/TimelineView.tsx` — timeline rendering, bars, axis, zoom, grouping
- `client/src/components/TimelineBar.tsx` — individual card bar with drag/resize

**Modified:**
- `server/src/routes/cards.ts` — accept start_date in update, log activity
- `server/src/routes/boards.ts` — start_date already returned by SELECT *, just TypeScript
- `client/src/App.tsx` — extend viewMode type and URL routing for `/timeline`
- `client/src/components/KanbanBoard.tsx` — render TimelineView, fourth view toggle icon
- `client/src/components/KanbanCard.tsx` — start_date display in card detail, date range editor
- `client/src/types.ts` — add start_date to Card type
- `client/src/api.ts` — accept start_date in updateCard
- `client/src/index.css` — timeline styles, bars, grid, axis, mobile list

### What Stays the Same

- Existing views (board, calendar, table) unchanged
- Due date behavior — `due_date` works exactly as before everywhere
- Card CRUD API — just extended to accept one new field
- Filter bar — `start_date` not filtered on initially (can be added later)
- DnD in board/calendar views unchanged

### Key Interactions

| Action | Result |
|--------|--------|
| Click timeline icon | Switch to timeline view |
| Scroll horizontally | Pan along the time axis |
| Click Day/Week/Month toggle | Zoom level changes, timeline redraws |
| Click Today button | Scroll to center on today's date |
| Click a bar | Card popover appears |
| Drag bar body | Move card's date range (preserves duration) |
| Drag bar left edge | Change start_date |
| Drag bar right edge | Change due_date |
| Drag from unscheduled sidebar | Place card on timeline with 1-day duration |
| Click swimlane header | Collapse/expand that group |
| Change "Group by" | Swimlanes reorganize |
