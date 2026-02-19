# Dashboard / Reporting View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a per-board analytics dashboard with summary stat cards, CSS-only bar charts (cards by status/assignee/label, cycle time distribution), a created-vs-completed over-time chart, and a configurable date range — all computed from existing tables with no schema changes.

**Architecture:** A new server-side analytics endpoint (`GET /api/boards/:boardId/analytics`) runs SQL aggregations over existing `cards`, `card_activity`, `card_assignees`, `card_labels`, and `columns` tables. The `DashboardView` component fetches this endpoint and renders stat cards + CSS-only horizontal bar charts. App.tsx routing is extended for `/board-slug/dashboard`.

**Tech Stack:** React, TypeScript, Express, PostgreSQL aggregate queries, CSS (`calc()` for bar widths), no external charting library.

---

### Task 1: Create Analytics API Endpoint

**Files:**
- Create: `server/src/routes/analytics.ts`
- Modify: `server/src/index.ts`

**Step 1: Create the route file**

Follow the existing route pattern from `server/src/routes/boards.ts` — Router with `authenticate` middleware, `pool.query` with `$N` params. The endpoint is available to all authenticated users (not admin-only).

```typescript
import { Router, Request, Response } from 'express';
import pool from '../db';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /boards/:boardId/analytics?days=30
router.get('/boards/:boardId/analytics', authenticate, async (req: Request, res: Response) => {
  const { boardId } = req.params;
  const days = parseInt(req.query.days as string) || 30;

  // Compute date range
  const end = new Date();
  const start = days > 0 ? new Date(end.getTime() - days * 24 * 60 * 60 * 1000) : null;
  const dateFilter = start ? `AND c.created_at >= $2` : '';
  const params: any[] = [boardId];
  if (start) params.push(start.toISOString());

  // Find the "last column" (highest position) for this board
  const lastColResult = await pool.query(
    'SELECT id FROM columns WHERE board_id = $1 ORDER BY position DESC LIMIT 1',
    [boardId]
  );
  const lastColumnId = lastColResult.rows[0]?.id;

  // Summary: total, completed, overdue cards
  const summaryResult = await pool.query(
    `SELECT
       COUNT(*)::int as total_cards,
       COUNT(*) FILTER (WHERE c.column_id = $2)::int as completed_cards,
       COUNT(*) FILTER (WHERE c.due_date < CURRENT_DATE AND c.column_id != $2)::int as overdue_cards
     FROM cards c
     INNER JOIN columns col ON c.column_id = col.id
     WHERE col.board_id = $1 AND c.archived = false`,
    [boardId, lastColumnId || '']
  );

  // Cards by column
  const byColumnResult = await pool.query(
    `SELECT col.id as column_id, col.name as column_name, col.position,
            COUNT(c.id)::int as count
     FROM columns col
     LEFT JOIN cards c ON c.column_id = col.id AND c.archived = false
     WHERE col.board_id = $1
     GROUP BY col.id, col.name, col.position
     ORDER BY col.position`,
    [boardId]
  );

  // Cards by assignee
  const byAssigneeResult = await pool.query(
    `SELECT
       COALESCE(ca.assignee_name, 'Unassigned') as assignee,
       COUNT(DISTINCT c.id)::int as total,
       COUNT(DISTINCT c.id) FILTER (WHERE c.column_id = $2)::int as completed
     FROM cards c
     INNER JOIN columns col ON c.column_id = col.id
     LEFT JOIN card_assignees ca ON ca.card_id = c.id
     WHERE col.board_id = $1 AND c.archived = false
     GROUP BY ca.assignee_name
     ORDER BY total DESC`,
    [boardId, lastColumnId || '']
  );

  // Cards by label
  const byLabelResult = await pool.query(
    `SELECT bl.id as label_id, bl.name as label_name, bl.color as label_color,
            COUNT(cl.card_id)::int as count
     FROM board_labels bl
     LEFT JOIN card_labels cl ON cl.label_id = bl.id
     LEFT JOIN cards c ON c.id = cl.card_id AND c.archived = false
     WHERE bl.board_id = $1
     GROUP BY bl.id, bl.name, bl.color
     ORDER BY count DESC`,
    [boardId]
  );

  // Cards created/completed over time
  // Created: group by date from cards.created_at
  // Completed: group by date from card_activity where action = 'column_changed' to last column
  const overTimeResult = await pool.query(
    `WITH date_range AS (
       SELECT generate_series(
         COALESCE($2::timestamp, (SELECT MIN(created_at) FROM cards c INNER JOIN columns col ON c.column_id = col.id WHERE col.board_id = $1)),
         CURRENT_TIMESTAMP,
         '1 day'::interval
       )::date as d
     ),
     created AS (
       SELECT c.created_at::date as d, COUNT(*)::int as count
       FROM cards c
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1 ${dateFilter.replace('c.created_at', 'c.created_at')}
       GROUP BY c.created_at::date
     ),
     completed AS (
       SELECT ca.created_at::date as d, COUNT(*)::int as count
       FROM card_activity ca
       INNER JOIN cards c ON ca.card_id = c.id
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1
         AND ca.action = 'column_changed'
         AND ca.detail->>'to_column_id' = $3
         ${start ? `AND ca.created_at >= $2` : ''}
       GROUP BY ca.created_at::date
     )
     SELECT dr.d as date,
            COALESCE(cr.count, 0) as created,
            COALESCE(co.count, 0) as completed
     FROM date_range dr
     LEFT JOIN created cr ON cr.d = dr.d
     LEFT JOIN completed co ON co.d = dr.d
     ORDER BY dr.d`,
    start ? [boardId, start.toISOString(), lastColumnId || ''] : [boardId, null, lastColumnId || '']
  );

  // Average cycle time (for cards completed in period)
  const cycleTimeResult = await pool.query(
    `SELECT
       AVG(EXTRACT(EPOCH FROM (ca.created_at - c.created_at)) / 86400)::numeric(10,1) as avg_cycle_time_days
     FROM card_activity ca
     INNER JOIN cards c ON ca.card_id = c.id
     INNER JOIN columns col ON c.column_id = col.id
     WHERE col.board_id = $1
       AND ca.action = 'column_changed'
       AND ca.detail->>'to_column_id' = $2
       ${start ? `AND ca.created_at >= $3` : ''}`,
    start ? [boardId, lastColumnId || '', start.toISOString()] : [boardId, lastColumnId || '']
  );

  // Cycle time distribution
  const cycleDistResult = await pool.query(
    `WITH completed_cards AS (
       SELECT c.id,
              EXTRACT(EPOCH FROM (ca.created_at - c.created_at)) / 86400 as cycle_days
       FROM card_activity ca
       INNER JOIN cards c ON ca.card_id = c.id
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1
         AND ca.action = 'column_changed'
         AND ca.detail->>'to_column_id' = $2
         ${start ? `AND ca.created_at >= $3` : ''}
     )
     SELECT
       CASE
         WHEN cycle_days < 1 THEN '< 1 day'
         WHEN cycle_days < 3 THEN '1-3 days'
         WHEN cycle_days < 7 THEN '3-7 days'
         WHEN cycle_days < 14 THEN '1-2 weeks'
         ELSE '> 2 weeks'
       END as range,
       COUNT(*)::int as count
     FROM completed_cards
     GROUP BY 1
     ORDER BY MIN(cycle_days)`,
    start ? [boardId, lastColumnId || '', start.toISOString()] : [boardId, lastColumnId || '']
  );

  const summary = summaryResult.rows[0] || { total_cards: 0, completed_cards: 0, overdue_cards: 0 };

  res.json({
    period: {
      days,
      start: start ? start.toISOString().slice(0, 10) : null,
      end: end.toISOString().slice(0, 10),
    },
    summary: {
      ...summary,
      avg_cycle_time_days: parseFloat(cycleTimeResult.rows[0]?.avg_cycle_time_days) || 0,
    },
    cards_by_column: byColumnResult.rows,
    cards_by_assignee: byAssigneeResult.rows,
    cards_by_label: byLabelResult.rows,
    cards_over_time: overTimeResult.rows,
    cycle_time_distribution: cycleDistResult.rows,
  });
});

export default router;
```

