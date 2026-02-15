# Desktop Calendar Rework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rework the desktop calendar view from a bordered grid + sidebar layout to a Notion-flat full-width layout with an inline unscheduled row.

**Architecture:** Remove UnscheduledSidebar component, move unscheduled card logic into CalendarView as a horizontal droppable row. Remove popover click behavior — chips now navigate directly to the board and open the card. Restyle the grid to remove inner borders and use whitespace separation. Mobile remains untouched.

**Tech Stack:** React, TypeScript, @hello-pangea/dnd, CSS Grid.

---

### Task 1: Remove Popover State and Rendering from KanbanBoard

Remove all popover-related state, effects, and JSX from `KanbanBoard.tsx`. The popover is being replaced by direct navigation to the board.

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx`

**Step 1: Remove popover state variables (lines 49-52)**

Delete these state declarations and ref:

```typescript
const [calendarPopoverCard, setCalendarPopoverCard] = useState<{ card: Card; columnName: string } | null>(null);
const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
const popoverRef = useRef<HTMLDivElement>(null);
```

**Step 2: Remove popover click-outside effect (lines 162-182)**

Delete the entire `useEffect` block that handles closing the popover on outside click and Escape key.

**Step 3: Replace `handleCalendarCardClick` (lines 477-482)**

Replace the popover-positioning click handler with a direct "open in board" handler:

```typescript
const handleCalendarCardClick = (_card: Card, _columnName: string, _event: React.MouseEvent) => {
  // No-op on desktop — CalendarView will call onOpenInBoard directly
};
```

Actually, we can simplify further. The CalendarView `onCardClick` prop on desktop will just call `onOpenInBoard`. Update `handleCalendarCardClick` to:

```typescript
const handleCalendarCardClick = (card: Card, _columnName: string, _event: React.MouseEvent) => {
  if (isMobile) return;
  handleOpenInBoard(card.id);
};
```

**Step 4: Simplify `handleOpenInBoard` (lines 484-490)**

Remove the popover cleanup since there's no popover anymore:

```typescript
const handleOpenInBoard = (cardId: string) => {
  onViewChange('board');
  setTimeout(() => setEditingCardId(cardId), 100);
};
```

**Step 5: Remove popover JSX (lines 693-725)**

Delete the entire `{calendarPopoverCard && popoverPos && ( ... )}` block inside the `calendar-layout` div.

**Step 6: Remove UnscheduledSidebar rendering (lines 680-692)**

Delete the `{!isMobile && ( <UnscheduledSidebar ... /> )}` block.

Also remove the import of `UnscheduledSidebar` from line 14.

**Step 7: Verify the build**

Run: `npx tsc --noEmit`
Expected: Clean (no errors).

**Step 8: Commit**

```bash
git add client/src/components/KanbanBoard.tsx
git commit -m "refactor: remove calendar popover and sidebar from KanbanBoard"
```

---

### Task 2: Add Unscheduled Row to CalendarView (Desktop)

Move the unscheduled card logic into CalendarView as a horizontal droppable row that appears between the nav header and the grid. Desktop only — mobile already handles unscheduled cards in MobileAgendaView.

**Files:**
- Modify: `client/src/components/CalendarView.tsx`

**Step 1: Add unscheduled cards computation**

Inside the `CalendarView` component (after `cardDateSet` useMemo around line 229), add:

```typescript
const unscheduledCards = useMemo(() => {
  const results: { card: Card; columnName: string }[] = [];
  board.columns?.forEach(col => {
    col.cards?.filter(c => !c.due_date && !c.archived && filterCard(c)).forEach(card => {
      results.push({ card, columnName: col.name });
    });
  });
  return results;
}, [board, filterCard]);
```

**Step 2: Change desktop chip click to call `onOpenInBoard` instead of `onCardClick`**

In `renderMonthView` (line 280) and `renderWeekView` (line 337), change the CalendarCardChip `onClick` prop from:

```typescript
onClick={(e) => onCardClick(card, columnName, e)}
```

to:

```typescript
onClick={() => onOpenInBoard(card.id)}
```

This means desktop clicks go straight to the board + card, no popover.

**Step 3: Add the unscheduled row JSX in the desktop branch**

In the desktop `<>` block (after `calendar-nav` div, before the grid rendering, around line 401), add:

```tsx
<Droppable droppableId="unscheduled" type="CALENDAR" direction="horizontal">
  {(provided, snapshot) => (
    <div
      className={`calendar-unscheduled-row${snapshot.isDraggingOver ? ' calendar-drag-over' : ''}`}
      ref={provided.innerRef}
      {...provided.droppableProps}
    >
      <span className="calendar-unscheduled-label">No date</span>
      <div className="calendar-unscheduled-chips">
        {unscheduledCards.map(({ card, columnName }, index) => (
          <Draggable key={card.id} draggableId={card.id} index={index} isDragDisabled={!isAdmin}>
            {(provided) => (
              <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                <CalendarCardChip
                  card={card}
                  columnName={columnName}
                  onClick={() => onOpenInBoard(card.id)}
                  isMobile={false}
                  isAdmin={isAdmin}
                  onOpenInBoard={onOpenInBoard}
                  onChangeDate={onChangeDate}
                  onRemoveDate={onRemoveDate}
                />
              </div>
            )}
          </Draggable>
        ))}
        {provided.placeholder}
      </div>
      {unscheduledCards.length === 0 && (
        <span className="calendar-unscheduled-empty">No cards without dates</span>
      )}
    </div>
  )}
