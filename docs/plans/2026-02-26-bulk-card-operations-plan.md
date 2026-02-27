# Bulk Card Operations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users select multiple cards across columns and perform batch operations (move to column, archive/delete, assign labels, assign members) via a floating toolbar.

**Architecture:** Client-side orchestration using existing `api.updateCard()` / `api.deleteCard()` with `Promise.all()`. Selection state as `Set<string>` in KanbanBoard. New `BulkActionToolbar` component renders as fixed-position bottom bar. No new backend endpoints.

**Tech Stack:** React, TypeScript, existing `@hello-pangea/dnd`, Socket.io for real-time sync.

---

### Task 1: Add selection state to KanbanBoard

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx:29-57` (state declarations)

**Step 1: Add selection state variables**

In `KanbanBoard.tsx`, after the existing `useState` declarations (around line 57), add:

```tsx
const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
const lastSelectedCardIdRef = useRef<string | null>(null);
```

Also add the import for `useCallback` at line 1:

```tsx
import { useState, useEffect, useRef, useCallback } from 'react';
```

**Step 2: Add selection handler functions**

After the `handleMoveToColumn` function (line 516), add:

```tsx
const toggleCardSelection = useCallback((cardId: string, shiftKey: boolean) => {
  setSelectedCardIds(prev => {
    const next = new Set(prev);
    if (shiftKey && lastSelectedCardIdRef.current && board) {
      // Find the column containing both cards for range select
      for (const col of (board.columns || [])) {
        const cards = (col.cards || []).filter(filterCard);
        const lastIdx = cards.findIndex(c => c.id === lastSelectedCardIdRef.current);
        const curIdx = cards.findIndex(c => c.id === cardId);
        if (lastIdx !== -1 && curIdx !== -1) {
          const [start, end] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
          for (let i = start; i <= end; i++) {
            next.add(cards[i].id);
          }
          break;
        }
      }
    } else {
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
    }
    lastSelectedCardIdRef.current = cardId;
    return next;
  });
}, [board, filterCard]);

const clearSelection = useCallback(() => {
  setSelectedCardIds(new Set());
  lastSelectedCardIdRef.current = null;
}, []);