**Step 2: Mount route in index.ts**

In `server/src/index.ts` (around line 54), add:

```typescript
import analyticsRoutes from './routes/analytics';
// ...
app.use('/api', analyticsRoutes);
```

**Step 3: Commit**

```bash
git add server/src/routes/analytics.ts server/src/index.ts
git commit -m "feat: Add board analytics API endpoint"
```

---

### Task 2: Add API Client Method

**Files:**
- Modify: `client/src/api.ts`

**Step 1: Add getBoardAnalytics method**

In the ApiClient class (around line 285, after the existing notification methods):

```typescript
// Analytics
async getBoardAnalytics(boardId: string, days: number = 30): Promise<any> {
  return this.fetch(`/boards/${boardId}/analytics?days=${days}`);
}
```

**Step 2: Commit**

```bash
git add client/src/api.ts
git commit -m "feat: Add getBoardAnalytics API method"
```

---

### Task 3: Extend URL Routing for Dashboard View

**Files:**
- Modify: `client/src/App.tsx`

**Step 1: Update boardViewMode type**

Extend the type to include `'dashboard'`:

```tsx
const [boardViewMode, setBoardViewMode] = useState<'board' | 'calendar' | 'table' | 'timeline' | 'dashboard'>('board');
```

**Step 2: Update resolveUrlRoute**

