# Mobile Calendar Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the clunky mobile calendar month/week views with an agenda-first layout — scrolling timeline of days with cards, collapsible mini-calendar strip for navigation.

**Architecture:** Two new components (`MiniCalStrip` and `MobileAgendaView`) replace the mobile-only render methods in `CalendarView.tsx`. The parent `CalendarView` delegates to these on mobile instead of `renderMobileMonthView` / `renderMobileWeekView`. The `UnscheduledSidebar` is hidden on mobile — unscheduled cards appear as the last group in the agenda. Desktop is untouched.

**Tech Stack:** React 18, TypeScript, CSS (no new dependencies). IntersectionObserver for scroll-sync between agenda and mini-cal.

**Design doc:** `docs/plans/2026-02-15-mobile-calendar-overhaul-design.md`

---

### Task 1: Create MiniCalStrip Component

**Files:**
- Create: `client/src/components/MiniCalStrip.tsx`

This component renders the collapsible mini-calendar at the top of the mobile calendar. Default: a single-row week strip. Expanded: the full month grid.

**Step 1: Create `MiniCalStrip.tsx` with week strip rendering**

```tsx
import { useState, useEffect, useMemo } from 'react';

interface MiniCalStripProps {
  currentDate: Date;
  activeDate: Date;
  onSelectDate: (date: Date) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  cardDateSet: Set<string>;
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isToday(date: Date): boolean {
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function getWeekDays(date: Date): Date[] {
  const day = date.getDay();
  const start = new Date(date);
  start.setDate(start.getDate() - day);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

function getMonthDays(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const days: Date[] = [];
  for (let i = startOffset - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i));
  }
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(new Date(year, month, i));
  }
  while (days.length % 7 !== 0) {
    const last = days[days.length - 1];
    days.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
  }
  return days;
}

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export default function MiniCalStrip({ currentDate, activeDate, onSelectDate, onPrev, onNext, onToday, cardDateSet }: MiniCalStripProps) {
  const [expanded, setExpanded] = useState(false);

  const weekDays = useMemo(() => getWeekDays(activeDate), [activeDate]);
  const monthDays = useMemo(() => getMonthDays(currentDate.getFullYear(), currentDate.getMonth()), [currentDate]);

  const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const handleDayClick = (date: Date) => {
    onSelectDate(date);
    if (expanded) setExpanded(false);
  };

  const renderDayCell = (date: Date, isCurrentMonth?: boolean) => {
    const key = formatDateKey(date);
    const today = isToday(date);
    const active = formatDateKey(activeDate) === key;
    const hasCards = cardDateSet.has(key);
    const outside = isCurrentMonth === false;

    return (
      <button
        key={key + (outside ? '-out' : '')}
        className={`mini-cal-day${today ? ' mini-cal-today' : ''}${active ? ' mini-cal-active' : ''}${outside ? ' mini-cal-outside' : ''}`}
        onClick={() => handleDayClick(date)}
      >
        <span className="mini-cal-num">{date.getDate()}</span>
        {hasCards && <span className="mini-cal-dot" />}
      </button>
    );
  };

  return (
    <div className="mini-cal-strip">
      <div className="mini-cal-header">
        <button className="cal-nav-arrow" onClick={onPrev} aria-label="Previous">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h2 className="mini-cal-title">
          {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
        </h2>
        <button className="cal-nav-arrow" onClick={onNext} aria-label="Next">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <button className="cal-today-btn" onClick={onToday}>Today</button>
      </div>

      {expanded ? (
        <div className="mini-cal-month">
          {dayNames.map((d, i) => (
            <div key={i} className="mini-cal-day-header">{d}</div>
          ))}
          {monthDays.map((date) => renderDayCell(date, date.getMonth() === currentDate.getMonth()))}
        </div>
      ) : (
        <div className="mini-cal-week">
          {dayNames.map((d, i) => (
            <div key={i} className="mini-cal-day-header">{d}</div>
          ))}
          {weekDays.map((date) => renderDayCell(date))}
        </div>
      )}

      <button className="mini-cal-toggle" onClick={() => setExpanded(!expanded)} aria-label={expanded ? 'Collapse calendar' : 'Expand calendar'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={expanded ? 'mini-cal-chevron-up' : 'mini-cal-chevron-down'}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/components/MiniCalStrip.tsx
git commit -m "feat: add MiniCalStrip component for mobile calendar"
```

