# Mobile Calendar Overhaul — Agenda-First Design

## Problem

The mobile calendar is clunky: a compact grid on top with an inline day panel below requires two mental zones, the week view is a flat list of mostly-empty days, card actions are fiddly, and the unscheduled sidebar competes for space.

## Approach

Replace the mobile month/week views with an **agenda-first** layout: a scrolling timeline of upcoming days (only days with cards), with a collapsible mini-calendar strip at the top for navigation context. Desktop views are unchanged.

## Layout Structure

Two zones:

1. **Mini-calendar strip** (top, fixed) — week strip by default, expandable to full month grid.
2. **Agenda list** (below, scrollable) — vertical list grouped by date, with cards under sticky date headers. Empty days are hidden.

The Month/Week toggle is removed on mobile. The mini-cal handles month overview; the agenda handles day content.

## Agenda List

### Grouping & Ordering

- Cards grouped by date, sorted chronologically (earliest first).
- Only days that have cards appear.
- **Overdue section** at the top: cards with due dates before today, collapsible, subtle danger accent.
- **Unscheduled group** at the bottom after all dated cards. Replaces `UnscheduledSidebar` on mobile entirely. Collapsible (default expanded), shows count badge.

### Sticky Date Headers

- Pin to top as user scrolls: "Today — Saturday, Feb 15" / "Tomorrow — Sunday, Feb 16" / "Monday, Feb 17" / etc.
- Today's header gets primary color accent.

### Card Rows

- Reuse existing `MobileCalendarCard` component: left border accent, title, column name, admin action buttons on right.
- Tap card body → opens in board view (`onOpenInBoard`).
- Admin buttons: calendar icon (change date), X (remove date).
- Unscheduled cards: single "Set date" button instead of change/remove.

### Scrolling Behavior

- On load, auto-scroll to today's group (or nearest future date with cards).
- Tapping a day in the mini-cal smooth-scrolls to that date's group (or nearest date with cards after it).
- Left/right swipe on the agenda navigates months.

## Mini-Calendar Strip

### Default State — Week Strip

- Single row of 7 day circles for the week containing the active date.
- Today: primary ring. Selected/active day: filled primary circle.
- Dots below numbers indicate days with cards.
- Tapping a day highlights it and smooth-scrolls the agenda.
- Strip updates passively as user scrolls the agenda (via IntersectionObserver on sticky headers).

### Expanded State — Full Month Grid

- Chevron/handle below the week strip to expand/collapse.
- Full 6-row month grid (same layout as existing `cal-mobile-grid`).
- Same interaction: tap day to scroll agenda, dots, today/selected styling.
- Tapping handle or tapping a day collapses back to week strip.
- Left/right swipe on expanded grid navigates months.

### Header

- `< February 2026 >` with prev/next arrows (same as current).
- "Today" button: scrolls agenda to today, highlights today in strip.

## Card Interactions

- **Tap card** → open in board view.
- **Change date** (admin) → native date picker, card moves to new date group on save.
- **Remove date** (admin) → card moves to Unscheduled group.
- **Set date** (unscheduled cards, admin) → native date picker, card moves to date group on save.
- No swipe-to-reveal actions — inline buttons are sufficient.

## Scope

### In Scope

- `MobileAgendaView` component (replaces mobile month/week render methods)
- `MiniCalStrip` component (week strip + expandable month grid)
- CSS for agenda layout, sticky headers, strip expand/collapse animation
- Scroll syncing logic (IntersectionObserver)
- Remove `UnscheduledSidebar` from mobile calendar layout
- Remove Month/Week toggle on mobile

### Not in Scope

- Desktop calendar (month grid, week grid, popover, drag-and-drop)
- `CalendarCardChip` (still used on desktop)
- Backend/API
- `UnscheduledSidebar` on desktop