Add `/dashboard` suffix detection:

```tsx
} else if (slug.endsWith('/dashboard')) {
  boardSlug = slug.slice(0, -'/dashboard'.length);
  resolvedViewMode = 'dashboard';
}
```

**Step 3: Update handleViewChange**

Update the regex to strip the new suffix:

```tsx
const slug = getPathSlug().replace(/\/(calendar|table|timeline|dashboard)$/, '');
```

**Step 4: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: Extend URL routing for dashboard view mode"
```

---

### Task 4: Add Dashboard Toggle Icon and Conditional Rendering

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx`

**Step 1: Update props type**

```tsx
viewMode: 'board' | 'calendar' | 'table' | 'timeline' | 'dashboard';
onViewChange: (mode: 'board' | 'calendar' | 'table' | 'timeline' | 'dashboard') => void;
```

**Step 2: Add fifth toggle button**

In the `.view-toggle` div, add a chart icon:

```tsx
<button
  className={`btn-icon view-toggle-btn${viewMode === 'dashboard' ? ' active' : ''}`}
  onClick={() => onViewChange('dashboard')}
  title="Dashboard"
>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 20V10M12 20V4M6 20v-6"/>
  </svg>
</button>
```

**Step 3: Add conditional render**

```tsx
} : viewMode === 'dashboard' ? (
  <DashboardView
    boardId={board.id}
  />
)
```

**Step 4: Commit**

```bash
git add client/src/components/KanbanBoard.tsx
git commit -m "feat: Add dashboard view toggle and conditional rendering"
```

---

### Task 5: Create DashboardView Component — Layout and Stat Cards

**Files:**
- Create: `client/src/components/DashboardView.tsx`
- Modify: `client/src/index.css`

**Step 1: Create DashboardView.tsx**

```typescript
import { useState, useEffect } from 'react';
import { api } from '../api';

interface DashboardViewProps {
  boardId: string;
}

interface Analytics {
  period: { days: number; start: string | null; end: string };
  summary: { total_cards: number; completed_cards: number; overdue_cards: number; avg_cycle_time_days: number };
  cards_by_column: { column_id: string; column_name: string; count: number }[];
  cards_by_assignee: { assignee: string; total: number; completed: number }[];
  cards_by_label: { label_id: string; label_name: string; label_color: string; count: number }[];
  cards_over_time: { date: string; created: number; completed: number }[];
  cycle_time_distribution: { range: string; count: number }[];
}
```

**Fetch analytics on mount and on date range change:**

```typescript
const [days, setDays] = useState(30);
const [data, setData] = useState<Analytics | null>(null);
const [loading, setLoading] = useState(true);

useEffect(() => {
  setLoading(true);
  api.getBoardAnalytics(boardId, days)
    .then(setData)
    .catch(err => console.error('Failed to load analytics:', err))
    .finally(() => setLoading(false));
}, [boardId, days]);
```

**JSX layout:**

