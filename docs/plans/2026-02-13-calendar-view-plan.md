# Calendar View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a calendar view to boards that shows cards by due date, with drag-and-drop to assign/move dates, and an unscheduled sidebar.

**Architecture:** A new `CalendarView` component renders month/week grids using CSS Grid. An `UnscheduledSidebar` shows dateless cards. Both share the existing `DragDropContext` from KanbanBoard via a lifted wrapper. Each calendar day cell is a `Droppable`; each card chip is a `Draggable`. App.tsx routing is extended so `/board-slug/calendar` loads the board in calendar mode. A `viewMode` prop controls which view KanbanBoard renders.

**Tech Stack:** React, TypeScript, react-beautiful-dnd (existing), CSS Grid, existing API (`api.updateCard`).

---

### Task 1: Extend URL routing for calendar view mode

**Files:**
- Modify: `client/src/App.tsx`

**Step 1: Add viewMode state**

Add a `boardViewMode` state to App. Update `navigateTo` to accept and propagate `viewMode`. When navigating to a board, if `viewMode === 'calendar'`, append `/calendar` to the path.

In state declarations (after line 31):
```tsx
const [boardViewMode, setBoardViewMode] = useState<'board' | 'calendar'>('board');
```

Update `navigateTo` (lines 40-55) to handle viewMode:
```tsx
const navigateTo = useCallback((newPage: Page, boardId?: string | null, boardName?: string, adminSub?: string | null, viewMode?: 'board' | 'calendar') => {
  setPage(newPage);
  setCurrentBoardId(boardId ?? null);
  setAdminSubRoute(newPage === 'users' ? (adminSub ?? null) : null);
  setBoardViewMode(newPage === 'board' ? (viewMode ?? 'board') : 'board');

  let path = '/';
  if (newPage === 'users') {
    path = adminSub ? `/admin/${adminSub}` : '/admin';
  } else if (newPage === 'board' && boardName) {
    path = '/' + slugify(boardName) + (viewMode === 'calendar' ? '/calendar' : '');
  }

  if (window.location.pathname !== path) {
    window.history.pushState({ page: newPage, boardId, boardName, adminSub, viewMode }, '', path);
  }
}, []);
```

**Step 2: Update resolveUrlRoute to detect /calendar suffix**

In `resolveUrlRoute` (lines 58-83), after the admin check, parse the slug to detect a `/calendar` suffix before matching board names:

```tsx
// After the admin check block, replace the board-matching block:
let boardSlug = slug;
let resolvedViewMode: 'board' | 'calendar' = 'board';
if (slug.endsWith('/calendar')) {
  boardSlug = slug.slice(0, -'/calendar'.length);
  resolvedViewMode = 'calendar';
}

try {
  const boards = await api.getBoards();
  const match = boards.find((b: any) => slugify(b.name) === boardSlug);
  if (match) {
    setCurrentBoardId(match.id);
    setPage('board');
    setBoardViewMode(resolvedViewMode);
  }
} catch {
  // Couldn't load boards, stay on board list
}
```

**Step 3: Update popstate handler**

In `handlePopState` (lines 105-131), restore `boardViewMode` from `state.viewMode`:
```tsx
if (state) {
  setPage(state.page || 'boards');
  setCurrentBoardId(state.boardId || null);
  setAdminSubRoute(state.page === 'users' ? (state.adminSub ?? null) : null);
  setBoardViewMode(state.page === 'board' ? (state.viewMode ?? 'board') : 'board');
}
```

**Step 4: Pass viewMode and onViewChange to KanbanBoard**

Add a handler for view changes and pass it to KanbanBoard:
```tsx
const handleViewChange = (viewMode: 'board' | 'calendar') => {
  if (!currentBoardId) return;
  // We need the board name for the URL. Get it from the current path slug.
  const slug = getPathSlug().replace(/\/calendar$/, '');
  const path = '/' + slug + (viewMode === 'calendar' ? '/calendar' : '');
  setBoardViewMode(viewMode);
  window.history.pushState({ page: 'board', boardId: currentBoardId, viewMode }, '', path);
};
```

