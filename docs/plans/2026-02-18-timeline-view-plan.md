# Timeline / Gantt View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Gantt-style timeline view to boards with horizontal duration bars, zoom levels (day/week/month), drag-to-move and resize interactions, swimlane grouping, and a new `start_date` field on cards.

**Architecture:** A new `start_date` column on the cards table (Migration 013) enables date ranges. `TimelineView` renders a horizontally scrollable time axis using CSS Grid, with `TimelineBar` components positioned via `left`/`width` calculations based on date-to-pixel mapping. The existing `UnscheduledSidebar` is reused. App.tsx routing is extended for `/board-slug/timeline`. Drag/resize uses native `mousedown`/`mousemove`/`mouseup` handlers (no library needed for horizontal-only movement).

**Tech Stack:** React, TypeScript, CSS Grid, native mouse events for drag/resize, existing API (`api.updateCard`).

---

### Task 1: Create Migration 013 — Add start_date to Cards

**Files:**
- Create: `server/src/migrations/013-card-start-date.sql`
- Modify: `server/src/migrations/run.ts`

**Step 1: Write the migration SQL**

Create `server/src/migrations/013-card-start-date.sql`:

```sql
-- Migration 013: Add start_date to cards for timeline view
ALTER TABLE cards ADD COLUMN IF NOT EXISTS start_date DATE NULL;
```

**Step 2: Register in run.ts**

In `server/src/migrations/run.ts`, add after the migration 012 block:

```typescript
// Card start date for timeline
const cardStartDate = fs.readFileSync(
  path.join(__dirname, '013-card-start-date.sql'),
  'utf-8'
);
await pool.query(cardStartDate);
```

**Step 3: Commit**

```bash
git add server/src/migrations/013-card-start-date.sql server/src/migrations/run.ts
git commit -m "feat: Add migration 013 for card start_date column"
```

---

### Task 2: Extend Card API and Types for start_date

**Files:**
- Modify: `server/src/routes/cards.ts`
- Modify: `client/src/types.ts`
- Modify: `client/src/api.ts`

**Step 1: Accept start_date in card update**

In `server/src/routes/cards.ts` PUT handler (lines 36–210), add `start_date` to the dynamic update builder (around line 67–101). Follow the same pattern as `due_date`:

```typescript
if (start_date !== undefined) {
  if (start_date === null || start_date === '') {
    updates.push(`start_date = NULL`);
  } else {
    updates.push(`start_date = $${paramCount++}`);
    values.push(start_date);
  }
}
```

Add activity logging for start_date changes (around line 149–199):

```typescript
if (start_date !== undefined && start_date !== oldCard.start_date) {
  await logActivity(card.id, req.user.id, 'start_date_changed', {
    from: oldCard.start_date,
    to: start_date
  });
}
```

**Step 2: Update client Card type**

In `client/src/types.ts`, add to the Card interface (line 91):

```typescript
start_date?: string | null;
```

**Step 3: Update API client**

The existing `api.updateCard` already passes through the data object to `PUT /api/cards/:id`, so `start_date` is automatically supported. No code change needed — just a TypeScript awareness that the `Card` type now includes `start_date`.

**Step 4: Commit**

```bash
git add server/src/routes/cards.ts client/src/types.ts
git commit -m "feat: Accept start_date in card update API"
```

---

### Task 3: Extend URL Routing for Timeline View

**Files:**
- Modify: `client/src/App.tsx`

**Step 1: Update boardViewMode type**

Change the state type to include `'timeline'`:

```tsx
const [boardViewMode, setBoardViewMode] = useState<'board' | 'calendar' | 'table' | 'timeline'>('board');
```

**Step 2: Update resolveUrlRoute**

Add `/timeline` suffix detection after the `/table` check:

```tsx
} else if (slug.endsWith('/timeline')) {
  boardSlug = slug.slice(0, -'/timeline'.length);
  resolvedViewMode = 'timeline';
}
```

**Step 3: Update handleViewChange**

The regex in `handleViewChange` needs to strip the new suffix:

```tsx
const slug = getPathSlug().replace(/\/(calendar|table|timeline)$/, '');
```