const selectAllVisible = useCallback(() => {
  if (!board) return;
  const allVisible = new Set<string>();
  for (const col of (board.columns || [])) {
    for (const card of (col.cards || []).filter(filterCard)) {
      allVisible.add(card.id);
    }
  }
  setSelectedCardIds(allVisible);
}, [board, filterCard]);
```

**Step 3: Clear selection when opening a card or changing view**

In the existing `closeCard` function (line 99) and the `setEditingCardId` call pattern, add clearing. After line 97 (`setEditingCardId(null)` in the viewMode effect), add:

```tsx
useEffect(() => {
  setEditingCardId(null);
  clearSelection();
}, [viewMode]);
```

Replace the existing viewMode effect. Also add Escape key handler:

```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && selectedCardIds.size > 0) {
      clearSelection();
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [selectedCardIds.size, clearSelection]);
```

When `editingCardId` is set, clear selection:

```tsx
const openCard = (cardId: string) => {
  clearSelection();
  setEditingCardId(cardId);
};
```

Update all `setEditingCardId(card.id)` calls in the `onEditStart` prop to use `openCard(card.id)` instead.

**Step 4: Commit**

```bash
git add client/src/components/KanbanBoard.tsx
git commit -m "feat: add card selection state and handlers to KanbanBoard"
```

---

### Task 2: Add checkbox to card summary view

**Files:**
- Modify: `client/src/components/KanbanCard.tsx:11-27` (props interface)
- Modify: `client/src/components/KanbanCard.tsx:1618-1713` (summary render)
- Modify: `client/src/components/KanbanBoard.tsx:950-966` (pass new props)

**Step 1: Add selection props to KanbanCard**

In `KanbanCard.tsx`, add to the `KanbanCardProps` interface (around line 11):

```tsx
interface KanbanCardProps {
  card: Card;
  userRole: 'READ' | 'COLLABORATOR' | 'ADMIN';
  isEditing: boolean;
  isSelected?: boolean;
  selectionActive?: boolean;
  onToggleSelect?: (cardId: string, shiftKey: boolean) => void;
  onEditStart: () => void;
  // ... rest unchanged
}
```

Update the destructured props in the function signature (line 137):

```tsx
export default function KanbanCard({ card, userRole, isEditing, isSelected = false, selectionActive = false, onToggleSelect, onEditStart, ...rest }: KanbanCardProps) {
```

**Step 2: Add checkbox to the card summary view**

In the summary return block (line 1618), modify the `<div className="kanban-card ...">` wrapper:

```tsx
return (
  <div
    className={`kanban-card ${card.archived ? 'archived' : ''} ${isSelected ? 'card-selected' : ''}`}
    onClick={() => onEditStart()}
    style={{ cursor: 'pointer' }}
  >
    {/* Selection checkbox */}
    {onToggleSelect && (
      <div
        className={`card-select-checkbox ${selectionActive ? 'always-visible' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect(card.id, e.shiftKey);
        }}
      >
        <input type="checkbox" checked={isSelected} readOnly tabIndex={-1} />
      </div>
    )}
    {/* Label color bars */}
    {card.labels && card.labels.length > 0 && (
```

**Step 3: Pass selection props from KanbanBoard**

In `KanbanBoard.tsx`, where `<KanbanCard>` is rendered (around line 950), add the new props:

```tsx
<KanbanCard
  card={card}
  userRole={userRole}
  isEditing={editingCardId === card.id}
  isSelected={selectedCardIds.has(card.id)}
  selectionActive={selectedCardIds.size > 0}
  onToggleSelect={userRole !== 'READ' ? toggleCardSelection : undefined}
  onEditStart={() => openCard(card.id)}
  onEditEnd={closeCard}
  onDelete={() => handleDeleteCard(card.id)}
  onArchive={() => handleArchiveCard(card.id)}
  onUpdate={(updates) => handleUpdateCard(card.id, updates)}
  boardLabels={boardLabels}
  boardId={boardId}
  isMobile={isMobile}
  columns={board?.columns}
  onMoveToColumn={handleMoveToColumn}
  boardMembers={boardMembers}
  customFields={board?.custom_fields}
/>
```

**Step 4: Commit**

```bash
git add client/src/components/KanbanCard.tsx client/src/components/KanbanBoard.tsx
git commit -m "feat: add selection checkbox to kanban cards"
```

---

### Task 3: Add selection checkbox CSS

**Files:**
- Modify: `client/src/index.css`

**Step 1: Add card selection styles**

Find the `.kanban-card` styles in `index.css` and add after them:

```css
/* Card selection */
.card-select-checkbox {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 2;
  opacity: 0;
  transition: opacity 0.15s ease;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: var(--card-bg);
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}

.card-select-checkbox input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--primary);
  margin: 0;
}

.kanban-card {
  position: relative;
}

.kanban-card:hover .card-select-checkbox,
.card-select-checkbox.always-visible {
  opacity: 1;
}

.kanban-card.card-selected {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
  background: color-mix(in srgb, var(--primary) 8%, var(--card-bg));
}
```

Also add mobile styles in the mobile media query section:

```css
@media (max-width: 768px) {
  .card-select-checkbox {
    opacity: 1;
  }
}
```

**Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "feat: add card selection checkbox styles"
```

---

### Task 4: Create BulkActionToolbar component

**Files:**
- Create: `client/src/components/BulkActionToolbar.tsx`

**Step 1: Create the component**

```tsx
import { useState, useRef, useEffect } from 'react';
import { Column, Label, BoardMember, Card } from '../types';

interface BulkActionToolbarProps {
  selectedCount: number;
  totalVisible: number;
  columns: Column[];
  boardLabels: Label[];
  boardMembers: BoardMember[];
  onMoveToColumn: (columnId: string) => void;
  onAssignMember: (member: BoardMember) => void;
  onAssignLabel: (labelId: string) => void;
  onArchive: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  allSelected: boolean;
}

export default function BulkActionToolbar({
  selectedCount,
  totalVisible,
  columns,
  boardLabels,
  boardMembers,
  onMoveToColumn,
  onAssignMember,
  onAssignLabel,
  onArchive,
  onDelete,
  onSelectAll,
  onClearSelection,
  allSelected,
}: BulkActionToolbarProps) {
  const [openDropdown, setOpenDropdown] = useState<'move' | 'assign' | 'label' | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="bulk-action-toolbar" ref={toolbarRef}>
      <div className="bulk-toolbar-left">
        <label className="bulk-select-all">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => allSelected ? onClearSelection() : onSelectAll()}
          />
          <span>{selectedCount} selected</span>
        </label>
      </div>

      <div className="bulk-toolbar-actions">
        {/* Move to column */}
        <div className="bulk-action-group">
          <button
            className="btn-secondary btn-sm"
            onClick={() => setOpenDropdown(openDropdown === 'move' ? null : 'move')}
          >
            Move to...
          </button>
          {openDropdown === 'move' && (
            <div className="bulk-dropdown bulk-dropdown-up">
              {columns.map(col => (
                <button key={col.id} onClick={() => { onMoveToColumn(col.id); setOpenDropdown(null); }}>
                  {col.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Assign member */}
        <div className="bulk-action-group">
          <button
            className="btn-secondary btn-sm"
            onClick={() => setOpenDropdown(openDropdown === 'assign' ? null : 'assign')}
          >
            Assign...
          </button>
          {openDropdown === 'assign' && (
            <div className="bulk-dropdown bulk-dropdown-up">
              {boardMembers.map(member => (
                <button key={member.id} onClick={() => { onAssignMember(member); setOpenDropdown(null); }}>
                  {member.username}
                </button>
              ))}
              {boardMembers.length === 0 && (
                <div className="bulk-dropdown-empty">No board members</div>
              )}
            </div>
          )}
        </div>

        {/* Assign label */}
        <div className="bulk-action-group">
          <button
            className="btn-secondary btn-sm"
            onClick={() => setOpenDropdown(openDropdown === 'label' ? null : 'label')}
          >
            Label...
          </button>
          {openDropdown === 'label' && (
            <div className="bulk-dropdown bulk-dropdown-up">
              {boardLabels.map(label => (
                <button key={label.id} onClick={() => { onAssignLabel(label.id); setOpenDropdown(null); }}>
                  <span className="bulk-label-dot" style={{ background: label.color }} />
                  {label.name}
                </button>
              ))}
              {boardLabels.length === 0 && (
                <div className="bulk-dropdown-empty">No labels defined</div>
              )}
            </div>
          )}
        </div>

        {/* Archive */}
        <button className="btn-secondary btn-sm" onClick={onArchive}>
          Archive
        </button>

        {/* Delete */}
        <button className="btn-danger btn-sm" onClick={onDelete}>
          Delete
        </button>
      </div>

      <button className="bulk-toolbar-close" onClick={onClearSelection} aria-label="Clear selection">
        &times;
      </button>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/components/BulkActionToolbar.tsx
git commit -m "feat: create BulkActionToolbar component"
```

---

### Task 5: Add bulk operation handlers to KanbanBoard

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx`

**Step 1: Add bulk operation handler functions**

After the `selectAllVisible` function added in Task 1, add:

```tsx
const handleBulkMoveToColumn = async (targetColumnId: string) => {
  if (selectedCardIds.size === 0 || !board) return;
  const targetColumn = board.columns?.find(c => c.id === targetColumnId);
  let nextPosition = targetColumn?.cards?.length || 0;
  try {
    await Promise.all(
      Array.from(selectedCardIds).map((cardId, i) =>
        api.updateCard(cardId, { column_id: targetColumnId, position: nextPosition + i })
      )
    );
    clearSelection();
    await loadBoard();
    socket?.emit('board-updated', boardId);
  } catch (error: any) {
    alert(`Some cards failed to move: ${error.message}`);
    await loadBoard();
    clearSelection();
  }
};

const handleBulkAssignMember = async (member: BoardMember) => {
  if (selectedCardIds.size === 0 || !board) return;
  const allCards = board.columns?.flatMap(c => c.cards || []) || [];
  try {
    await Promise.all(
      Array.from(selectedCardIds).map(cardId => {
        const card = allCards.find(c => c.id === cardId);
        if (!card) return Promise.resolve();
        const existing = card.assignees || [];
        if (existing.some(a => a.username === member.username)) return Promise.resolve();
        return api.updateCard(cardId, {
          assignees: [...existing, { id: '', user_id: member.id, username: member.username }],
        } as any);
      })
    );
    clearSelection();
    await loadBoard();
    socket?.emit('board-updated', boardId);
  } catch (error: any) {
    alert(`Some cards failed to update: ${error.message}`);
    await loadBoard();
    clearSelection();
  }
};

const handleBulkAssignLabel = async (labelId: string) => {
  if (selectedCardIds.size === 0 || !board) return;
  const allCards = board.columns?.flatMap(c => c.cards || []) || [];
  try {
    await Promise.all(
      Array.from(selectedCardIds).map(cardId => {
        const card = allCards.find(c => c.id === cardId);
        if (!card) return Promise.resolve();
        const existingLabelIds = (card.labels || []).map(l => l.id);
        if (existingLabelIds.includes(labelId)) return Promise.resolve();
        return api.updateCard(cardId, {
          labels: [...existingLabelIds, labelId],
        } as any);
      })
    );
    clearSelection();
    await loadBoard();
    socket?.emit('board-updated', boardId);
  } catch (error: any) {
    alert(`Some cards failed to update: ${error.message}`);
    await loadBoard();
    clearSelection();
  }
};

const handleBulkArchive = async () => {
  if (selectedCardIds.size === 0) return;
  if (!await confirm(`Archive ${selectedCardIds.size} card${selectedCardIds.size > 1 ? 's' : ''}?`, { confirmLabel: 'Archive' })) return;
  try {
    await Promise.all(
      Array.from(selectedCardIds).map(cardId =>
        api.updateCard(cardId, { archived: true } as any)
      )
    );
    clearSelection();
    await loadBoard();
    socket?.emit('board-updated', boardId);
  } catch (error: any) {
    alert(`Some cards failed to archive: ${error.message}`);
    await loadBoard();
    clearSelection();
  }
};

const handleBulkDelete = async () => {
  if (selectedCardIds.size === 0) return;
  if (!await confirm(`Permanently delete ${selectedCardIds.size} card${selectedCardIds.size > 1 ? 's' : ''}? This cannot be undone.`, { confirmLabel: 'Delete' })) return;
  try {
    await Promise.all(
      Array.from(selectedCardIds).map(cardId => api.deleteCard(cardId))
    );
    clearSelection();
    await loadBoard();
    socket?.emit('board-updated', boardId);
  } catch (error: any) {
    alert(`Some cards failed to delete: ${error.message}`);
    await loadBoard();
    clearSelection();
  }
};
```

**Step 2: Commit**

```bash
git add client/src/components/KanbanBoard.tsx
git commit -m "feat: add bulk operation handlers (move, assign, label, archive, delete)"
```

---

### Task 6: Wire BulkActionToolbar into KanbanBoard

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx`

**Step 1: Import BulkActionToolbar**

At the top of `KanbanBoard.tsx`, add import:

```tsx
import BulkActionToolbar from './BulkActionToolbar';
```

**Step 2: Compute totalVisible and allSelected**

Before the return statement (around line 596), add:

```tsx
const totalVisibleCards = board.columns?.reduce((sum, col) => sum + (col.cards || []).filter(filterCard).length, 0) || 0;
const allVisibleSelected = totalVisibleCards > 0 && selectedCardIds.size === totalVisibleCards;
```

**Step 3: Render toolbar before closing `</div>` of kanban-container**

Just before the closing `</div>` of the `kanban-container` (line 1069), add:

```tsx
{selectedCardIds.size > 0 && userRole !== 'READ' && (
  <BulkActionToolbar
    selectedCount={selectedCardIds.size}
    totalVisible={totalVisibleCards}
    columns={board.columns || []}
    boardLabels={boardLabels}
    boardMembers={boardMembers}
    onMoveToColumn={handleBulkMoveToColumn}
    onAssignMember={handleBulkAssignMember}
    onAssignLabel={handleBulkAssignLabel}
    onArchive={handleBulkArchive}
    onDelete={handleBulkDelete}
    onSelectAll={selectAllVisible}
    onClearSelection={clearSelection}
    allSelected={allVisibleSelected}
  />
)}
```

**Step 4: Commit**

```bash
git add client/src/components/KanbanBoard.tsx
git commit -m "feat: wire BulkActionToolbar into KanbanBoard"
```

---

### Task 7: Add BulkActionToolbar CSS

**Files:**
- Modify: `client/src/index.css`

**Step 1: Add toolbar styles**

Add after the card selection styles from Task 3:

```css
/* Bulk Action Toolbar */
.bulk-action-toolbar {
  position: fixed;
  bottom: 1.5rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 1rem;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 0.5rem 0.75rem;
  z-index: 1100;
  animation: modalIn 0.25s var(--ease-spring);
  max-width: 95vw;
}

.bulk-toolbar-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  white-space: nowrap;
}

.bulk-select-all {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  color: var(--text);
}

.bulk-select-all input[type="checkbox"] {
  accent-color: var(--primary);
  cursor: pointer;
}

.bulk-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.bulk-action-group {
  position: relative;
}

.bulk-dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  min-width: 180px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  z-index: 1200;
  animation: modalIn 0.15s var(--ease-spring);
}

.bulk-dropdown button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: none;
  background: none;
  text-align: left;
  font-size: 0.85rem;
  color: var(--text);
  cursor: pointer;
}

.bulk-dropdown button:hover {
  background: var(--hover);
}

.bulk-dropdown-empty {
  padding: 0.5rem 0.75rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.bulk-label-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.bulk-toolbar-close {
  background: none;
  border: none;
  font-size: 1.25rem;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0 0.25rem;
  line-height: 1;
}

.bulk-toolbar-close:hover {
  color: var(--text);
}

/* Mobile bulk toolbar */
@media (max-width: 768px) {
  .bulk-action-toolbar {
    bottom: 0.75rem;
    left: 0.75rem;
    right: 0.75rem;
    transform: none;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .bulk-toolbar-actions {
    flex-wrap: wrap;
  }
}
```

**Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "feat: add BulkActionToolbar styles"
```

---

### Task 8: Test and verify all bulk operations

**Files:** None (manual testing)

**Step 1: Start the dev server**

```bash
cd client && npm run dev
```

**Step 2: Test selection**

- Hover over a card → checkbox appears top-left
- Click checkbox → card gets highlighted outline, checkbox stays visible on all cards
- Click another card's checkbox → both selected
- Shift+click a card in same column → range selected
- Press Escape → all deselected
- Select cards → click a card to open it → selection clears

**Step 3: Test move to column**

- Select 2+ cards from different columns
- Click "Move to..." → pick a target column
- All selected cards should move to that column
- Selection clears

**Step 4: Test assign member**

- Select cards → click "Assign..." → pick a member
- Cards that already have that member should be unchanged
- Cards without should get the new assignee

**Step 5: Test assign label**

- Select cards → click "Label..." → pick a label
- Cards already with that label should be unchanged
- Cards without should get the new label

**Step 6: Test archive**

- Select cards → click "Archive"
- Confirm dialog appears with count
- Cards are archived

**Step 7: Test delete**

- Select cards → click "Delete"
- Confirm dialog appears with "cannot be undone" warning
- Cards are permanently deleted

**Step 8: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: bulk operation refinements"
```

---

### Task 9: Push to remote

**Step 1: Push**

```bash
git push origin main
```

**Step 2: Run completion event**

```bash
openclaw system event --text "Done: Bulk card operations shipped" --mode now
```