Update the KanbanBoard render (lines 235-240):
```tsx
<KanbanBoard
  boardId={currentBoardId}
  onBack={handleBackToBoards}
  onLogout={handleLogout}
  userRole={user?.role || 'READ'}
  viewMode={boardViewMode}
  onViewChange={handleViewChange}
/>
```

**Step 5: Update handleLogout to clear boardViewMode**

Add `setBoardViewMode('board')` to `handleLogout`.

**Step 6: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: Extend App.tsx routing for board calendar view mode"
```

---

### Task 2: Add view toggle to KanbanBoard header

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx`

**Step 1: Update KanbanBoardProps**

```tsx
interface KanbanBoardProps {
  boardId: string;
  onBack: () => void;
  onLogout: () => void;
  userRole: 'READ' | 'COLLABORATOR' | 'ADMIN';
  viewMode: 'board' | 'calendar';
  onViewChange: (mode: 'board' | 'calendar') => void;
}
```

Destructure the new props:
```tsx
export default function KanbanBoard({ boardId, onBack, onLogout, userRole, viewMode, onViewChange }: KanbanBoardProps) {
```

**Step 2: Add view toggle buttons to the header**

In the header `header-actions` div (around line 405), add a view toggle group before the existing buttons:

```tsx
<div className="header-actions">
  <div className="view-toggle">
    <button
      className={`btn-icon view-toggle-btn${viewMode === 'board' ? ' active' : ''}`}
      onClick={() => onViewChange('board')}
      title="Board view"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="12" rx="1"/>
      </svg>
    </button>
    <button
      className={`btn-icon view-toggle-btn${viewMode === 'calendar' ? ' active' : ''}`}
      onClick={() => onViewChange('calendar')}
      title="Calendar view"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
      </svg>
    </button>
  </div>
  {/* ... existing filter/menu buttons */}
```

**Step 3: Add view-toggle CSS**

Add to `client/src/index.css`:

```css
/* ---- View Toggle ---- */

.view-toggle {
  display: flex;
  gap: 2px;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 2px;
}

.view-toggle-btn {
  padding: 0.25rem 0.5rem;
  border-radius: calc(var(--radius-sm) - 2px);
  min-width: unset;
  min-height: unset;
}

.view-toggle-btn.active {
  background: var(--card-bg);
  color: var(--primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
```

**Step 4: Commit**

```bash
git add client/src/components/KanbanBoard.tsx client/src/index.css
git commit -m "feat: Add board/calendar view toggle in header"
```

---

### Task 3: Create CalendarView component — month grid

**Files:**
- Create: `client/src/components/CalendarView.tsx`
- Modify: `client/src/index.css`

This is the largest task. Build the month grid, navigation, and card chip rendering (no DnD yet — that comes in Task 5).

**Step 1: Create CalendarView.tsx with month grid**

The component receives board data and renders a month calendar. Key props:

```tsx
import { useState } from 'react';
import { Board, Card, Column } from '../types';

interface CalendarViewProps {
  board: Board;
  onCardClick: (card: Card, columnName: string) => void;
  filterCard: (card: Card) => boolean;
}

export default function CalendarView({ board, onCardClick, filterCard }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewType, setViewType] = useState<'month' | 'week'>('month');
```

**Helper functions to build:**

- `getMonthDays(year, month)` — returns array of date objects for the full 6-week grid (including padding days from prev/next month)
- `getWeekDays(date)` — returns 7 date objects for the week containing `date`
- `getCardsForDate(date)` — looks up all board cards whose `due_date` matches the given date string (YYYY-MM-DD), filtered by `filterCard`
- `getAllUnscheduledCards()` — returns cards with no `due_date`, filtered by `filterCard`
- `formatDateKey(date)` — formats a Date as `YYYY-MM-DD` for comparison
- `isSameDay(a, b)` — compares two Dates ignoring time
- `isToday(date)` — checks if date is today