**Step 4: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: Extend URL routing for timeline view mode"
```

---

### Task 4: Add Timeline Toggle Icon and Conditional Rendering

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx`

**Step 1: Update props type**

```tsx
viewMode: 'board' | 'calendar' | 'table' | 'timeline';
onViewChange: (mode: 'board' | 'calendar' | 'table' | 'timeline') => void;
```

**Step 2: Add fourth toggle button**

In the `.view-toggle` div, add a timeline icon (horizontal bars icon):

```tsx
<button
  className={`btn-icon view-toggle-btn${viewMode === 'timeline' ? ' active' : ''}`}
  onClick={() => onViewChange('timeline')}
  title="Timeline view"
>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6h16M4 12h10M4 18h14"/>
  </svg>
</button>
```

**Step 3: Add conditional render**

Extend the view switch to include timeline:

```tsx
} : viewMode === 'timeline' ? (
  <div className="timeline-layout">
    <TimelineView
      board={board}
      filterCard={filterCard}
      isAdmin={isAdmin}
      onCardUpdate={() => { loadBoard(); }}
      onCardClick={handleCalendarCardClick}
    />
  </div>
)
```

**Step 4: Commit**

```bash
git add client/src/components/KanbanBoard.tsx
git commit -m "feat: Add timeline view toggle and conditional rendering"
```

---

### Task 5: Create TimelineView Component — Time Axis and Grid

**Files:**
- Create: `client/src/components/TimelineView.tsx`
- Modify: `client/src/index.css`

**Step 1: Create TimelineView.tsx with core layout**

```typescript
import { useState, useMemo, useRef, useEffect } from 'react';
import { Board, Card, Column } from '../types';
import TimelineBar from './TimelineBar';

interface TimelineViewProps {
  board: Board;
  filterCard: (card: Card) => boolean;
  isAdmin: boolean;
  onCardUpdate: () => void;
  onCardClick: (card: Card, columnName: string, event: React.MouseEvent) => void;
}

type ZoomLevel = 'day' | 'week' | 'month';
type GroupBy = 'column' | 'assignee' | 'label' | 'none';
```

**Date range computation:**

```typescript
const ZOOM_CONFIG = {
  day: { columnWidth: 40, unitDays: 1 },
  week: { columnWidth: 120, unitDays: 7 },
  month: { columnWidth: 160, unitDays: 30 },
};

// Compute the visible date range based on all card dates
const dateRange = useMemo(() => {
  const today = new Date();
  let minDate = new Date(today);
  let maxDate = new Date(today);
  minDate.setDate(minDate.getDate() - 14);
  maxDate.setDate(maxDate.getDate() + 60);

  board.columns?.forEach(col => {
    col.cards?.filter(c => !c.archived && filterCard(c)).forEach(card => {
      if (card.start_date) {
        const d = new Date(card.start_date);
        if (d < minDate) minDate = new Date(d);
      }
      if (card.due_date) {
        const d = new Date(card.due_date);
        if (d > maxDate) maxDate = new Date(d);
      }
    });
  });

  // Pad by 2 weeks on each side
  minDate.setDate(minDate.getDate() - 14);
  maxDate.setDate(maxDate.getDate() + 14);
  return { start: minDate, end: maxDate };
}, [board, filterCard]);
```

**Date-to-pixel helper:**

```typescript
const dateToPx = (date: Date): number => {
  const diffMs = date.getTime() - dateRange.start.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays * ZOOM_CONFIG[zoom].columnWidth / ZOOM_CONFIG[zoom].unitDays;
};
```

**Time axis header:**

Generate column headers (day numbers for day zoom, "Mon D" for week, month names for month):

```typescript
const axisColumns = useMemo(() => {
  const cols: { label: string; date: Date; width: number }[] = [];
  const d = new Date(dateRange.start);
  while (d <= dateRange.end) {
    const label = zoom === 'day'
      ? d.getDate().toString()
      : zoom === 'week'
      ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

    cols.push({ label, date: new Date(d), width: ZOOM_CONFIG[zoom].columnWidth });

    if (zoom === 'day') d.setDate(d.getDate() + 1);
    else if (zoom === 'week') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
  }
  return cols;
}, [dateRange, zoom]);
```