```tsx
return (
  <div className="dashboard-view">
    {/* Date range selector */}
    <div className="dashboard-header">
      <h2 className="dashboard-title">Dashboard</h2>
      <div className="dashboard-range-toggle">
        {[7, 30, 90, 0].map(d => (
          <button
            key={d}
            className={`btn-sm${days === d ? ' btn-primary' : ' btn-secondary'}`}
            onClick={() => setDays(d)}
          >
            {d === 0 ? 'All' : `${d}d`}
          </button>
        ))}
      </div>
    </div>

    {loading ? (
      <div className="dashboard-loading">Loading analytics...</div>
    ) : data ? (
      <>
        {/* Summary stat cards */}
        <div className="stat-cards">
          <div className="stat-card">
            <div className="stat-number">{data.summary.total_cards}</div>
            <div className="stat-label">Total Cards</div>
          </div>
          <div className="stat-card stat-card-success">
            <div className="stat-number">{data.summary.completed_cards}</div>
            <div className="stat-label">Completed</div>
          </div>
          <div className="stat-card stat-card-danger">
            <div className="stat-number">{data.summary.overdue_cards}</div>
            <div className="stat-label">Overdue</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{data.summary.avg_cycle_time_days}d</div>
            <div className="stat-label">Avg Cycle Time</div>
          </div>
        </div>

        {/* Charts row 1: By Status + By Assignee */}
        <div className="chart-row">
          <BarChart title="Cards by Status" data={data.cards_by_column.map(c => ({ label: c.column_name, value: c.count }))} />
          <BarChart title="Cards by Assignee" data={data.cards_by_assignee.map(a => ({ label: a.assignee, value: a.total }))} />
        </div>

        {/* Charts row 2: Over Time + By Label + Cycle Time */}
        <div className="chart-row">
          <OverTimeChart title="Created vs Completed" data={data.cards_over_time} />
          <div className="chart-stack">
            <BarChart title="Cards by Label" data={data.cards_by_label.map(l => ({ label: l.label_name, value: l.count, color: l.label_color }))} />
            <BarChart title="Cycle Time Distribution" data={data.cycle_time_distribution.map(c => ({ label: c.range, value: c.count }))} />
          </div>
        </div>
      </>
    ) : null}
  </div>
);
```

**Step 2: BarChart sub-component (CSS-only bars)**