---

### Task 2: Create MobileAgendaView Component

**Files:**
- Create: `client/src/components/MobileAgendaView.tsx`

The scrollable agenda list grouped by date with sticky headers, overdue section, and unscheduled group at the bottom.

**Step 1: Create `MobileAgendaView.tsx`**

```tsx
import { useEffect, useRef, useMemo, useState } from 'react';
import { Board, Card } from '../types';
import { MobileCalendarCard } from './CalendarView';

interface MobileAgendaViewProps {
  board: Board;
  filterCard: (card: Card) => boolean;
  isAdmin: boolean;
  onOpenInBoard: (cardId: string) => void;
  onChangeDate: (cardId: string, date: string) => void;
  onRemoveDate: (cardId: string) => void;
  onActiveDateChange: (date: Date) => void;
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isToday(dateKey: string): boolean {
  return dateKey === formatDateKey(new Date());
}

function isTomorrow(dateKey: string): boolean {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  return dateKey === formatDateKey(t);
}

function formatGroupHeader(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
  const monthDay = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  if (isToday(dateKey)) return `Today — ${weekday}, ${monthDay}`;
  if (isTomorrow(dateKey)) return `Tomorrow — ${weekday}, ${monthDay}`;
  return `${weekday}, ${monthDay}`;
}

interface DateGroup {
  dateKey: string;
  cards: { card: Card; columnName: string }[];
}

export default function MobileAgendaView({ board, filterCard, isAdmin, onOpenInBoard, onChangeDate, onRemoveDate, onActiveDateChange }: MobileAgendaViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [overdueCollapsed, setOverdueCollapsed] = useState(false);
  const [unscheduledCollapsed, setUnscheduledCollapsed] = useState(false);
  const hasScrolledRef = useRef(false);
  const dateInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Collect all cards into groups
  const { overdueGroups, upcomingGroups, unscheduledCards } = useMemo(() => {
    const todayKey = formatDateKey(new Date());
    const dateMap = new Map<string, { card: Card; columnName: string }[]>();
    const unscheduled: { card: Card; columnName: string }[] = [];

    board.columns?.forEach(col => {
      col.cards?.forEach(card => {
        if (card.archived || !filterCard(card)) return;
        if (!card.due_date) {
          unscheduled.push({ card, columnName: col.name });
          return;
        }
        const dateKey = card.due_date.split('T')[0];
        if (!dateMap.has(dateKey)) dateMap.set(dateKey, []);
        dateMap.get(dateKey)!.push({ card, columnName: col.name });
      });
    });

    const overdue: DateGroup[] = [];
    const upcoming: DateGroup[] = [];

    const sortedKeys = Array.from(dateMap.keys()).sort();
    for (const key of sortedKeys) {
      const group = { dateKey: key, cards: dateMap.get(key)! };
      if (key < todayKey) {
        overdue.push(group);
      } else {
        upcoming.push(group);
      }
    }

    return { overdueGroups: overdue, upcomingGroups: upcoming, unscheduledCards: unscheduled };
  }, [board, filterCard]);

  // Build a set of dates that have cards (for the mini-cal)
  const cardDateSet = useMemo(() => {
    const s = new Set<string>();
    [...overdueGroups, ...upcomingGroups].forEach(g => s.add(g.dateKey));
    return s;
  }, [overdueGroups, upcomingGroups]);

  // Auto-scroll to today (or nearest future date) on first render
  useEffect(() => {
    if (hasScrolledRef.current) return;
    hasScrolledRef.current = true;

    const todayKey = formatDateKey(new Date());
    // Find today or nearest future group
    let targetKey = upcomingGroups.length > 0 ? upcomingGroups[0].dateKey : null;
    for (const g of upcomingGroups) {
      if (g.dateKey >= todayKey) { targetKey = g.dateKey; break; }
    }

    if (targetKey) {
      const el = headerRefs.current.get(targetKey);
      if (el && scrollRef.current) {
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
          el.scrollIntoView({ block: 'start' });
        });
      }
    }
  }, [upcomingGroups]);

  // IntersectionObserver to sync active date with mini-cal
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the topmost visible header
        let topEntry: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!topEntry || entry.boundingClientRect.top < topEntry.boundingClientRect.top) {
              topEntry = entry;
            }
          }
        }
        if (topEntry) {
          const dateKey = (topEntry.target as HTMLElement).dataset.dateKey;
          if (dateKey && dateKey !== 'overdue' && dateKey !== 'unscheduled') {
            const [y, m, d] = dateKey.split('-').map(Number);
            onActiveDateChange(new Date(y, m - 1, d));
          }
        }
      },
      { root: container, rootMargin: '0px 0px -80% 0px', threshold: 0 }
    );

    headerRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [overdueGroups, upcomingGroups, onActiveDateChange]);

  // Scroll to a date group (called by parent when mini-cal day is tapped)
  // Exposed via ref — we'll use a callback pattern instead
  const scrollToDate = (dateKey: string) => {
    const el = headerRefs.current.get(dateKey);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // If no exact match, find nearest future date
    const allKeys = upcomingGroups.map(g => g.dateKey);
    const nearest = allKeys.find(k => k >= dateKey);
    if (nearest) {
      const nearestEl = headerRefs.current.get(nearest);
      nearestEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Expose scrollToDate to parent
  useEffect(() => {
    (scrollRef.current as any)?.__scrollToDate && delete (scrollRef.current as any).__scrollToDate;
    if (scrollRef.current) {
      (scrollRef.current as any).__scrollToDate = scrollToDate;
    }
  });

  const setHeaderRef = (key: string, el: HTMLDivElement | null) => {
    if (el) headerRefs.current.set(key, el);
    else headerRefs.current.delete(key);
  };

  const setDateInputRef = (cardId: string, el: HTMLInputElement | null) => {
    if (el) dateInputRefs.current.set(cardId, el);
    else dateInputRefs.current.delete(cardId);
  };

  const renderGroup = (group: DateGroup) => (
    <div key={group.dateKey} className="agenda-group">
      <div
        className={`agenda-date-header${isToday(group.dateKey) ? ' agenda-today' : ''}`}
        ref={(el) => setHeaderRef(group.dateKey, el)}
        data-date-key={group.dateKey}
      >
        {formatGroupHeader(group.dateKey)}
        <span className="agenda-date-count">{group.cards.length}</span>
      </div>
      <div className="agenda-group-cards">
        {group.cards.map(({ card, columnName }) => (
          <MobileCalendarCard
            key={card.id}
            card={card}
            columnName={columnName}
            onOpenInBoard={onOpenInBoard}
            onChangeDate={onChangeDate}
            onRemoveDate={onRemoveDate}
            isAdmin={isAdmin}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="mobile-agenda" ref={scrollRef}>
      {overdueGroups.length > 0 && (
        <div className="agenda-overdue-section">
          <button
            className="agenda-overdue-header"
            onClick={() => setOverdueCollapsed(!overdueCollapsed)}
            ref={(el) => setHeaderRef('overdue', el)}
            data-date-key="overdue"
          >
            <span className="agenda-overdue-label">Overdue</span>
            <span className="agenda-overdue-count">{overdueGroups.reduce((n, g) => n + g.cards.length, 0)}</span>
            <span className={`agenda-collapse-arrow${overdueCollapsed ? ' rotated' : ''}`}>&#x2039;</span>
          </button>
          {!overdueCollapsed && overdueGroups.map(renderGroup)}
        </div>
      )}

      {upcomingGroups.map(renderGroup)}

      {(upcomingGroups.length === 0 && overdueGroups.length === 0) && (
        <div className="agenda-empty">No scheduled cards</div>
      )}

      <div className="agenda-unscheduled-section">
        <button
          className="agenda-unscheduled-header"
          onClick={() => setUnscheduledCollapsed(!unscheduledCollapsed)}
          ref={(el) => setHeaderRef('unscheduled', el)}
          data-date-key="unscheduled"
        >
          <span className="agenda-unscheduled-label">Unscheduled</span>
          <span className="agenda-unscheduled-count">{unscheduledCards.length}</span>
          <span className={`agenda-collapse-arrow${unscheduledCollapsed ? ' rotated' : ''}`}>&#x2039;</span>
        </button>
        {!unscheduledCollapsed && (
          <div className="agenda-group-cards">
            {unscheduledCards.length === 0 ? (
              <div className="agenda-empty-inline">No unscheduled cards</div>
            ) : (
              unscheduledCards.map(({ card, columnName }) => (
                <div key={card.id} className="mobile-cal-card" onClick={() => onOpenInBoard(card.id)}>
                  <div className="mobile-cal-card-info">
                    <span className="mobile-cal-card-title">{card.title}</span>
                    <span className="mobile-cal-card-col">{columnName}</span>
                  </div>
                  {isAdmin && (
                    <div className="mobile-cal-card-actions" onClick={e => e.stopPropagation()}>
                      <button
                        className="mobile-cal-card-btn"
                        onClick={() => dateInputRefs.current.get(card.id)?.showPicker()}
                        title="Set date"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                      </button>
                      <input
                        ref={(el) => setDateInputRef(card.id, el)}
                        type="date"
                        className="chip-date-input"
                        value=""
                        onChange={e => { if (e.target.value) onChangeDate(card.id, e.target.value); }}
                        onClick={e => e.stopPropagation()}
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Helper: expose cardDateSet for parent to pass to MiniCalStrip
export { formatDateKey };
```