**Swimlane grouping (same logic as TableView):**

```typescript
const [groupBy, setGroupBy] = useState<GroupBy>('column');
```

Group cards by column/assignee/label/none using the same `Map` pattern from TableView.

**JSX layout:**

```tsx
return (
  <div className="timeline-container">
    <div className="timeline-nav">
      <button className="btn-icon" onClick={handlePrev}>←</button>
      <button className="btn-secondary btn-sm" onClick={handleToday}>Today</button>
      <button className="btn-icon" onClick={handleNext}>→</button>
      <h2 className="timeline-nav-title">{navTitle}</h2>
      <div className="timeline-zoom-toggle">
        {(['day', 'week', 'month'] as ZoomLevel[]).map(z => (
          <button key={z} className={`btn-sm${zoom === z ? ' btn-primary' : ' btn-secondary'}`}
            onClick={() => setZoom(z)}>{z.charAt(0).toUpperCase() + z.slice(1)}</button>
        ))}
      </div>
      <div className="timeline-group-selector">
        <select value={groupBy} onChange={e => setGroupBy(e.target.value as GroupBy)}>
          <option value="column">Status</option>
          <option value="assignee">Assignee</option>
          <option value="label">Label</option>
          <option value="none">None</option>
        </select>
      </div>
    </div>

    <div className="timeline-body" ref={scrollRef}>
      <div className="timeline-swimlane-labels">
        {groups.map(g => (
          <div key={g.label} className="swimlane-label" onClick={() => toggleGroup(g.label)}>
            <span className="swimlane-arrow">{collapsedGroups.has(g.label) ? '›' : '↓'}</span>
            {g.label} <span className="swimlane-count">{g.cards.length}</span>
          </div>
        ))}
      </div>

      <div className="timeline-chart">
        {/* Axis header */}
        <div className="timeline-axis">
          {axisColumns.map((col, i) => (
            <div key={i} className="timeline-axis-cell" style={{ width: col.width }}>
              {col.label}
            </div>
          ))}
        </div>

        {/* Today line */}
        <div className="timeline-today-line" style={{ left: dateToPx(new Date()) }} />

        {/* Swimlane rows with bars */}
        {groups.map(group => (
          !collapsedGroups.has(group.label) && (
            <div key={group.label} className="timeline-swimlane-row">
              {group.cards.map(({ card, column }) => (
                <TimelineBar
                  key={card.id}
                  card={card}
                  columnName={column.name}
                  dateToPx={dateToPx}
                  pxToDate={pxToDate}
                  isAdmin={isAdmin}
                  onUpdate={onCardUpdate}
                  onClick={(e) => onCardClick(card, column.name, e)}
                />
              ))}
            </div>
          )
        ))}
      </div>
    </div>
  </div>
);
```

**Step 2: Auto-scroll to today on mount**

```typescript
const scrollRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (scrollRef.current) {
    const todayPx = dateToPx(new Date());
    scrollRef.current.scrollLeft = todayPx - scrollRef.current.clientWidth / 2;
  }
}, [zoom]);
```

**Step 3: Add timeline CSS**

```css
/* ---- Timeline View ---- */

.timeline-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0 1rem 1rem;
}

.timeline-nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 0;
  flex-shrink: 0;
}

.timeline-nav-title {
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
  flex: 1;
}

.timeline-zoom-toggle {
  display: flex;
  gap: 2px;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 2px;
}

.timeline-zoom-toggle .btn-sm {
  padding: 0.25rem 0.625rem;
  font-size: 0.75rem;
  min-height: unset;
  border: none;
}

.timeline-zoom-toggle .btn-secondary {
  background: transparent;
  border: none;
}

.timeline-body {
  flex: 1;
  display: flex;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card-bg);
}

.timeline-swimlane-labels {
  width: 180px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--bg);
  position: sticky;
  left: 0;
  z-index: 2;
}

.swimlane-label {
  padding: 0.625rem 0.75rem;
  font-size: 0.8rem;
  font-weight: 600;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.swimlane-label:hover {
  background: var(--bg-raised);
}

.swimlane-arrow {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.swimlane-count {
  color: var(--text-secondary);
  font-weight: 400;
  font-size: 0.75rem;
}

.timeline-chart {
  flex: 1;
  position: relative;
  min-width: 0;
}

.timeline-axis {
  display: flex;
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border);
}

.timeline-axis-cell {
  flex-shrink: 0;
  padding: 0.5rem 0.25rem;
  text-align: center;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-secondary);
  border-right: 1px solid var(--border);
}

.timeline-today-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--danger);
  z-index: 3;
  pointer-events: none;
}

.timeline-swimlane-row {
  position: relative;
  min-height: 40px;
  border-bottom: 1px solid var(--border);
  padding: 4px 0;
}

.timeline-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}
```

