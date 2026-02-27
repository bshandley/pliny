# Bulk Card Operations Design

## Goal

Let users select multiple cards across columns and perform batch operations on them. Initial operations: **move to column** and **assign member**.

## Approach

Client-side orchestration using existing `api.updateCard()` calls with `Promise.all()`. No new backend endpoints. Same pattern as existing drag-and-drop reordering.

## Selection State & Card Checkbox

- Add `selectedCardIds: Set<string>` state to KanbanBoard (plain `useState`)
- Each card renders a checkbox in its top-left corner on hover (always visible on mobile)
- When any cards are selected, all checkboxes stay visible (not just on hover)
- Clicking checkbox toggles card ID in the set
- Track `lastSelectedCardId` for shift+click range select within same column
- Clear selection on: Escape, deselect button, bulk operation completion, or opening a card for editing
- Drag-and-drop moves only the dragged card (not all selected) to avoid DnD library complexity

## Floating Bulk Action Toolbar

- Slides up from bottom-center when `selectedCardIds.size > 0`
- Fixed position overlay (doesn't push content up)
- Contents (left to right):
  - Checkbox (toggle select all visible / deselect all) + "N selected" text
  - "Move to..." button — dropdown listing all board columns
  - "Assign..." button — dropdown listing board members
  - "×" close button — clears selection
- Matches existing UI styling (colors, border radius, shadows)
- `Escape` key dismisses selection
- Hidden for `userRole === 'READ'`

## Bulk Operations Logic

### Move to Column

1. User selects cards, clicks "Move to...", picks target column
2. `Promise.all()` calls `api.updateCard(cardId, { column_id: targetColumnId })` for each card
3. Cards appended to end of target column (incrementing position)
4. `loadBoard()` + `socket.emit('board-updated')` after completion
5. Clear selection

### Assign Member

1. User selects cards, clicks "Assign...", picks board member
2. For each card: fetch current assignees, add new member if not present, call `api.updateCard()`
3. `loadBoard()` + socket emit after completion
4. Clear selection

## Error Handling

Partial failure is acceptable (same as drag-and-drop). If any call fails, show error message "N of M cards updated" and refetch board state.

## Files to Modify

- `client/src/components/KanbanBoard.tsx` — selection state, toolbar rendering, bulk operation handlers
- `client/src/components/KanbanCard.tsx` — checkbox overlay on card, selection toggle callback
- New: `client/src/components/BulkActionToolbar.tsx` — floating toolbar component

## Out of Scope

- Bulk label assignment (future)
- Bulk archive/delete (future)
- Multi-card drag-and-drop
- Batch API endpoints (optimize later if needed)