**Step 2: Commit**

```bash
git add client/src/components/MobileAgendaView.tsx
git commit -m "feat: add MobileAgendaView component for mobile calendar agenda"
```

---

### Task 3: Wire Components into CalendarView

**Files:**
- Modify: `client/src/components/CalendarView.tsx`

Replace the mobile rendering path. The `isMobile` branch now renders `MiniCalStrip` + `MobileAgendaView` instead of `renderMobileMonthView` / `renderMobileWeekView` and the Month/Week toggle.

**Step 1: Update CalendarView to use new components on mobile**

At the top of the file, add imports:

```tsx
import MiniCalStrip from './MiniCalStrip';
import MobileAgendaView, { formatDateKey as agendaFormatDateKey } from './MobileAgendaView';
```

Add state for activeDate and a ref for the agenda scroll container:

```tsx
const [activeDate, setActiveDate] = useState<Date>(() => new Date());
const agendaContainerRef = useRef<HTMLDivElement>(null);
```

Add a `cardDateSet` memo (for mini-cal dots):

```tsx
const cardDateSet = useMemo(() => {
  const s = new Set<string>();
  board.columns?.forEach(col => {
    col.cards?.forEach(card => {
      if (card.archived || !card.due_date || !filterCard(card)) return;
      s.add(card.due_date.split('T')[0]);
    });
  });
  return s;
}, [board, filterCard]);
```