**Step 4: Commit**

```bash
git add client/src/components/TimelineView.tsx client/src/index.css
git commit -m "feat: Create TimelineView with time axis, zoom, and swimlanes"
```

---

### Task 6: Create TimelineBar Component — Bar Rendering and Drag/Resize

**Files:**
- Create: `client/src/components/TimelineBar.tsx`
- Modify: `client/src/index.css`

**Step 1: Create TimelineBar.tsx**

```typescript
import { useRef, useState } from 'react';
import { Card } from '../types';
import { api } from '../api';

interface TimelineBarProps {
  card: Card;
  columnName: string;
  dateToPx: (date: Date) => number;
  pxToDate: (px: number) => Date;
  isAdmin: boolean;
  onUpdate: () => void;
  onClick: (e: React.MouseEvent) => void;
}
```

**Bar positioning:**

```typescript
const barStyle = useMemo(() => {
  if (!card.start_date && !card.due_date) return null;

  if (card.start_date && card.due_date) {
    const left = dateToPx(new Date(card.start_date));
    const right = dateToPx(new Date(card.due_date));
    return { left, width: Math.max(right - left, 20) };
  }

  if (card.due_date) {
    // Single-day marker
    const pos = dateToPx(new Date(card.due_date));
    return { left: pos - 6, width: 12, isMarker: true };
  }

  if (card.start_date) {
    // Open-ended: extend to today
    const left = dateToPx(new Date(card.start_date));
    const right = dateToPx(new Date());
    return { left, width: Math.max(right - left, 20), isOpenEnded: true };
  }

  return null;
}, [card, dateToPx]);
```

**Drag-to-move (body drag):**

```typescript
const handleMouseDown = (e: React.MouseEvent) => {
  if (!isAdmin || !card.start_date || !card.due_date) return;
  e.preventDefault();
  const startX = e.clientX;
  const origStart = new Date(card.start_date);
  const origEnd = new Date(card.due_date);

  const handleMove = (moveEvent: MouseEvent) => {
    const dx = moveEvent.clientX - startX;
    // Convert px delta to date delta using pxToDate
    setDragOffset(dx);
  };

  const handleUp = async (upEvent: MouseEvent) => {
    document.removeEventListener('mousemove', handleMove);
    document.removeEventListener('mouseup', handleUp);
    const dx = upEvent.clientX - startX;
    const daysDelta = pxToDays(dx);
    const newStart = addDays(origStart, daysDelta);
    const newEnd = addDays(origEnd, daysDelta);
    try {
      await api.updateCard(card.id, {
        start_date: formatDate(newStart),
        due_date: formatDate(newEnd),
      } as any);
      onUpdate();
    } catch (err) {
      console.error('Failed to move bar:', err);
    }
    setDragOffset(0);
  };

  document.addEventListener('mousemove', handleMove);
  document.addEventListener('mouseup', handleUp);
};
```

**Resize (edge drag):**

