# Mobile Calendar Kebab Menu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace unreliable mobile drag-and-drop on the calendar with a kebab menu offering "Open in Board", "Change Date", and "Remove Date" actions.

**Architecture:** Add `isMobile` prop to CalendarView and UnscheduledSidebar to disable drag on mobile. Expand `CalendarCardChip` to show a kebab menu on mobile with date management actions via native `<input type="date">`. Gate the desktop popover to non-mobile only.

**Tech Stack:** React, TypeScript, existing `api.updateCard`, native HTML date input.

---

### Task 1: Disable drag-and-drop on mobile

**Files:**
- Modify: `client/src/components/CalendarView.tsx`
- Modify: `client/src/components/UnscheduledSidebar.tsx`
- Modify: `client/src/components/KanbanBoard.tsx`

**Step 1: Add `isMobile` prop to CalendarView**

In `client/src/components/CalendarView.tsx`, update the props interface (line 5-10) to add `isMobile`:

```tsx
interface CalendarViewProps {
  board: Board;
  onCardClick: (card: Card, columnName: string, event: React.MouseEvent) => void;
  filterCard: (card: Card) => boolean;
  isAdmin: boolean;
  isMobile: boolean;
}
```

Update the destructuring (line 73):
```tsx
export default function CalendarView({ board, onCardClick, filterCard, isAdmin, isMobile }: CalendarViewProps) {
```

Update both Draggable components to include `isMobile`:
- Line 149 (month view): `isDragDisabled={!isAdmin || isMobile}`
- Line 197 (week view): `isDragDisabled={!isAdmin || isMobile}`

**Step 2: Add `isMobile` prop to UnscheduledSidebar**

In `client/src/components/UnscheduledSidebar.tsx`, update the props interface (lines 5-10):

```tsx
interface UnscheduledSidebarProps {
  board: Board;
  filterCard: (card: Card) => boolean;
  onCardClick: (card: Card, columnName: string, event: React.MouseEvent) => void;
  isAdmin: boolean;
  isMobile: boolean;
}
```

Update destructuring (line 12):
```tsx
export default function UnscheduledSidebar({ board, filterCard, onCardClick, isAdmin, isMobile }: UnscheduledSidebarProps) {
```

Update the Draggable (line 38):
```tsx
isDragDisabled={!isAdmin || isMobile}
```

**Step 3: Pass `isMobile` from KanbanBoard**

In `client/src/components/KanbanBoard.tsx`, update the CalendarView render (lines 609-614):
```tsx
<CalendarView
  board={board}
  onCardClick={handleCalendarCardClick}
  filterCard={filterCard}
  isAdmin={isAdmin}
  isMobile={isMobile}
/>
```

Update the UnscheduledSidebar render (lines 615-620):
```tsx
<UnscheduledSidebar
  board={board}
  filterCard={filterCard}
  onCardClick={handleCalendarCardClick}
  isAdmin={isAdmin}
  isMobile={isMobile}
/>
```

**Step 4: Commit**

```bash
git add client/src/components/CalendarView.tsx client/src/components/UnscheduledSidebar.tsx client/src/components/KanbanBoard.tsx
git commit -m "fix: Disable calendar drag-and-drop on mobile"
```

---

### Task 2: Add kebab menu to CalendarCardChip on mobile

**Files:**
- Modify: `client/src/components/CalendarView.tsx`
- Modify: `client/src/index.css`

**Step 1: Expand CalendarCardChip props and add kebab menu**

Replace the `CalendarCardChip` component (lines 58-69) with a version that accepts mobile/admin props and renders a kebab menu on mobile:

```tsx
function CalendarCardChip({ card, columnName, onClick, isMobile, isAdmin, onOpenInBoard, onChangeDate, onRemoveDate }: {
  card: Card;
  columnName: string;
  onClick: (e: React.MouseEvent) => void;
  isMobile: boolean;
  isAdmin: boolean;
  onOpenInBoard: (cardId: string) => void;
  onChangeDate: (cardId: string, date: string) => void;
  onRemoveDate: (cardId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const handleChipClick = (e: React.MouseEvent) => {
    if (isMobile) {
      e.stopPropagation();
      setMenuOpen(!menuOpen);
    } else {
      onClick(e);
    }
  };

  return (
    <div className="calendar-card-chip" onClick={handleChipClick} ref={isMobile ? menuRef : undefined}>
      <span className="chip-column-dot" style={{ background: 'var(--primary)' }} />
      <span className="chip-title">{card.title}</span>
      {isMobile && (
        <>
          <button
            className="chip-kebab"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
            </svg>
          </button>
          {menuOpen && (
            <div className="chip-menu">
              <button onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onOpenInBoard(card.id); }}>
                Open in Board
              </button>
              {isAdmin && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); setMenuOpen(false); dateInputRef.current?.showPicker(); }}>
                    Change Date
                  </button>
                  {card.due_date && (
                    <button className="kebab-danger" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onRemoveDate(card.id); }}>
                      Remove Date
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          <input
            ref={dateInputRef}
            type="date"
            className="chip-date-input"
            value={card.due_date ? card.due_date.split('T')[0] : ''}
            onChange={(e) => { if (e.target.value) onChangeDate(card.id, e.target.value); }}
            onClick={(e) => e.stopPropagation()}
          />
        </>
      )}
    </div>
  );
}
```

Add `useRef` to the imports at line 1:
```tsx
import { useState, useEffect, useRef } from 'react';
```

**Step 2: Add callback props to CalendarView and wire them through**

Update the CalendarViewProps interface (lines 5-10):
```tsx
interface CalendarViewProps {
  board: Board;
  onCardClick: (card: Card, columnName: string, event: React.MouseEvent) => void;
  filterCard: (card: Card) => boolean;
  isAdmin: boolean;
  isMobile: boolean;
  onOpenInBoard: (cardId: string) => void;
  onChangeDate: (cardId: string, date: string) => void;
  onRemoveDate: (cardId: string) => void;
}
```

Update destructuring (line 73):
```tsx
export default function CalendarView({ board, onCardClick, filterCard, isAdmin, isMobile, onOpenInBoard, onChangeDate, onRemoveDate }: CalendarViewProps) {
```

Update all CalendarCardChip usages (month view line 152, week view line 200) to pass the new props:
```tsx
<CalendarCardChip
  card={card}
  columnName={columnName}
  onClick={(e) => onCardClick(card, columnName, e)}
  isMobile={isMobile}
  isAdmin={isAdmin}
  onOpenInBoard={onOpenInBoard}
  onChangeDate={onChangeDate}
  onRemoveDate={onRemoveDate}
/>
```

**Step 3: Add CSS for the chip kebab and menu**

Add to `client/src/index.css` after the existing `.calendar-card-chip:hover` block (after line 660):

```css
.chip-kebab {
  background: transparent;
  border: none;
  padding: 0 0.125rem;
  cursor: pointer;
  color: var(--text-secondary);
  flex-shrink: 0;
  display: none;
}

.chip-menu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 50;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
  min-width: 140px;
  overflow: hidden;
}

.chip-menu button {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: transparent;
  border: none;
  text-align: left;
  font-size: 0.8rem;
  cursor: pointer;
  color: var(--text);
}

.chip-menu button:hover {
  background: var(--bg-raised);
}

.chip-date-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
  width: 0;
  height: 0;
}
```

Update the existing `.calendar-card-chip` rule (line 645) to add `position: relative` so the menu positions correctly:
```css
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
  position: relative;
}
```

Add mobile-only rule inside `@media (max-width: 768px)` (before line 3445):
```css
  .chip-kebab {
    display: flex;
  }

  .calendar-card-chip {
    overflow: visible;
  }
```

**Step 4: Commit**

```bash
git add client/src/components/CalendarView.tsx client/src/index.css
git commit -m "feat: Add kebab menu to calendar card chips on mobile"
```

---

### Task 3: Wire kebab callbacks from KanbanBoard and gate popover to desktop

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx`

**Step 1: Add date change handlers**

Add two new handlers after `handleOpenInBoard` (after line 443):

```tsx
const handleCalendarChangeDate = async (cardId: string, date: string) => {
  try {
    await api.updateCard(cardId, { due_date: date } as any);
    socket?.emit('board-updated', boardId);
    await loadBoard();
  } catch (error) {
    console.error('Failed to update card date:', error);
    loadBoard();
  }
};