Add a handler for mini-cal day taps that scrolls the agenda:

```tsx
const handleMiniCalSelect = (date: Date) => {
  setActiveDate(date);
  // Update currentDate to match the selected date's month
  setCurrentDate(new Date(date.getFullYear(), date.getMonth(), 1));
  // Scroll agenda to this date
  const container = agendaContainerRef.current;
  if (container) {
    const scrollFn = (container as any).__scrollToDate;
    if (scrollFn) scrollFn(formatDateKey(date));
  }
};
```

Replace the mobile branch in the return JSX. The `isMobile` path becomes:

```tsx
{isMobile ? (
  <>
    <MiniCalStrip
      currentDate={currentDate}
      activeDate={activeDate}
      onSelectDate={handleMiniCalSelect}
      onPrev={handlePrev}
      onNext={handleNext}
      onToday={handleToday}
      cardDateSet={cardDateSet}
    />
    <div ref={agendaContainerRef} style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <MobileAgendaView
        board={board}
        filterCard={filterCard}
        isAdmin={isAdmin}
        onOpenInBoard={onOpenInBoard}
        onChangeDate={onChangeDate}
        onRemoveDate={onRemoveDate}
        onActiveDateChange={setActiveDate}
      />
    </div>
  </>
) : (
  /* existing desktop JSX unchanged */
)}
```