</Droppable>
```

**Step 4: Update maxVisible in month view**

Change `maxVisible` from 2 to 3 (line 260):

```typescript
const maxVisible = 3;
```

**Step 5: Verify the build**

Run: `npx tsc --noEmit`
Expected: Clean.

**Step 6: Commit**

```bash
git add client/src/components/CalendarView.tsx
git commit -m "feat: add inline unscheduled row to desktop calendar"
```

---

### Task 3: Restyle Desktop Calendar CSS (Notion-flat)

Replace the current bordered grid + sidebar styles with the Notion-flat aesthetic. Remove popover and sidebar CSS. Add unscheduled row styles.

**Files:**
- Modify: `client/src/index.css`

**Step 1: Rework the calendar nav (lines 743-778)**

Replace `.calendar-nav` and related styles:

```css
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
}

.calendar-nav-left {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.calendar-nav-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.calendar-nav .btn-icon {
  color: var(--text-secondary);
  transition: color 0.1s;
}

.calendar-nav .btn-icon:hover {
  color: var(--text);
}

.calendar-view-type {
  display: flex;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  padding: 2px;
}

.calendar-view-type .btn-sm {
  padding: 0.25rem 0.75rem;
  font-size: 0.75rem;
  min-height: unset;
  border: none;
  border-radius: var(--radius-pill);
  transition: all 0.15s var(--ease);
}

.calendar-view-type .btn-secondary {
  background: transparent;
  border: none;
}
```

**Step 2: Rework the calendar grid (lines 780-818)**

Remove inner borders, use whitespace separation:

```css
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  flex: 1;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg);
  gap: 1px;
}

.calendar-day-header {
  padding: 0.5rem;
  text-align: center;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  background: var(--card-bg);
}

.calendar-day {
  min-height: 5.5rem;
  padding: 0.375rem;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--card-bg);
  transition: background 0.1s;
}

.calendar-day:hover {
  background: var(--bg-raised);
}
```

Remove the `nth-child` border rules (lines 812-818) — no longer needed since we use `gap: 1px` on the grid itself.

**Step 3: Rework the day number and today styles (lines 820-838)**

```css
.calendar-day-number {
  font-size: 0.8rem;
  font-weight: 500;
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--text-secondary);
  margin-bottom: 0.25rem;
}

.calendar-today .calendar-day-number {
  background: var(--primary);
  color: white;
  font-weight: 700;
}

.calendar-outside {
  opacity: 0.4;
}
```

Remove the `.calendar-today { background: ... }` rule — today is indicated only by the filled circle on the number, not a full-cell tint.

**Step 4: Add unscheduled row styles (new)**

Add after the `.calendar-drag-over` rule:

```css
.calendar-unscheduled-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.25rem;
  border-bottom: 1px solid var(--border);
  min-height: 2.25rem;
  transition: background 0.1s;
}

.calendar-unscheduled-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}

.calendar-unscheduled-chips {
  display: flex;
  gap: 0.25rem;
  overflow-x: auto;
  flex: 1;
  scrollbar-width: none;
}

.calendar-unscheduled-chips::-webkit-scrollbar {
  display: none;
}

.calendar-unscheduled-empty {
  font-size: 0.75rem;
  color: var(--text-secondary);
  opacity: 0.6;
}
```

**Step 5: Update calendar-layout (line 980-984)**

Change from flex row (for sidebar) to just flex column (no sidebar):

```css
.calendar-layout {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}
```

**Step 6: Delete popover CSS (lines 986-1058)**

Remove everything from `.calendar-popover` through `.popover-open-btn`.

**Step 7: Delete unscheduled sidebar CSS (lines 1060-1149)**

Remove everything from the `/* ---- Unscheduled Sidebar ---- */` comment through `.unscheduled-empty`.

**Step 8: Update week view styles (lines 940-974)**

Keep the week view but adjust to match the flat style:

```css
.week-grid {
  grid-template-columns: repeat(7, 1fr);
}