**Month grid JSX:**

```tsx
const renderMonthView = () => {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const days = getMonthDays(year, month);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="calendar-grid month-grid">
      {dayNames.map(d => <div key={d} className="calendar-day-header">{d}</div>)}
      {days.map((date, i) => {
        const dateKey = formatDateKey(date);
        const cards = getCardsForDate(date);
        const isCurrentMonth = date.getMonth() === month;
        const todayClass = isToday(date) ? ' calendar-today' : '';
        const outsideClass = !isCurrentMonth ? ' calendar-outside' : '';

        return (
          <div key={i} className={`calendar-day${todayClass}${outsideClass}`} data-date={dateKey}>
            <div className="calendar-day-number">{date.getDate()}</div>
            <div className="calendar-day-cards">
              {cards.slice(0, 2).map(({ card, columnName }) => (
                <CalendarCardChip
                  key={card.id}
                  card={card}
                  columnName={columnName}
                  onClick={() => onCardClick(card, columnName)}
                />
              ))}
              {cards.length > 2 && (
                <button className="calendar-more-btn" onClick={() => {/* expand or popover */}}>
                  +{cards.length - 2} more
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
```

**CalendarCardChip** — a small sub-component inside the same file:

```tsx
function CalendarCardChip({ card, columnName, onClick, columnColor }: {
  card: Card;
  columnName: string;
  onClick: () => void;
  columnColor?: string;
}) {
  return (
    <div className="calendar-card-chip" onClick={onClick}>
      <span className="chip-column-dot" style={{ background: columnColor || 'var(--primary)' }} />
      <span className="chip-title">{card.title}</span>
    </div>
  );
}
```

**Navigation sub-header:**

```tsx
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

return (
  <div className="calendar-container">
    <div className="calendar-nav">
      <button className="btn-icon" onClick={handlePrev}>←</button>
      <button className="btn-secondary btn-sm" onClick={handleToday}>Today</button>
      <button className="btn-icon" onClick={handleNext}>→</button>
      <h2 className="calendar-nav-title">
        {viewType === 'month'
          ? `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`
          : formatWeekRange(currentDate)}
      </h2>
      <div className="calendar-view-type">
        <button className={`btn-sm${viewType === 'month' ? ' btn-primary' : ' btn-secondary'}`} onClick={() => setViewType('month')}>Month</button>
        <button className={`btn-sm${viewType === 'week' ? ' btn-primary' : ' btn-secondary'}`} onClick={() => setViewType('week')}>Week</button>
      </div>
    </div>
    {viewType === 'month' ? renderMonthView() : renderWeekView()}
  </div>
);
```

**Navigation handlers:**

```tsx
const handlePrev = () => {
  setCurrentDate(prev => {
    if (viewType === 'month') return new Date(prev.getFullYear(), prev.getMonth() - 1, 1);
    const d = new Date(prev); d.setDate(d.getDate() - 7); return d;
  });
};

const handleNext = () => {
  setCurrentDate(prev => {
    if (viewType === 'month') return new Date(prev.getFullYear(), prev.getMonth() + 1, 1);
    const d = new Date(prev); d.setDate(d.getDate() + 7); return d;
  });
};

const handleToday = () => setCurrentDate(new Date());
```

**Step 2: Add calendar CSS**

Add to `client/src/index.css`:

```css
/* ---- Calendar View ---- */

.calendar-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0 1rem 1rem;
}

.calendar-nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 0;
  flex-shrink: 0;
}

.calendar-nav-title {
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
  flex: 1;
}

.calendar-view-type {
  display: flex;
  gap: 2px;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 2px;
}

.calendar-view-type .btn-sm {
  padding: 0.25rem 0.625rem;
  font-size: 0.75rem;
  min-height: unset;
  border: none;
}

.calendar-view-type .btn-secondary {
  background: transparent;
  border: none;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  flex: 1;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--card-bg);
}

.calendar-day-header {
  padding: 0.5rem;
  text-align: center;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border);
}

.calendar-day {
  min-height: 5.5rem;
  padding: 0.25rem;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.calendar-day:nth-child(7n + 7) {
  border-right: none;
}

.calendar-grid > .calendar-day:nth-last-child(-n+7) {
  border-bottom: none;
}

.calendar-day-number {
  font-size: 0.8rem;
  font-weight: 500;
  padding: 0.125rem 0.25rem;
  color: var(--text-secondary);
}

.calendar-today {
  background: var(--primary-subtle);
}

.calendar-today .calendar-day-number {
  color: var(--primary);
  font-weight: 700;
}

.calendar-outside {
  opacity: 0.4;
}

.calendar-day-cards {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.calendar-card-chip {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.375rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 0.75rem;
  line-height: 1.3;
  transition: background 0.1s;
  overflow: hidden;
}

.calendar-card-chip:hover {
  background: var(--bg-raised);
}

.chip-column-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.chip-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-more-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 0.7rem;
  padding: 0.125rem 0.375rem;
  cursor: pointer;
  text-align: left;
}

.calendar-more-btn:hover {
  color: var(--primary);
}
```

**Step 3: Commit**

```bash
git add client/src/components/CalendarView.tsx client/src/index.css
git commit -m "feat: Create CalendarView component with month grid and navigation"
```

---

### Task 4: Add week view to CalendarView

**Files:**
- Modify: `client/src/components/CalendarView.tsx`
- Modify: `client/src/index.css`

**Step 1: Add renderWeekView**

```tsx
const renderWeekView = () => {
  const days = getWeekDays(currentDate);
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="calendar-grid week-grid">
      {days.map((date, i) => {
        const dateKey = formatDateKey(date);
        const cards = getCardsForDate(date);
        const todayClass = isToday(date) ? ' calendar-today' : '';

        return (
          <div key={i} className={`calendar-day calendar-week-day${todayClass}`} data-date={dateKey}>
            <div className="calendar-week-day-header">
              <span className="calendar-week-day-name">{dayLabels[i]}</span>
              <span className="calendar-day-number">{date.getDate()}</span>
            </div>
            <div className="calendar-day-cards">
              {cards.map(({ card, columnName }) => (
                <CalendarCardChip
                  key={card.id}
                  card={card}
                  columnName={columnName}
                  onClick={() => onCardClick(card, columnName)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
```

**Step 2: Add formatWeekRange helper**

```tsx
function formatWeekRange(date: Date): string {
  const days = getWeekDays(date);
  const first = days[0];
  const last = days[6];
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const yearSuffix = first.getFullYear() !== last.getFullYear()
    ? `, ${last.getFullYear()}`
    : '';
  return `${first.toLocaleDateString('en-US', opts)} – ${last.toLocaleDateString('en-US', opts)}${yearSuffix}`;
}
```

**Step 3: Add week view CSS**

```css
/* Week view */
.week-grid {
  grid-template-columns: repeat(7, 1fr);
  grid-template-rows: 1fr;
}

.calendar-week-day {
  min-height: 20rem;
}

.calendar-week-day-header {
  display: flex;
  align-items: baseline;
  gap: 0.375rem;
  padding: 0.375rem;
  border-bottom: 1px solid var(--border);
}

.calendar-week-day-name {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
}

.calendar-week-day .calendar-day-cards {
  padding: 0.25rem;
  overflow-y: auto;
}

.week-grid .calendar-card-chip {
  white-space: normal;
  padding: 0.25rem 0.375rem;
}
```

**Step 4: Commit**

```bash
git add client/src/components/CalendarView.tsx client/src/index.css
git commit -m "feat: Add week view to CalendarView"
```

---

