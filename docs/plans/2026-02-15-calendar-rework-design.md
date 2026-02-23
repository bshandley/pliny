# Desktop Calendar Rework — Notion-Flat Style

**Date:** 2026-02-15
**Scope:** Desktop only. Mobile calendar (MiniCalStrip + MobileAgendaView) is unchanged.

## Problem

The current desktop calendar has an awkward collapsible sidebar for unscheduled cards and an overall look that doesn't follow common calendar conventions. It needs a visual overhaul toward a clean, flat, Notion-style aesthetic.

## Design

### Layout

```
┌──────────────────────────────────────────────────────────┐
│  <  February 2026  >           [Month | Week]    [Today] │
├──────────────────────────────────────────────────────────┤
│  No date   [chip] [chip] [chip] [chip] →  (h-scroll)    │
├──────────────────────────────────────────────────────────┤
│  Sun    Mon    Tue    Wed    Thu    Fri    Sat            │
│   1      2      3      4      5      6      7            │
│ [chip]        [chip]                [chip]               │
│               [chip]                                     │
│   8      9     10     11     12     13     14            │
│         ...                                              │
└──────────────────────────────────────────────────────────┘
```

- **Full width** — no sidebar. Calendar takes the entire content area.
- **Header bar**: prev/next arrows around month/year label, segmented Month|Week toggle, Today button.
- **Unscheduled row**: horizontal strip between header and grid. "No date" label on the left, card chips scroll horizontally. Droppable target for removing dates, draggable chips for assigning dates.
- **Month grid**: 7-column CSS grid. No inner cell borders — cells separated by whitespace and subtle background differences. Outer container has thin border with rounded corners.
- **Week view**: same grid, taller cells (~20rem), scrollable overflow per day. Day headers show "Day Name + Date" (e.g. "Mon 16"). Navigation moves by week.

### Card Chips

- Compact single-line pill with rounded corners.
- Small colored dot on the left (column color or first label color).
- Title text, truncated with ellipsis.
- Subtle background on hover.
- Max 3 visible per day cell, then `+N more` link.
- Same chip style in both grid cells and unscheduled row.

### Click Behavior

- Clicking a card chip navigates to the board view and opens that card for full editing.
- No popover — the current fixed popover is removed entirely.

### Drag-and-Drop

Same mechanics as current implementation:
- **Day → Day**: changes due date.
- **Unscheduled row → Day**: assigns due date.
- **Day → Unscheduled row**: removes due date.
- **Within unscheduled row**: reorder (client-side only).
- Disabled for non-admins.
- Subtle cell highlight when dragging over.

### Visual Style (Notion-flat)

- No inner cell borders — whitespace separation.
- Outer grid: thin 1px border, rounded corners.
- Muted day numbers, primary-color filled circle on today.
- Dimmed outside-month days (low opacity).
- Segmented control: rounded pill, filled bg on active segment.
- Subtle 0.1s transitions on hover/active.
- Clean, minimal chrome throughout.

### What Changes

| Current | New |
|---------|-----|
| Collapsible sidebar for unscheduled cards | Horizontal "No date" row above grid |
| Inner cell borders | Borderless cells, whitespace separation |
| Card click → fixed popover | Card click → navigate to board + open card |
| Sidebar component (UnscheduledSidebar.tsx) | Inline row in CalendarView.tsx |
| Split layout (calendar + sidebar) | Full-width single-column layout |

### What Stays the Same

- Mobile calendar (MiniCalStrip, MobileAgendaView, mobile kebab menus) — untouched.
- Drag-and-drop API calls and socket events.
- Month/week view toggle and navigation logic.
- Card filtering.
- View toggle icons in the app bar.
- URL routing (`/slug/calendar`).

### Files Affected

- `CalendarView.tsx` — major rework (grid layout, unscheduled row, remove popover click)
- `UnscheduledSidebar.tsx` — remove or repurpose (logic moves inline)
- `KanbanBoard.tsx` — remove sidebar rendering, remove popover state/rendering, adjust handleDragEnd targets
- `index.css` — new calendar styles, remove sidebar styles, remove popover styles