Remove the mobile nav block (`cal-mobile-nav`), `renderMobileMonthView`, and `renderMobileWeekView` methods — they are no longer called. Keep `selectedDate` state only if desktop needs it (it doesn't), so remove it too. Keep `viewType` state but only use it in the desktop path.

**Step 2: Clean up unused mobile code**

Delete these methods from `CalendarView.tsx`:
- `renderMobileMonthView` (lines ~379-445)
- `renderMobileWeekView` (lines ~447-483)

Remove the mobile nav JSX block (the `isMobile ? (<div className="cal-mobile-nav">...)` branch in the return).

Remove `selectedDate` state and its `useEffect` sync (lines ~185-200).

The `viewType` state and Month/Week toggle remain for desktop only.

**Step 3: Commit**

```bash
git add client/src/components/CalendarView.tsx
git commit -m "feat: wire MiniCalStrip + MobileAgendaView into mobile calendar path"
```

---

### Task 4: Hide UnscheduledSidebar on Mobile

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx:668-690`

The unscheduled cards are now in the agenda, so we skip rendering `UnscheduledSidebar` on mobile.

**Step 1: Conditionally render UnscheduledSidebar**

In `KanbanBoard.tsx`, around line 680, wrap the `<UnscheduledSidebar>` in a mobile check:

```tsx
{!isMobile && (
  <UnscheduledSidebar
    board={board}
    filterCard={filterCard}
    onCardClick={handleCalendarCardClick}
    isAdmin={isAdmin}
    isMobile={false}
    onOpenInBoard={handleOpenInBoard}
    onChangeDate={handleCalendarChangeDate}
    onRemoveDate={handleCalendarRemoveDate}
    customOrder={unscheduledOrder}
  />
)}
```

**Step 2: Commit**

```bash
git add client/src/components/KanbanBoard.tsx
git commit -m "feat: hide UnscheduledSidebar on mobile — agenda handles unscheduled"
```

---

### Task 5: CSS for MiniCalStrip

**Files:**
- Modify: `client/src/index.css` (inside the `@media (max-width: 768px)` block, around line 3672)

**Step 1: Add MiniCalStrip styles**

Add these rules inside the existing `@media (max-width: 768px)` block, replacing the old mobile calendar nav and grid styles. The old `.cal-mobile-nav`, `.cal-mobile-grid`, `.cal-m-*` rules can be removed since those components no longer render on mobile.

```css
/* Mini-cal strip */
.mini-cal-strip {
  flex-shrink: 0;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.25rem;
}

.mini-cal-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  padding: 0.375rem 0.5rem 0.125rem;
}

.mini-cal-title {
  font-family: var(--font-display);
  font-size: 1.05rem;
  font-weight: 700;
  margin: 0;
  min-width: 10rem;
  text-align: center;
}

.mini-cal-week,
.mini-cal-month {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  padding: 0 0.25rem;
}

.mini-cal-day-header {
  text-align: center;
  font-size: 0.6rem;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 0.25rem 0 0.125rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.mini-cal-day {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0.125rem 0;
  min-height: 2.375rem;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text);
  gap: 2px;
  -webkit-tap-highlight-color: transparent;
}

.mini-cal-num {
  font-size: 0.8rem;
  font-weight: 500;
  width: 1.875rem;
  height: 1.875rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: all 0.15s var(--ease);
}

.mini-cal-today:not(.mini-cal-active) .mini-cal-num {
  font-weight: 700;
  color: var(--primary);
  box-shadow: inset 0 0 0 1.5px var(--primary);
}

.mini-cal-active .mini-cal-num {
  background: var(--primary);
  color: white;
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
}

.mini-cal-outside {
  opacity: 0.28;
}

.mini-cal-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--primary);
}

.mini-cal-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 0.125rem 0;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.mini-cal-chevron-up {
  transform: rotate(180deg);
  transition: transform 0.2s var(--ease);
}

.mini-cal-chevron-down {
  transition: transform 0.2s var(--ease);
}

/* Expand/collapse animation */
.mini-cal-month {
  animation: miniCalExpand 0.2s var(--ease);
}