.calendar-week-day {
  min-height: 20rem;
}

.calendar-week-day-header {
  display: flex;
  align-items: baseline;
  gap: 0.375rem;
  padding: 0.375rem;
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

Remove the `grid-template-rows: 1fr` from `.week-grid` and the `border-bottom` from `.calendar-week-day-header`.

**Step 9: Update mobile overrides**

In the `@media (max-width: 768px)` section, update `.calendar-layout` to keep `flex-direction: column` (it already does this, line 3673-3675, so no change needed). Remove the mobile `.unscheduled-sidebar` overrides (lines 3997-4014).

**Step 10: Verify the build**

Run: `npx tsc --noEmit`
Expected: Clean.

**Step 11: Commit**

```bash
git add client/src/index.css
git commit -m "style: rework desktop calendar to Notion-flat aesthetic"
```

---

### Task 4: Update CalendarView Nav Markup

Update the nav bar JSX in CalendarView to match the new layout: `< February 2026 >` on the left, segmented toggle + Today on the right.

**Files:**
- Modify: `client/src/components/CalendarView.tsx`

**Step 1: Restructure the nav JSX (lines 387-400)**

Replace the current nav block with:

```tsx
<div className="calendar-nav">
  <div className="calendar-nav-left">
    <button className="btn-icon" onClick={handlePrev} title="Previous">&larr;</button>
    <h2 className="calendar-nav-title">
      {viewType === 'month'
        ? `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`
        : formatWeekRange(currentDate)}
    </h2>
    <button className="btn-icon" onClick={handleNext} title="Next">&rarr;</button>
  </div>
  <div className="calendar-nav-right">
    <div className="calendar-view-type">
      <button className={`btn-sm${viewType === 'month' ? ' btn-primary' : ' btn-secondary'}`} onClick={() => setViewType('month')}>Month</button>
      <button className={`btn-sm${viewType === 'week' ? ' btn-primary' : ' btn-secondary'}`} onClick={() => setViewType('week')}>Week</button>
    </div>
    <button className="btn-secondary btn-sm" onClick={handleToday}>Today</button>
  </div>
</div>
```

The key change: arrows flank the title directly (`< February 2026 >`), and "Today" moves to the right side next to the toggle. "Today" button removed from between the arrows.

**Step 2: Verify the build**

Run: `npx tsc --noEmit`
Expected: Clean.

**Step 3: Commit**

```bash
git add client/src/components/CalendarView.tsx
git commit -m "refactor: restructure calendar nav layout"
```

---

### Task 5: Delete UnscheduledSidebar Component

The component is no longer used anywhere. Delete the file.

**Files:**
- Delete: `client/src/components/UnscheduledSidebar.tsx`

**Step 1: Verify no remaining imports**

Search for `UnscheduledSidebar` in the codebase. After Task 1, the only reference should be the file itself. If KanbanBoard still imports it, remove that import.

**Step 2: Delete the file**

```bash
rm client/src/components/UnscheduledSidebar.tsx
```

**Step 3: Verify the build**

Run: `npx tsc --noEmit`
Expected: Clean.

**Step 4: Commit**

```bash
git add -A client/src/components/UnscheduledSidebar.tsx
git commit -m "chore: delete UnscheduledSidebar component (replaced by inline row)"
```

---

### Task 6: Squash and Final Verification

Squash all calendar rework commits into a single clean commit.

**Step 1: Verify the app builds**

Run: `npx tsc --noEmit`

**Step 2: Squash commits**

Interactive rebase to squash all commits from this rework into one with message:

```
feat: rework desktop calendar to Notion-flat style with inline unscheduled row

- Remove collapsible sidebar, replace with horizontal "No date" row
- Remove card popover, click chips to open card on board
- Notion-flat grid: no inner borders, whitespace separation
- Filled circle on today's date number
- Pill-style segmented Month|Week toggle
- Restructured nav: arrows flank title, Today on right
- Delete UnscheduledSidebar component
- Mobile calendar unchanged
```

**Step 3: Deploy**

```bash
ssh bradley@10.0.0.102 "cd /opt/stacks/plank && git pull && docker compose up -d --build"
```