const handleCalendarRemoveDate = async (cardId: string) => {
  try {
    await api.updateCard(cardId, { due_date: null } as any);
    socket?.emit('board-updated', boardId);
    await loadBoard();
  } catch (error) {
    console.error('Failed to remove card date:', error);
    loadBoard();
  }
};
```

**Step 2: Pass new callbacks to CalendarView**

Update the CalendarView render (lines 609-614):
```tsx
<CalendarView
  board={board}
  onCardClick={handleCalendarCardClick}
  filterCard={filterCard}
  isAdmin={isAdmin}
  isMobile={isMobile}
  onOpenInBoard={handleOpenInBoard}
  onChangeDate={handleCalendarChangeDate}
  onRemoveDate={handleCalendarRemoveDate}
/>
```

**Step 3: Gate the popover to desktop only**

Update `handleCalendarCardClick` (lines 431-435) to only show the popover on desktop:

```tsx
const handleCalendarCardClick = (card: Card, columnName: string, event: React.MouseEvent) => {
  if (isMobile) return; // Mobile uses kebab menu instead
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  setPopoverPos({ top: rect.bottom + 4, left: rect.left });
  setCalendarPopoverCard({ card, columnName });
};
```

**Step 4: Pass callbacks to UnscheduledSidebar**

The UnscheduledSidebar currently renders its own card chips inline (not using CalendarCardChip). It needs the same kebab treatment on mobile. Update the props:

In `client/src/components/UnscheduledSidebar.tsx`, update the interface:
```tsx
interface UnscheduledSidebarProps {
  board: Board;
  filterCard: (card: Card) => boolean;
  onCardClick: (card: Card, columnName: string, event: React.MouseEvent) => void;
  isAdmin: boolean;
  isMobile: boolean;
  onOpenInBoard: (cardId: string) => void;
  onChangeDate: (cardId: string, date: string) => void;
  onRemoveDate: (cardId: string) => void;
}
```

Update destructuring:
```tsx
export default function UnscheduledSidebar({ board, filterCard, onCardClick, isAdmin, isMobile, onOpenInBoard, onChangeDate, onRemoveDate }: UnscheduledSidebarProps) {
```

Import CalendarCardChip from CalendarView and replace the inline chip rendering (lines 41-44):

```tsx
import { CalendarCardChip } from './CalendarView';
```

Replace the inline chip div (lines 40-45) with:
```tsx
<div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
  <CalendarCardChip
    card={card}
    columnName={columnName}
    onClick={(e) => onCardClick(card, columnName, e)}
    isMobile={isMobile}
    isAdmin={isAdmin}
    onOpenInBoard={onOpenInBoard}
    onChangeDate={onChangeDate}
    onRemoveDate={onRemoveDate}
  />
</div>
```

Note: The CalendarCardChip in the sidebar won't show "Remove Date" for unscheduled cards since `card.due_date` is falsy — the conditional already handles this.

Update the UnscheduledSidebar render in KanbanBoard (lines 615-620):
```tsx
<UnscheduledSidebar
  board={board}
  filterCard={filterCard}
  onCardClick={handleCalendarCardClick}
  isAdmin={isAdmin}
  isMobile={isMobile}
  onOpenInBoard={handleOpenInBoard}
  onChangeDate={handleCalendarChangeDate}
  onRemoveDate={handleCalendarRemoveDate}
/>
```

**Step 5: Commit**

```bash
git add client/src/components/KanbanBoard.tsx client/src/components/UnscheduledSidebar.tsx
git commit -m "feat: Wire mobile kebab callbacks and gate popover to desktop"
```

---

### Task 4: Manual testing checklist

**No code changes — verification only.**

**Desktop (should be unchanged):**
- Calendar drag-and-drop still works (cards between days, sidebar ↔ calendar)
- Clicking a card shows the popover
- "Open in Board" switches to kanban and opens card
- No kebab visible on card chips

**Mobile (new behavior):**
- No drag-and-drop (cards don't drag)
- Tapping a card chip shows kebab menu
- "Open in Board" switches to kanban view and opens the card
- "Change Date" opens native date picker, selecting a date updates the card
- "Remove Date" clears the due date (card moves to unscheduled sidebar)
- "Remove Date" only shows on cards that have a date
- Non-admin users only see "Open in Board"
- Kebab works in month view, week view, and unscheduled sidebar
- Tapping outside kebab closes it