### Task 5: Wire CalendarView into KanbanBoard with DnD

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx`
- Modify: `client/src/components/CalendarView.tsx`

**Step 1: Update CalendarView to use Droppable/Draggable**

Add DnD imports to CalendarView:
```tsx
import { Droppable, Draggable } from 'react-beautiful-dnd';
```

Wrap each day cell in a `Droppable`:
```tsx
<Droppable droppableId={`calendar-${dateKey}`} type="CALENDAR">
  {(provided, snapshot) => (
    <div
      className={`calendar-day${todayClass}${outsideClass}${snapshot.isDraggingOver ? ' calendar-drag-over' : ''}`}
      data-date={dateKey}
      ref={provided.innerRef}
      {...provided.droppableProps}
    >
      <div className="calendar-day-number">{date.getDate()}</div>
      <div className="calendar-day-cards">
        {cards.slice(0, maxVisible).map(({ card, columnName }, cardIndex) => (
          <Draggable key={card.id} draggableId={card.id} index={cardIndex}>
            {(provided) => (
              <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                <CalendarCardChip card={card} columnName={columnName} onClick={() => onCardClick(card, columnName)} />
              </div>
            )}
          </Draggable>
        ))}
        {provided.placeholder}
      </div>
    </div>
  )}
</Droppable>
```

Add `isAdmin` prop to CalendarView and conditionally disable DnD:
```tsx
interface CalendarViewProps {
  board: Board;
  onCardClick: (card: Card, columnName: string) => void;
  filterCard: (card: Card) => boolean;
  isAdmin: boolean;
}
```

Use `isDragDisabled={!isAdmin}` on each `Draggable`.

**Step 2: Conditionally render CalendarView in KanbanBoard**

In KanbanBoard, move the `DragDropContext` to wrap both views. Replace the block from the opening `<DragDropContext>` through the closing `</DragDropContext>` (lines 521-647) with a conditional:

```tsx
<DragDropContext onDragEnd={handleDragEnd}>
  {viewMode === 'calendar' ? (
    <div className="calendar-layout">
      <CalendarView
        board={board}
        onCardClick={handleCalendarCardClick}
        filterCard={filterCard}
        isAdmin={isAdmin}
      />
      <UnscheduledSidebar
        board={board}
        filterCard={filterCard}
        onCardClick={handleCalendarCardClick}
        isAdmin={isAdmin}
      />
    </div>
  ) : (
    <Droppable droppableId="board" direction="horizontal" type="COLUMN" isDropDisabled={!isAdmin}>
      {/* ... existing column rendering, unchanged ... */}
    </Droppable>
  )}
</DragDropContext>
```

**Step 3: Extend handleDragEnd for calendar drops**

In `handleDragEnd` (lines 200-265), add a branch for CALENDAR type drops. Calendar droppable IDs use the format `calendar-YYYY-MM-DD` or `unscheduled`:

```tsx
if (type === 'CALENDAR') {
  const cardId = result.draggableId;
  const destId = destination.droppableId;

  let newDueDate: string | null = null;
  if (destId.startsWith('calendar-')) {
    newDueDate = destId.replace('calendar-', '');
  }
  // destId === 'unscheduled' means clearing the date (newDueDate stays null)

  try {
    await api.updateCard(cardId, { due_date: newDueDate } as any);
    socket?.emit('board-updated', boardId);
    await loadBoard();
  } catch (error) {
    console.error('Failed to update card date:', error);
    loadBoard();
  }
  return;
}
```

Add this block right after the `if (!destination) return;` guard, before the existing `if (type === 'COLUMN')` block.

**Step 4: Add handleCalendarCardClick placeholder**

```tsx
const [calendarPopoverCard, setCalendarPopoverCard] = useState<{ card: Card; columnName: string } | null>(null);

const handleCalendarCardClick = (card: Card, columnName: string) => {
  setCalendarPopoverCard({ card, columnName });
};
```

**Step 5: Add calendar drag-over CSS**

```css
.calendar-drag-over {
  background: var(--primary-subtle);
}