```typescript
const handleResizeStart = (edge: 'left' | 'right', e: React.MouseEvent) => {
  if (!isAdmin) return;
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;

  const handleMove = (moveEvent: MouseEvent) => {
    const dx = moveEvent.clientX - startX;
    setResizeOffset({ edge, dx });
  };

  const handleUp = async (upEvent: MouseEvent) => {
    document.removeEventListener('mousemove', handleMove);
    document.removeEventListener('mouseup', handleUp);
    const dx = upEvent.clientX - startX;
    const daysDelta = pxToDays(dx);

    const updates: any = {};
    if (edge === 'left' && card.start_date) {
      updates.start_date = formatDate(addDays(new Date(card.start_date), daysDelta));
    } else if (edge === 'right' && card.due_date) {
      updates.due_date = formatDate(addDays(new Date(card.due_date), daysDelta));
    }

    try {
      await api.updateCard(card.id, updates);
      onUpdate();
    } catch (err) {
      console.error('Failed to resize bar:', err);
    }
    setResizeOffset(null);
  };

  document.addEventListener('mousemove', handleMove);
  document.addEventListener('mouseup', handleUp);
};
```

**JSX:**

```tsx
if (!barStyle) return null;

return (
  <div
    className={`timeline-bar${barStyle.isMarker ? ' timeline-marker' : ''}${barStyle.isOpenEnded ? ' timeline-open-ended' : ''}`}
    style={{
      position: 'absolute',
      left: barStyle.left + (dragOffset || 0),
      width: barStyle.width,
      top: rowIndex * 32 + 4,
    }}
    onMouseDown={handleMouseDown}
    onClick={onClick}
    title={`${card.title}\n${card.start_date || '?'} – ${card.due_date || '?'}`}
  >
    {isAdmin && !barStyle.isMarker && (
      <div className="bar-resize-handle bar-resize-left" onMouseDown={(e) => handleResizeStart('left', e)} />
    )}
    <span className="bar-title">{card.title}</span>
    {isAdmin && !barStyle.isMarker && (
      <div className="bar-resize-handle bar-resize-right" onMouseDown={(e) => handleResizeStart('right', e)} />
    )}
  </div>
);
```

**Step 2: Add bar CSS**

```css
/* ---- Timeline Bars ---- */

.timeline-bar {
  height: 28px;
  border-radius: var(--radius-sm);
  background: var(--primary);
  color: white;
  display: flex;
  align-items: center;
  cursor: pointer;
  overflow: hidden;
  transition: opacity 0.1s;
  z-index: 1;
}

.timeline-bar:hover {
  opacity: 0.9;
  z-index: 2;
}

.bar-title {
  font-size: 0.7rem;
  font-weight: 500;
  padding: 0 0.375rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  pointer-events: none;
}

.timeline-marker {
  width: 12px !important;
  height: 12px;
  border-radius: 2px;
  transform: rotate(45deg);
  margin-top: 8px;
}

.timeline-marker .bar-title {
  display: none;
}

.timeline-open-ended {
  opacity: 0.6;
  border-right: 2px dashed rgba(255, 255, 255, 0.5);
}

.bar-resize-handle {
  width: 6px;
  height: 100%;
  cursor: col-resize;
  flex-shrink: 0;
}

.bar-resize-handle:hover {
  background: rgba(255, 255, 255, 0.3);
}

.bar-resize-left {
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.bar-resize-right {
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
```

**Step 3: Commit**

```bash
git add client/src/components/TimelineBar.tsx client/src/index.css
git commit -m "feat: Create TimelineBar with drag-to-move and resize"
```

---

### Task 7: Add start_date Editor to KanbanCard Detail

**Files:**
- Modify: `client/src/components/KanbanCard.tsx`

**Step 1: Add start_date input alongside due_date**

In `renderEditFields()`, near the existing due date input (look for the `<input type="date">` for `due_date`), add a matching start date input:

```tsx
<div className="date-range-row">
  <label className="section-label">Start Date</label>
  <input
    type="date"
    value={card.start_date || ''}
    onChange={(e) => handleFieldChange('start_date', e.target.value || null)}
  />
  <label className="section-label">Due Date</label>
  <input
    type="date"
    value={card.due_date || ''}
    onChange={(e) => handleFieldChange('due_date', e.target.value || null)}
  />
</div>
```

In `renderDetailFields()` (read-only), display the date range:

```tsx
{(card.start_date || card.due_date) && (
  <div className="detail-date-range">
    {card.start_date && <span>{formatDate(card.start_date)}</span>}
    {card.start_date && card.due_date && <span> – </span>}
    {card.due_date && <span>{formatDate(card.due_date)}</span>}
  </div>
)}
```

**Step 2: Commit**

```bash
git add client/src/components/KanbanCard.tsx
git commit -m "feat: Add start_date editor to card detail view"
```

---

### Task 8: Mobile Responsiveness — Simplified Date Range List

**Files:**
- Modify: `client/src/components/TimelineView.tsx`
- Modify: `client/src/index.css`

**Step 1: Detect mobile and render list view**

In TimelineView, add a mobile detection check (same `isMobile` pattern used in KanbanBoard or via media query):

```tsx
if (isMobile) {
  return (
    <div className="timeline-mobile-list">
      <div className="timeline-nav">{/* same nav, minus zoom toggle */}</div>
      {groups.map(group => (
        <div key={group.label} className="timeline-mobile-group">
          <h3 className="timeline-mobile-group-header">{group.label}</h3>
          {group.cards.map(({ card, column }) => (
            <div key={card.id} className="timeline-mobile-card" onClick={(e) => onCardClick(card, column.name, e)}>
              <span className="timeline-mobile-title">{card.title}</span>
              <span className="timeline-mobile-dates">
                {card.start_date && card.due_date
                  ? `${formatShortDate(card.start_date)} – ${formatShortDate(card.due_date)}`
                  : card.due_date
                  ? formatShortDate(card.due_date)
                  : 'No dates'}
              </span>
              <span className="table-status-badge">{column.name}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

**Step 2: Add mobile CSS**

```css
/* Timeline mobile */
@media (max-width: 768px) {
  .timeline-mobile-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 1rem 1rem;
  }

  .timeline-mobile-group-header {
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0.75rem 0 0.25rem;
    border-bottom: 1px solid var(--border);
    margin-bottom: 0.25rem;
  }

  .timeline-mobile-card {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
  }

  .timeline-mobile-card:hover {
    background: var(--bg-raised);
  }

  .timeline-mobile-title {
    flex: 1;
    font-size: 0.85rem;
    font-weight: 500;
  }

  .timeline-mobile-dates {
    font-size: 0.75rem;
    color: var(--text-secondary);
    white-space: nowrap;
  }
}
```

**Step 3: Commit**

```bash
git add client/src/components/TimelineView.tsx client/src/index.css
git commit -m "style: Add mobile date range list for timeline view"
```

---

### Task 9: Manual Testing Checklist

**No code changes — just verification.**

**Step 1: Test schema and API**
- Run migrations → `start_date` column exists on cards
- `PUT /api/cards/:id` with `start_date` → updates correctly
- Activity log records `start_date_changed`

**Step 2: Test view toggle and URL routing**
- Click timeline icon → timeline view, URL `/board-slug/timeline`
- Direct URL `/board-slug/timeline` → timeline loads
- Browser back/forward works across all 4 views

**Step 3: Test timeline rendering**
- Cards with start_date + due_date → horizontal bars
- Cards with only due_date → diamond markers
- Cards with only start_date → open-ended bar to today
- Cards with no dates → not shown on timeline (appear in sidebar)
- Today line (red vertical) visible

**Step 4: Test zoom levels**
- Day → narrow columns, one per day
- Week → medium columns, week labels
- Month → wide columns, month labels
- Switching zoom redraws correctly

**Step 5: Test drag interactions (admin)**
- Drag bar body → both dates shift by same offset
- Drag left edge → start_date changes, due_date preserved
- Drag right edge → due_date changes, start_date preserved
- Minimum 1-day duration enforced
- Non-admin: no drag handles

**Step 6: Test swimlanes**
- Group by Column → swimlanes match board columns
- Group by Assignee → one per assignee + Unassigned
- Collapse/expand swimlanes works

**Step 7: Test card detail**
- Open card → start_date and due_date inputs visible
- Set start_date → bar appears on timeline

**Step 8: Test mobile**
- Timeline renders as simplified date range list
- Cards show title, date range, column badge
- Tap opens card popover