@keyframes miniCalExpand {
  from { opacity: 0; max-height: 2.75rem; }
  to { opacity: 1; max-height: 20rem; }
}
```

**Step 2: Remove old mobile calendar CSS**

Delete the following rule blocks that are no longer used (inside the `@media (max-width: 768px)` block):
- `.cal-mobile-nav` and children (`.cal-mobile-nav-title`, `.cal-mobile-nav-title h2`, `.cal-mobile-nav-controls`)
- `.cal-mobile-month`
- `.cal-mobile-grid`
- `.cal-m-day-header`, `.cal-m-day`, `.cal-m-num`, `.cal-m-today`, `.cal-m-selected`, `.cal-m-outside`, `.cal-m-dots`, `.cal-m-dot`, `.cal-m-outside .cal-m-dot`
- `.cal-day-panel` and children (`.cal-day-panel-header`, `.cal-day-panel-date`, `.cal-day-panel-count`, `.cal-day-panel-list`, `.cal-day-panel-empty`)
- `.cal-mobile-week`
- `.cal-week-section` and children (`.cal-week-section:last-child`, `.cal-week-empty`, `.cal-week-section-header`, `.cal-week-today`, `.cal-week-section-count`, `.cal-week-section-cards`)

Keep: `.cal-nav-arrow`, `.cal-today-btn`, `.mobile-cal-card` and children (reused by agenda), unscheduled sidebar mobile rules.

**Step 3: Commit**

```bash
git add client/src/index.css
git commit -m "feat: add MiniCalStrip CSS, remove old mobile calendar styles"
```

---

### Task 6: CSS for MobileAgendaView

**Files:**
- Modify: `client/src/index.css` (inside the `@media (max-width: 768px)` block)

**Step 1: Add agenda styles**

```css
/* Mobile agenda view */
.mobile-agenda {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.agenda-group {
  margin-bottom: 0.25rem;
}

.agenda-date-header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  font-family: var(--font-display);
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text);
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}

.agenda-date-header.agenda-today {
  color: var(--primary);
}

.agenda-date-count {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  padding: 0 0.375rem;
  border-radius: var(--radius-pill);
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--text-secondary);
  font-family: var(--font-ui);
}

.agenda-group-cards {
  padding: 0.375rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

/* Overdue section */
.agenda-overdue-section {
  border-bottom: 1px solid var(--border);
}

.agenda-overdue-header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: var(--bg);
  border: none;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}

.agenda-overdue-label {
  font-family: var(--font-display);
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--danger);
}

.agenda-overdue-count {
  background: var(--danger-subtle);
  color: var(--danger);
  font-size: 0.65rem;
  font-weight: 700;
  padding: 0.0625rem 0.375rem;
  border-radius: var(--radius-pill);
}

/* Unscheduled section */
.agenda-unscheduled-section {
  border-top: 1px solid var(--border);
  margin-top: 0.5rem;
}

.agenda-unscheduled-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: var(--bg);
  border: none;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}

.agenda-unscheduled-label {
  font-family: var(--font-display);
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text);
}