.calendar-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}
```

**Step 6: Commit**

```bash
git add client/src/components/KanbanBoard.tsx client/src/components/CalendarView.tsx client/src/index.css
git commit -m "feat: Wire CalendarView into KanbanBoard with drag-and-drop"
```

---

### Task 6: Create UnscheduledSidebar component

**Files:**
- Create: `client/src/components/UnscheduledSidebar.tsx`
- Modify: `client/src/index.css`

**Step 1: Create UnscheduledSidebar.tsx**

```tsx
import { useState } from 'react';
import { Droppable, Draggable } from 'react-beautiful-dnd';
import { Board, Card } from '../types';

interface UnscheduledSidebarProps {
  board: Board;
  filterCard: (card: Card) => boolean;
  onCardClick: (card: Card, columnName: string) => void;
  isAdmin: boolean;
}

export default function UnscheduledSidebar({ board, filterCard, onCardClick, isAdmin }: UnscheduledSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  const unscheduledCards: { card: Card; columnName: string }[] = [];
  board.columns?.forEach(col => {
    col.cards?.filter(c => !c.due_date && !c.archived && filterCard(c)).forEach(card => {
      unscheduledCards.push({ card, columnName: col.name });
    });
  });

  return (
    <div className={`unscheduled-sidebar${collapsed ? ' collapsed' : ''}`}>
      <button className="unscheduled-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="unscheduled-title">Unscheduled</span>
        <span className="unscheduled-count">{unscheduledCards.length}</span>
        <span className={`unscheduled-arrow${collapsed ? ' rotated' : ''}`}>‹</span>
      </button>
      {!collapsed && (
        <Droppable droppableId="unscheduled" type="CALENDAR">
          {(provided, snapshot) => (
            <div
              className={`unscheduled-list${snapshot.isDraggingOver ? ' unscheduled-drag-over' : ''}`}
              ref={provided.innerRef}
              {...provided.droppableProps}
            >
              {unscheduledCards.map(({ card, columnName }, index) => (
                <Draggable key={card.id} draggableId={card.id} index={index} isDragDisabled={!isAdmin}>
                  {(provided) => (
                    <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                      <div className="calendar-card-chip sidebar-chip" onClick={() => onCardClick(card, columnName)}>
                        <span className="chip-column-dot" style={{ background: 'var(--primary)' }} />
                        <span className="chip-title">{card.title}</span>
                      </div>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
              {unscheduledCards.length === 0 && (
                <div className="unscheduled-empty">No unscheduled cards</div>
              )}
            </div>
          )}
        </Droppable>
      )}
    </div>
  );
}
```

**Step 2: Add sidebar CSS**

```css
/* ---- Unscheduled Sidebar ---- */

.unscheduled-sidebar {
  width: 220px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: var(--bg);
  display: flex;
  flex-direction: column;
  transition: width 0.2s var(--ease);
}

.unscheduled-sidebar.collapsed {
  width: 40px;
}

.unscheduled-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text);
  text-align: left;
  width: 100%;
}

.unscheduled-header:hover {
  background: var(--bg-raised);
}

.unscheduled-title {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
}

.collapsed .unscheduled-title,
.collapsed .unscheduled-count {
  display: none;
}

.unscheduled-count {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  padding: 0 0.375rem;
  border-radius: var(--radius-pill);
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.unscheduled-arrow {
  font-size: 1rem;
  transition: transform 0.2s var(--ease);
}

.unscheduled-arrow.rotated {
  transform: rotate(180deg);
}

.unscheduled-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.unscheduled-drag-over {
  background: var(--primary-subtle);
}

.sidebar-chip {
  white-space: normal;
  padding: 0.375rem;
}

.unscheduled-empty {
  color: var(--text-secondary);
  font-size: 0.8rem;
  text-align: center;
  padding: 1rem 0.5rem;
}
```

**Step 3: Commit**

```bash
git add client/src/components/UnscheduledSidebar.tsx client/src/index.css
git commit -m "feat: Create UnscheduledSidebar with DnD support"
```

---

### Task 7: Add card popover with "Open in Board"

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx`
- Modify: `client/src/components/CalendarView.tsx` (pass popover trigger position)
- Modify: `client/src/index.css`

**Step 1: Add popover state and rendering to KanbanBoard**

The popover shows when `calendarPopoverCard` is set (from Task 5 Step 4). Add popover position tracking and render logic.

Add to KanbanBoard:
```tsx
const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
const popoverRef = useRef<HTMLDivElement>(null);

const handleCalendarCardClick = (card: Card, columnName: string, event: React.MouseEvent) => {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  setPopoverPos({ top: rect.bottom + 4, left: rect.left });
  setCalendarPopoverCard({ card, columnName });
};

// Close popover on outside click
useEffect(() => {
  if (!calendarPopoverCard) return;
  const handleClick = (e: MouseEvent) => {
    if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
      setCalendarPopoverCard(null);
    }
  };
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setCalendarPopoverCard(null);
  };
  document.addEventListener('mousedown', handleClick);
  document.addEventListener('keydown', handleKey);
  return () => {
    document.removeEventListener('mousedown', handleClick);
    document.removeEventListener('keydown', handleKey);
  };
}, [calendarPopoverCard]);

const handleOpenInBoard = (cardId: string) => {
  setCalendarPopoverCard(null);
  onViewChange('board');
  // Small delay to let the board render, then open the card
  setTimeout(() => setEditingCardId(cardId), 100);
};
```

Render the popover (inside the calendar layout area):
```tsx
{calendarPopoverCard && popoverPos && (
  <div
    className="calendar-popover"
    ref={popoverRef}
    style={{ top: popoverPos.top, left: popoverPos.left }}
  >
    <h4 className="popover-title">{calendarPopoverCard.card.title}</h4>
    <div className="popover-meta">
      <span className="popover-column">{calendarPopoverCard.columnName}</span>
      {calendarPopoverCard.card.due_date && (
        <span className="popover-due">{new Date(calendarPopoverCard.card.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      )}
    </div>
    {calendarPopoverCard.card.assignees && calendarPopoverCard.card.assignees.length > 0 && (
      <div className="popover-assignees">
        {calendarPopoverCard.card.assignees.join(', ')}
      </div>
    )}
    {calendarPopoverCard.card.labels && calendarPopoverCard.card.labels.length > 0 && (
      <div className="popover-labels">
        {calendarPopoverCard.card.labels.map(l => (
          <span key={l.id} className="popover-label" style={{ background: l.color }}>{l.name}</span>
        ))}
      </div>
    )}
    {calendarPopoverCard.card.checklist && (
      <div className="popover-checklist">
        Checklist: {calendarPopoverCard.card.checklist.checked}/{calendarPopoverCard.card.checklist.total}
      </div>
    )}
    {calendarPopoverCard.card.description && (
      <p className="popover-description">{calendarPopoverCard.card.description.slice(0, 120)}{calendarPopoverCard.card.description.length > 120 ? '...' : ''}</p>
    )}
    <button className="btn-secondary btn-sm popover-open-btn" onClick={() => handleOpenInBoard(calendarPopoverCard.card.id)}>
      Open in Board
    </button>
  </div>
)}
```

**Step 2: Update CalendarView onCardClick signature to pass event**

Update the `CalendarViewProps` interface:
```tsx
onCardClick: (card: Card, columnName: string, event: React.MouseEvent) => void;
```

Update `CalendarCardChip` onClick to pass the event:
```tsx
onClick={(e) => onClick(e)}
```

And the chip's `onClick` prop type:
```tsx
onClick: (e: React.MouseEvent) => void;
```

**Step 3: Add popover CSS**

```css
/* ---- Calendar Popover ---- */

.calendar-popover {
  position: fixed;
  z-index: 100;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 0.75rem;
  width: 260px;
  max-width: 90vw;
  animation: fadeIn 0.1s var(--ease);
}

.popover-title {
  font-size: 0.9rem;
  font-weight: 600;
  margin: 0 0 0.5rem;
}

.popover-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.popover-column {
  background: var(--bg-raised);
  padding: 0.125rem 0.5rem;
  border-radius: var(--radius-pill);
  font-size: 0.7rem;
  font-weight: 500;
}

.popover-due {
  font-weight: 500;
}

.popover-assignees {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: 0.375rem;
}

.popover-labels {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
  margin-bottom: 0.375rem;
}

.popover-label {
  padding: 0.125rem 0.5rem;
  border-radius: var(--radius-pill);
  font-size: 0.65rem;
  font-weight: 600;
  color: white;
}

.popover-checklist {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: 0.375rem;
}

.popover-description {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin: 0 0 0.75rem;
  line-height: 1.4;
}

.popover-open-btn {
  width: 100%;
}
```

**Step 4: Commit**

```bash
git add client/src/components/KanbanBoard.tsx client/src/components/CalendarView.tsx client/src/index.css
git commit -m "feat: Add card popover with Open in Board action"
```

---

### Task 8: Mobile responsiveness

**Files:**
- Modify: `client/src/index.css`
- Modify: `client/src/components/UnscheduledSidebar.tsx` (bottom sheet behavior)

**Step 1: Add mobile calendar CSS**

In the existing `@media (max-width: 768px)` block:

```css
/* Calendar mobile */
.calendar-layout {
  flex-direction: column;
}

.calendar-day {
  min-height: 3.5rem;
}

.calendar-nav {
  flex-wrap: wrap;
}

.calendar-nav-title {
  font-size: 0.95rem;
}

.unscheduled-sidebar {
  width: 100%;
  border-left: none;
  border-top: 1px solid var(--border);
  max-height: 40vh;
}

.unscheduled-sidebar.collapsed {
  width: 100%;
  max-height: 40px;
}

.calendar-week-day {
  min-height: 10rem;
}

.calendar-popover {
  left: 50% !important;
  transform: translateX(-50%);
  bottom: 1rem;
  top: auto !important;
}
```

**Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "style: Add mobile responsiveness for calendar view"
```

---

### Task 9: Manual testing checklist

**No code changes — just verification.**

**Step 1: Test view toggle and URL routing**
- Navigate to a board → see Kanban view (default)
- Click calendar icon → URL changes to `/board-slug/calendar`, calendar renders
- Click board icon → URL changes back to `/board-slug`, Kanban renders
- Direct URL to `/board-slug/calendar` → calendar loads
- Browser back/forward between views works

**Step 2: Test month view**
- Month grid shows correct days
- Today is highlighted
- Cards with due dates appear on correct days
- Outside-month days are grayed
- Prev/Next arrows navigate months
- "Today" button jumps to current month

**Step 3: Test week view**
- Switch to week view → shows 7 day columns
- Cards appear on correct days
- Prev/Next navigate by week
- Taller cells show more cards without truncation

**Step 4: Test drag and drop**
- Drag card from unscheduled sidebar → calendar day: date gets assigned
- Drag card from one day → another day: date updates
- Drag card from calendar day → unscheduled sidebar: date cleared
- Non-admin users cannot drag
- Socket.IO broadcasts update (check in second browser tab)

**Step 5: Test card popover**
- Click card on calendar → popover appears
- Popover shows: title, column, due date, assignees, labels, checklist, description preview
- "Open in Board" → switches to Kanban view, card is open for editing
- Click outside popover → dismisses
- Escape key → dismisses

**Step 6: Test unscheduled sidebar**
- Shows cards with no due date
- Collapse/expand toggle works
- Filters apply to sidebar cards
- Empty state message when no unscheduled cards

**Step 7: Test mobile**
- Sidebar becomes bottom sheet
- Calendar cells are smaller
- Popover centers on screen
- View toggle works
