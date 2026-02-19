# Dashboard / Reporting View Design

## Problem

Board admins have no way to see aggregate metrics about their boards. How many cards are overdue? What's the workload distribution across assignees? How fast are cards moving through the pipeline? Without analytics, managers rely on manual counting and guesswork.

## Design

### Scope

Per-board analytics, accessible as a fifth view mode. Not a global cross-board dashboard (that can come later). All metrics computed server-side from existing tables — no new schema.

### Navigation & URL Routing

Fifth icon in the view toggle group (board / calendar / table / timeline / chart icon).

| URL | View |
|-----|------|
| `/my-board/dashboard` | Dashboard view |

App.tsx `boardViewMode` type extends to include `'dashboard'`.

### API Endpoint

```
GET /api/boards/:boardId/analytics?days=30
```

Requires authentication. Available to all authenticated board members (not admin-only — read-only users can view analytics).

**Query parameters:**
- `days`: 7, 30, 90, or 0 (all time). Default: 30.

**Response:**

```json
{
  "period": { "days": 30, "start": "2026-01-19", "end": "2026-02-18" },
  "summary": {
    "total_cards": 47,
    "completed_cards": 12,
    "overdue_cards": 5,
    "avg_cycle_time_days": 4.2
  },
  "cards_by_column": [
    { "column_id": "...", "column_name": "To Do", "count": 15, "position": 0 },
    { "column_id": "...", "column_name": "In Progress", "count": 20, "position": 1 },
    { "column_id": "...", "column_name": "Done", "count": 12, "position": 2 }
  ],
  "cards_by_assignee": [
    { "assignee": "Alice", "total": 14, "completed": 5 },
    { "assignee": "Bob", "total": 10, "completed": 3 },
    { "assignee": "Unassigned", "total": 23, "completed": 4 }
  ],
  "cards_by_label": [
    { "label_id": "...", "label_name": "Bug", "label_color": "#e53e3e", "count": 8 },
    { "label_id": "...", "label_name": "Feature", "label_color": "#3182ce", "count": 15 }
  ],
  "cards_over_time": [
    { "date": "2026-01-19", "created": 3, "completed": 1 },
    { "date": "2026-01-20", "created": 0, "completed": 2 }
  ],
  "cycle_time_distribution": [
    { "range": "< 1 day", "count": 3 },
    { "range": "1-3 days", "count": 8 },
    { "range": "3-7 days", "count": 5 },
    { "range": "1-2 weeks", "count": 2 },
    { "range": "> 2 weeks", "count": 1 }
  ]
}
```

### Metrics Computation

All computed from existing tables:

**Total / completed cards**: Count non-archived cards. "Completed" = cards in the last column (highest position). Filtered to cards created/moved within the date range.

**Overdue cards**: Cards with `due_date < today` that are NOT in the last column.

**Average cycle time**: For cards that reached the last column within the date range, compute `completed_at - created_at` from `card_activity` table (find the `column_changed` entry where the destination is the last column). Average in days.

**Cards by column**: Simple `GROUP BY column_id` count of non-archived cards.

**Cards by assignee**: Join `card_assignees` with cards, count total and completed per assignee. Cards with no assignees go to "Unassigned".

**Cards by label**: Join `card_labels` with cards, count per label.

**Cards over time**: For each day in the range, count cards created (from `cards.created_at`) and completed (from `card_activity` where action = `column_changed` to last column).

**Cycle time distribution**: Bucket completed cards by how long they took.

### UI Layout

```
┌─────────────────────────────────────────────────┐
│  Dashboard   [7d] [30d] [90d] [All]             │  ← Date range selector
├────────┬────────┬────────┬──────────────────────┤
│ Total  │ Done   │Overdue │ Avg Cycle Time       │  ← Summary stat cards
│  47    │  12    │   5    │   4.2 days           │
├────────┴────────┴────────┴──────────────────────┤
│                                                  │
│  Cards by Status          Cards by Assignee      │  ← Charts row 1
│  ██████████ To Do (15)    ████████ Alice (14)    │
│  █████████████ In P (20)  ██████ Bob (10)        │
│  ████████ Done (12)       █████████████ ? (23)   │
│                                                  │
├──────────────────────────────────────────────────┤
│                                                  │
│  Created vs Completed     Cards by Label         │  ← Charts row 2
│  ┃ ■ ■   ■               ████████ Bug (8)       │
│  ┃■ ■ ■ ■ ■ □            ████████████ Feat (15) │
│  ┗━━━━━━━━━━━             Cycle Time Distrib.    │
│                           ████ <1d (3)           │
│                           ██████████ 1-3d (8)    │
│                                                  │
└──────────────────────────────────────────────────┘
```

### Chart Implementation

**CSS-only bar charts** — no external charting library:
- Horizontal bars with percentage-based widths (`width: calc(count / max * 100%)`)
- Bar color matches the data (column colors, assignee colors, label colors)
- Bar labels: name on left, count on right
- Responsive: bars stack in single column on mobile

**Created vs Completed over time:**
- CSS-only stacked bar chart or simple line approximation
- X-axis: dates (grouped by day for 7d, by week for 30d/90d, by month for All)
- Two series: created (blue bars) and completed (green bars)
- If > 30 data points, aggregate to weekly

### Date Range Selector

Row of toggle buttons: `7d | 30d | 90d | All`
- Default: 30d
- Clicking re-fetches analytics with new `days` parameter
- Active button highlighted (same style as Month/Week toggle in calendar)

### Summary Stat Cards

Four cards in a row:
- Total Cards — count with neutral background
- Completed — count with green accent
- Overdue — count with red accent (0 = green)
- Avg Cycle Time — days with neutral background

Each card: large number, small label below.

### No Schema Changes

All data computed from existing tables:
- `cards` — title, column_id, due_date, archived, created_at
- `card_activity` — action, detail (column_changed with from/to), created_at
- `card_assignees` — card_id, assignee_name
- `card_labels` — card_id, label_id
- `board_labels` — label colors and names
- `columns` — names and positions

### Files

**New:**
- `server/src/routes/analytics.ts` — analytics endpoint with SQL queries
- `client/src/components/DashboardView.tsx` — layout, stat cards, charts, date range selector

**Modified:**
- `server/src/index.ts` — mount analytics routes
- `client/src/App.tsx` — extend viewMode for `/dashboard`
- `client/src/components/KanbanBoard.tsx` — render DashboardView, fifth view toggle icon
- `client/src/api.ts` — add `getBoardAnalytics(boardId, days)` method
- `client/src/index.css` — dashboard layout, stat cards, bar charts, responsive

### Mobile Behavior

On mobile (≤768px):
- Stat cards: 2×2 grid instead of 4 across
- Charts: single column stack, full width
- Date range buttons: horizontally scrollable if needed
- Bar charts remain readable (horizontal bars work well on mobile)

### What Stays the Same

- All existing views unchanged
- No new database tables or columns
- Card CRUD unchanged
- Real-time sync still works (dashboard can optionally re-fetch on board-updated socket event)

### Key Interactions

| Action | Result |
|--------|--------|
| Click dashboard icon | Switch to dashboard view |
| Click "7d" button | Re-fetch analytics for 7-day window |
| Hover bar in chart | Tooltip with exact count |
| View on mobile | Responsive layout, stacked charts |
| Board updates (socket) | Dashboard auto-refreshes metrics |