.agenda-unscheduled-count {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  padding: 0 0.375rem;
  border-radius: var(--radius-pill);
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.agenda-collapse-arrow {
  margin-left: auto;
  font-size: 1.25rem;
  color: var(--text-secondary);
  transition: transform 0.2s var(--ease);
  transform: rotate(-90deg);
}

.agenda-collapse-arrow.rotated {
  transform: rotate(90deg);
}

.agenda-empty {
  color: var(--text-secondary);
  font-size: 0.8rem;
  text-align: center;
  padding: 2.5rem 0;
  font-style: italic;
}

.agenda-empty-inline {
  color: var(--text-secondary);
  font-size: 0.8rem;
  text-align: center;
  padding: 1rem 0;
  font-style: italic;
}
```

**Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "feat: add MobileAgendaView CSS — agenda groups, sticky headers, overdue/unscheduled"
```

---

### Task 7: Swipe Navigation on Agenda

**Files:**
- Modify: `client/src/components/MobileAgendaView.tsx`

Add left/right swipe detection on the agenda scroll container to navigate months (matching current behavior).

**Step 1: Add swipe handlers**

Add a `touchStart` ref and handlers to `MobileAgendaView`. The parent already has `onPrev`/`onNext` — but currently the agenda doesn't receive them. We need to either:
- Pass `onPrev`/`onNext` down from CalendarView, or
- Handle swipe at the `CalendarView` level on the wrapper div.

The simpler approach: add `onSwipeLeft` and `onSwipeRight` props to `MobileAgendaView`.

Add props:
```tsx
onSwipeLeft?: () => void;
onSwipeRight?: () => void;
```

Add swipe logic inside the component:
```tsx
const touchStart = useRef<{ x: number; y: number } | null>(null);

const handleTouchStart = (e: React.TouchEvent) => {
  touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
};

const handleTouchEnd = (e: React.TouchEvent) => {
  if (!touchStart.current) return;
  const dx = e.changedTouches[0].clientX - touchStart.current.x;
  const dy = e.changedTouches[0].clientY - touchStart.current.y;
  touchStart.current = null;
  if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
  if (dx > 0) onSwipeRight?.();
  else onSwipeLeft?.();
};
```

Add to the root div:
```tsx
<div className="mobile-agenda" ref={scrollRef} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
```

**Step 2: Pass swipe handlers from CalendarView**

In `CalendarView.tsx`, pass `onSwipeLeft={handleNext}` and `onSwipeRight={handlePrev}` to `MobileAgendaView`.

**Step 3: Commit**

```bash
git add client/src/components/MobileAgendaView.tsx client/src/components/CalendarView.tsx
git commit -m "feat: add swipe-to-navigate-months on mobile agenda"
```

---

### Task 8: Scroll-to-Date Wiring Refinement

**Files:**
- Modify: `client/src/components/CalendarView.tsx`
- Modify: `client/src/components/MobileAgendaView.tsx`

The current approach uses a hacky `__scrollToDate` property on a DOM element. Refactor to use `useImperativeHandle` + `forwardRef` for a clean API.

**Step 1: Convert MobileAgendaView to forwardRef**

Wrap component in `forwardRef` and expose `scrollToDate` via `useImperativeHandle`:

```tsx
import { forwardRef, useImperativeHandle } from 'react';

export interface MobileAgendaHandle {
  scrollToDate: (dateKey: string) => void;
}

const MobileAgendaView = forwardRef<MobileAgendaHandle, MobileAgendaViewProps>(
  function MobileAgendaView(props, ref) {
    // ... existing component body ...

    useImperativeHandle(ref, () => ({
      scrollToDate(dateKey: string) {
        const el = headerRefs.current.get(dateKey);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        const allKeys = upcomingGroups.map(g => g.dateKey);
        const nearest = allKeys.find(k => k >= dateKey);
        if (nearest) {
          headerRefs.current.get(nearest)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }), [upcomingGroups]);

    // ... rest of component ...
  }
);

export default MobileAgendaView;
```

Remove the `__scrollToDate` hack.

**Step 2: Use ref in CalendarView**

```tsx
const agendaRef = useRef<MobileAgendaHandle>(null);

const handleMiniCalSelect = (date: Date) => {
  setActiveDate(date);
  setCurrentDate(new Date(date.getFullYear(), date.getMonth(), 1));
  agendaRef.current?.scrollToDate(formatDateKey(date));
};
```

Pass `ref={agendaRef}` to `<MobileAgendaView>`.

**Step 3: Commit**

```bash
git add client/src/components/MobileAgendaView.tsx client/src/components/CalendarView.tsx
git commit -m "refactor: use forwardRef + useImperativeHandle for agenda scroll-to-date"
```

---

### Task 9: Manual Testing & Polish

**Files:** Various — based on what's found during testing.

**Step 1: Build and verify no compile errors**

Run: `cd /home/bradley/cork && docker compose up -d --build`

Check browser at the app URL. Open mobile dev tools (responsive mode, ~375px width).

**Step 2: Test checklist**

- [ ] Mini-cal strip renders with correct week, today highlighted
- [ ] Tapping a day in strip scrolls agenda to that date
- [ ] Expanding mini-cal shows full month grid, collapsing returns to strip
- [ ] Prev/Next arrows navigate months, "Today" button returns to today
- [ ] Agenda shows date groups with sticky headers
- [ ] Today header is accent-colored
- [ ] Overdue section appears if there are past-due cards, collapses/expands
- [ ] Unscheduled section appears at bottom, collapses/expands
- [ ] Tapping a card opens it in board view
- [ ] Change date / remove date buttons work on scheduled cards
- [ ] Set date button works on unscheduled cards (moves them to dated group)
- [ ] Swipe left/right navigates months
- [ ] Scrolling the agenda updates the active day in the mini-cal strip
- [ ] Desktop calendar is completely unchanged
- [ ] Dots in mini-cal correctly indicate which days have cards

**Step 3: Fix any issues found**

**Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix: polish mobile agenda calendar"
```

---

### Task 10: Deploy

**Step 1: Push and deploy**

```bash
git push
ssh bradley@10.0.0.102 "cd /opt/stacks/plank && git pull && docker compose up -d --build"
```

**Step 2: Verify on actual mobile device**
