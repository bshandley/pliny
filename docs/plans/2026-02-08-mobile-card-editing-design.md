# Mobile Card Editing & Card Movement

## Overview
Two mobile enhancements: fullscreen card editing (replacing inline expansion) and a "Move to" column picker (replacing broken drag-and-drop between full-width snapped columns).

## 1. Fullscreen Card Editing on Mobile

When viewport <= 768px, tapping a card opens a fullscreen modal overlay instead of expanding inline.

**Layout:**
- Top bar: back/close button + card title
- Scrollable body: all existing edit fields (title, labels, assignees, description, due date, checklist, comments)
- Bottom action bar: Save, Archive, Delete

**Implementation:**
- New `useIsMobile()` hook using `window.matchMedia('(max-width: 768px)')`
- KanbanCard receives `isMobile` and `columns` props
- When `isMobile && isEditing`: render via `ReactDOM.createPortal` into a fullscreen overlay
- When `!isMobile && isEditing`: current inline behavior unchanged
- Desktop is unaffected

## 2. "Move to" Column Picker on Mobile

Drag-and-drop between columns is disabled on mobile (react-beautiful-dnd can't scroll to off-screen columns during drag with full-width scroll-snap). Instead:

- "Move to" dropdown in the fullscreen card editor, between assignee picker and description
- Shows current column, native `<select>` lists all board columns
- Selecting a column calls `api.updateCard(cardId, { column_id })` and reloads the board
- Card moves to last position in target column
- Only shown on mobile inside the fullscreen editor

## 3. Component Changes

**New: `useIsMobile` hook**
- Listens to `matchMedia('(max-width: 768px)')` change events
- Returns reactive boolean, handles orientation changes

**KanbanCard.tsx:**
- New props: `isMobile: boolean`, `columns: Column[]`
- Fullscreen portal rendering when mobile + editing
- "Move to" column picker in fullscreen editor
- Auto-close if card disappears from board state (deleted/archived by another user)

**KanbanBoard.tsx:**
- Calls `useIsMobile()`, passes result + columns to KanbanCard
- Disables card drag on mobile: `isDragDisabled={!isAdmin || showArchived || isMobile}`

## 4. CSS Additions

- `.card-fullscreen-overlay` — fixed fullscreen container, z-index 1000
- `.card-fullscreen-header` — sticky top bar with back button
- `.card-fullscreen-body` — padded scrollable area
- `.card-fullscreen-actions` — sticky bottom action bar
- `.card-move-to` — column picker row

## 5. Race Conditions

- **Card moved by another user**: WebSocket board-updated keeps "Move to" dropdown in sync
- **Column deleted while picking**: API error caught, board reloads, editor closes
- **Card deleted/archived while editing**: editor detects card missing from board state, auto-closes via `onEditEnd()`
