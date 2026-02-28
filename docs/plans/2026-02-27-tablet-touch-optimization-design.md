# Tablet & Touch Optimization Design

**Date:** 2026-02-27

## Problem

On tablets (iPad, Android), two scrolling interactions are broken:

1. **Vertical column scroll** - Hard to scroll cards within a column. Root cause: `@hello-pangea/dnd` intercepts touchstart/touchmove on draggable cards, blocking native scroll in `.cards-list`.
2. **Horizontal board scroll** - Hard to swipe between columns. Root cause: same DnD touch interception at the `.columns-container` level, plus 300px fixed column widths force scrolling with no visual affordance.

Secondary issues:
- Touch targets (buttons, kebabs) are too small for fingertip taps
- No `touch-action` hints to tell the browser what to handle natively vs. pass to JS
- No tablet-specific breakpoint (768px cutoff treats iPad landscape/portrait differently each time)

---

## Solution

### 1. Add `useIsTablet` hook

`client/src/hooks/useIsTablet.ts`

```ts
const TABLET_BREAKPOINT = '(min-width: 769px) and (max-width: 1024px)';
```

Use `window.matchMedia`. Return `boolean`. Follow the same pattern as `useIsMobile.ts`.

### 2. Disable drag on tablet (same as mobile)

In `KanbanBoard.tsx`, import `useIsTablet`. Combine: `const isTouchDevice = isMobile || isTablet`.

Pass `isTouchDevice` instead of `isMobile` everywhere drag is disabled:
- `isDragDisabled={!isAdmin || isTouchDevice}` for columns
- `isDragDisabled={!canEdit || showArchived || isTouchDevice}` for cards
- Column header drag handle: `{(!isTouchDevice ? provided.dragHandleProps : {})}`

Drag-and-drop is a nice power-user feature but broken touch scroll is a worse problem. Tablets can reorder via the card detail move-to-column shortcut (`[`/`]` keys, or the column picker).

### 3. CSS `touch-action` fixes

Even with drag disabled, proper `touch-action` hints prevent scroll jank:

```css
/* Horizontal board scroll - tell browser this is pan-x */
.columns-container {
  touch-action: pan-x;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  scroll-snap-type: x mandatory;   /* snap to columns on tablet */
}

/* Vertical card scroll within each column */
.cards-list {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
}

/* Prevent accidental zoom on double-tap */
.kanban-card {
  touch-action: manipulation;
}
```

### 4. Scroll snap for columns (tablet only)

Add `scroll-snap-type: x mandatory` on `.columns-container` and `scroll-snap-align: start` on each `.column`. This makes horizontal swiping snap cleanly to column boundaries instead of stopping mid-column.

Only apply on tablet via media query:

```css
@media (min-width: 769px) and (max-width: 1024px) {
  .columns-container {
    scroll-snap-type: x mandatory;
    padding-bottom: 0.5rem;  /* room for scroll indicator */
  }
  .column {
    scroll-snap-align: start;
  }
}
```

### 5. Responsive column width on tablet

300px columns mean 3 columns barely fit a 1024px iPad landscape. Change to a slightly narrower width on tablet:

```css
@media (min-width: 769px) and (max-width: 1024px) {
  .column {
    width: 260px;
  }
}
```

For portrait tablet (768px and below) — already handled by existing mobile styles.

### 6. Larger touch targets

All icon buttons in `.column-header-actions`, `.card-meta`, kebab menus should meet minimum 44x44px tap target:

```css
@media (pointer: coarse) {
  .column-header-actions button,
  .card-kebab,
  .icon-btn {
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}
```

`(pointer: coarse)` targets touchscreens specifically, doesn't affect mouse users.

### 7. Scroll indicator (tablet UX affordance)

Add a subtle horizontal scroll indicator when the board overflows on tablet — a row of dots or a thin progress bar showing position among columns. 

Simple implementation: a `<div class="board-scroll-indicator">` below the columns container with dots, updated via a scroll event listener. Show only when column count > visible columns.

This is optional/bonus — implement only if the other fixes leave time. Mark it `/* OPTIONAL */` in the task.

---

## Files to Modify

- `client/src/hooks/useIsTablet.ts` — **create**
- `client/src/components/KanbanBoard.tsx` — import + use `useIsTablet`, combine with `isMobile` for drag disabled
- `client/src/index.css` — `touch-action`, scroll snap, column width, touch target sizes

## Files to Leave Alone

- `@hello-pangea/dnd` config — no changes needed; fixing drag disabled flag is sufficient
- `useIsMobile.ts` — don't change the 768px threshold

---

## Testing Notes

- iPad Safari (portrait + landscape) are the primary target
- Android Chrome tablet also benefits from the same fixes
- Mouse/trackpad users should be unaffected — `(pointer: coarse)` scopes touch target changes
- Drag reordering still works on desktop (>1024px) — only tablet loses it
