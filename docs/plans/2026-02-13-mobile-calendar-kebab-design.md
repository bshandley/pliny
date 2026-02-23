# Mobile Calendar Kebab Menu Design

## Problem

Drag-and-drop on the mobile calendar is unreliable — touch targets are too small, dropping on specific day cells doesn't work well, and the interaction model feels wrong for touch.

## Design

### Behavior Change

On mobile, the calendar becomes read-only (no drag-and-drop). Each card chip gets a kebab menu (`⋮`) with actions to replace drag functionality. Desktop is unchanged — drag-and-drop continues to work.

### Kebab Menu Actions

For admins:
- **Open in Board** — switches to kanban view and opens the card for editing
- **Change Date** — opens the browser's native date picker to assign/update the due date
- **Remove Date** — clears the due date (only shown on cards that have a date)

For non-admins:
- **Open in Board** — only action available (they can't change dates)

### Implementation Details

**Disable drag on mobile:**
- Pass `isMobile` prop to CalendarView and UnscheduledSidebar
- Add `isMobile` to `isDragDisabled` on all Draggable components (matches existing kanban board pattern)

**Kebab on CalendarCardChip:**
- When `isMobile`, show a `⋮` button on each card chip
- Tapping opens a small dropdown menu (inline, not portal — chips aren't inside overflow-clipped containers on mobile)
- Admin users see: Open in Board, Change Date, Remove Date (if dated)
- Non-admin users see: Open in Board only

**Change Date — native date input:**
- A hidden `<input type="date">` is programmatically clicked when "Change Date" is tapped
- On change, calls `api.updateCard(cardId, { due_date: value })` and reloads
- Simple, reliable, no extra library needed

**Popover behavior:**
- On mobile, tapping a card chip opens the kebab menu instead of the popover
- On desktop, the existing popover behavior is unchanged

### Files

**Modified:**
- `client/src/components/CalendarView.tsx` — accept `isMobile` prop, disable drag on mobile, add kebab to CalendarCardChip on mobile
- `client/src/components/UnscheduledSidebar.tsx` — accept `isMobile` prop, disable drag on mobile
- `client/src/components/KanbanBoard.tsx` — pass `isMobile` to CalendarView and UnscheduledSidebar, gate popover to desktop only
- `client/src/index.css` — kebab styling on card chips for mobile

### What Stays the Same

- Desktop drag-and-drop (CalendarView + UnscheduledSidebar)
- Desktop popover on card click
- All existing API endpoints (uses existing `api.updateCard`)
- Calendar navigation, month/week views, filter bar