```tsx
function BarChart({ title, data }: { title: string; data: { label: string; value: number; color?: string }[] }) {
  const max = Math.max(...data.map(d => d.value), 1);

  return (
    <div className="dashboard-chart">
      <h3 className="chart-title">{title}</h3>
      <div className="chart-bars">
        {data.map((item, i) => (
          <div key={i} className="chart-bar-row">
            <span className="chart-bar-label">{item.label}</span>
            <div className="chart-bar-track">
              <div
                className="chart-bar-fill"
                style={{
                  width: `${(item.value / max) * 100}%`,
                  background: item.color || 'var(--primary)',
                }}
              />
            </div>
            <span className="chart-bar-value">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 3: OverTimeChart sub-component**

Simple CSS bar chart with paired bars per date (aggregated to weekly for > 30 data points):

```tsx
function OverTimeChart({ title, data }: { title: string; data: { date: string; created: number; completed: number }[] }) {
  // Aggregate to weekly if too many data points
  const aggregated = data.length > 30 ? aggregateWeekly(data) : data;
  const max = Math.max(...aggregated.flatMap(d => [d.created, d.completed]), 1);

  return (
    <div className="dashboard-chart">
      <h3 className="chart-title">{title}</h3>
      <div className="chart-legend">
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--primary)' }} /> Created</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--success)' }} /> Completed</span>
      </div>
      <div className="overtime-chart">
        {aggregated.map((item, i) => (
          <div key={i} className="overtime-bar-group">
            <div className="overtime-bars">
              <div className="overtime-bar created" style={{ height: `${(item.created / max) * 100}%` }} />
              <div className="overtime-bar completed" style={{ height: `${(item.completed / max) * 100}%` }} />
            </div>
            <span className="overtime-label">{formatShortDate(item.date)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 4: Add dashboard CSS**

```css
/* ---- Dashboard View ---- */

.dashboard-view {
  flex: 1;
  overflow-y: auto;
  padding: 0 1rem 2rem;
}

.dashboard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 0;
}

.dashboard-title {
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
}

.dashboard-range-toggle {
  display: flex;
  gap: 2px;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 2px;
}

.dashboard-range-toggle .btn-sm {
  padding: 0.25rem 0.625rem;
  font-size: 0.75rem;
  min-height: unset;
  border: none;
}

.dashboard-range-toggle .btn-secondary {
  background: transparent;
  border: none;
}

.dashboard-loading {
  text-align: center;
  padding: 3rem;
  color: var(--text-secondary);
}

/* Stat Cards */
.stat-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.stat-card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1rem;
  text-align: center;
}

.stat-card-success {
  border-color: var(--success);
}

.stat-card-danger .stat-number {
  color: var(--danger);
}

.stat-number {
  font-size: 1.75rem;
  font-weight: 700;
  font-family: var(--font-display);
  line-height: 1.2;
}

.stat-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-weight: 500;
  margin-top: 0.25rem;
}

/* Charts */
.chart-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.chart-stack {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.dashboard-chart {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1rem;
}

.chart-title {
  font-size: 0.85rem;
  font-weight: 600;
  margin: 0 0 0.75rem;
}

.chart-bars {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.chart-bar-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.chart-bar-label {
  width: 100px;
  font-size: 0.8rem;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}

.chart-bar-track {
  flex: 1;
  height: 20px;
  background: var(--bg-raised);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.chart-bar-fill {
  height: 100%;
  border-radius: var(--radius-sm);
  transition: width 0.3s var(--ease);
  min-width: 2px;
}

.chart-bar-value {
  width: 30px;
  font-size: 0.75rem;
  font-weight: 600;
  text-align: right;
  flex-shrink: 0;
}

/* Over Time Chart */
.chart-legend {
  display: flex;
  gap: 1rem;
  margin-bottom: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.overtime-chart {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 120px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 1.25rem;
  overflow-x: auto;
}

.overtime-bar-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 20px;
  flex: 1;
}

.overtime-bars {
  display: flex;
  gap: 1px;
  align-items: flex-end;
  height: 100px;
}

.overtime-bar {
  width: 8px;
  border-radius: 2px 2px 0 0;
  min-height: 1px;
  transition: height 0.3s var(--ease);
}

.overtime-bar.created {
  background: var(--primary);
}

.overtime-bar.completed {
  background: var(--success);
}

.overtime-label {
  font-size: 0.55rem;
  color: var(--text-secondary);
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  margin-top: 0.25rem;
}
```

**Step 5: Commit**

```bash
git add client/src/components/DashboardView.tsx client/src/index.css
git commit -m "feat: Create DashboardView with stat cards and CSS bar charts"
```

---

### Task 6: Add Socket.IO Auto-Refresh

**Files:**
- Modify: `client/src/components/DashboardView.tsx`

**Step 1: Re-fetch on board-updated events**

Add a `boardId` prop and accept a socket reference (or use the existing pattern from KanbanBoard for listening to `board-updated`):

```typescript
useEffect(() => {
  const handleBoardUpdated = () => {
    api.getBoardAnalytics(boardId, days).then(setData);
  };

  // Listen for board updates (socket pattern from KanbanBoard)
  // The parent KanbanBoard already calls loadBoard() on socket events,
  // so DashboardView just needs to re-fetch when `boardId` or `days` changes.
  // For real-time: pass socket as prop or use a shared context.
}, [boardId, days]);
```

In practice, the simplest approach is for KanbanBoard to pass a `refreshKey` counter that increments on socket `board-updated` events. DashboardView re-fetches when this key changes.

**Step 2: Commit**

```bash
git add client/src/components/DashboardView.tsx
git commit -m "feat: Add socket-triggered refresh for dashboard analytics"
```

---

### Task 7: Mobile Responsiveness

**Files:**
- Modify: `client/src/index.css`

**Step 1: Add mobile dashboard styles**

In the existing `@media (max-width: 768px)` block:

```css
/* Dashboard mobile */
.stat-cards {
  grid-template-columns: repeat(2, 1fr);
}

.chart-row {
  grid-template-columns: 1fr;
}

.dashboard-header {
  flex-wrap: wrap;
  gap: 0.5rem;
}

.chart-bar-label {
  width: 70px;
  font-size: 0.7rem;
}

.overtime-chart {
  height: 80px;
}
```

**Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "style: Add mobile responsiveness for dashboard view"
```

---

### Task 8: Manual Testing Checklist

**No code changes — just verification.**

**Step 1: Test analytics endpoint**
- `GET /api/boards/:id/analytics?days=30` returns correct JSON shape
- `days=7`, `days=90`, `days=0` (all time) all work
- Unauthenticated request → 401
- Summary totals match manual card count

**Step 2: Test view toggle and URL routing**
- Click dashboard icon → dashboard view, URL `/board-slug/dashboard`
- Direct URL loads dashboard
- Browser back/forward works

**Step 3: Test stat cards**
- Total, Completed, Overdue, Avg Cycle Time display correctly
- Overdue card with `due_date < today` not in last column → counted
- 0 overdue → no red highlight

**Step 4: Test bar charts**
- Cards by Status: bars proportional to counts, labels match column names
- Cards by Assignee: includes "Unassigned" group
- Cards by Label: bar colors match label colors
- Cycle Time Distribution: buckets display correctly

**Step 5: Test date range selector**
- Switch to 7d → data refreshes with 7-day window
- Switch to All → all-time data
- Active button highlighted

**Step 6: Test created vs completed chart**
- Two bar series visible (blue created, green completed)
- Data aggregated weekly for 30d+ ranges
- Empty days show no bars

**Step 7: Test mobile**
- Stat cards: 2x2 grid
- Charts: single column stack
- Bars remain readable
