# Keyboard Shortcuts Design

**Date:** 2026-02-27

## Overview

Add a centralized keyboard shortcut system with a discoverable help overlay. Power users should be able to navigate and operate Pliny without touching the mouse. All shortcuts are scoped to prevent conflicts with browser defaults and active text inputs.

---

## Architecture

### Central Hook: `useKeyboardShortcuts`

Create `client/src/hooks/useKeyboardShortcuts.ts` — a single hook that owns ALL keydown listeners. Replaces the scattered `window.addEventListener('keydown', ...)` in App.tsx, KanbanBoard.tsx, and DevConsole.tsx.

```ts
interface Shortcut {
  key: string;            // 'k', 'n', 'Escape', etc.
  meta?: boolean;         // Cmd/Ctrl
  shift?: boolean;
  description: string;   // shown in help overlay
  group: string;          // 'Navigation' | 'Board' | 'Card' | 'Global'
  action: () => void;
  disabled?: boolean;     // suppress when modal/input focused
}
```

**Safety rule:** Never fire shortcuts when focus is inside an `<input>`, `<textarea>`, `[contenteditable]`, or any open modal that has its own form inputs. Check `document.activeElement` and bail early.

### Help Overlay

- Press `?` anywhere (outside inputs) to toggle
- Full-screen modal showing all shortcuts grouped by category
- Same visual style as GlobalSearchModal
- Close with `Escape` or `?`

---

## Shortcut Map

### Global (work everywhere)
| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+K` | Open global search *(existing)* |
| `?` | Toggle keyboard shortcuts help |
| `Escape` | Close open modal / clear selection *(existing, consolidate)* |

### Board View
| Shortcut | Action |
|----------|--------|
| `N` | New card in first column |
| `C` | New column |
| `F` | Focus filter/search bar |
| `H` | Toggle "Hide subtasks" |
| `Cmd/Ctrl+A` | Select all visible cards (bulk select) |
| `Escape` | Clear bulk selection |
| `Delete` / `Backspace` | Archive selected cards (with confirmation) if bulk selection active |

### Card Detail Modal (when open)
| Shortcut | Action |
|----------|--------|
| `Escape` | Close card detail |
| `E` | Focus title (edit mode) |
| `L` | Open label picker |
| `A` | Open assignee picker |
| `D` | Open due date picker |
| `Cmd/Ctrl+Enter` | Save description / submit comment |
| `[` / `]` | Move card to previous / next column |

### Navigation
| Shortcut | Action |
|----------|--------|
| `G then B` | Go to Boards list |
| `G then C` | Go to Calendar view |
| `G then S` | Go to Settings |

Sequential shortcuts (`G then X`) have a 1-second window between keystrokes.

---

## Help Overlay UI

```
┌─────────────────────────────────────────────┐
│  Keyboard Shortcuts                    [Esc] │
├───────────────┬─────────────────────────────┤
│  Global       │  Board                      │
│  ?  Help      │  N  New card                │
│  Cmd+K Search │  C  New column              │
│               │  F  Focus filter            │
│  Card Detail  │  H  Hide subtasks           │
│  E  Edit title│  Cmd+A  Select all          │
│  L  Labels    │                             │
│  A  Assignees │  Navigation                 │
│  D  Due date  │  G B  Boards                │
│  [ ]  Move    │  G C  Calendar              │
│               │  G S  Settings              │
└───────────────┴─────────────────────────────┘
```

Shortcut pills use `<kbd>` tags. Same dark/light theme support as the rest of the app.

---

## Implementation Notes

- Consolidate existing handlers in App.tsx and KanbanBoard.tsx into the new hook
- `useKeyboardShortcuts` registered at the App level; passes context-specific shortcuts as props/callbacks from child components
- Card detail modal registers its shortcuts when mounted, deregisters on unmount
- Sequential shortcuts (`G then X`) use a `pendingKey` ref with a `setTimeout` reset
- `?` key: check `e.key === '?'` (shift+/ on US keyboards), but also `e.key === '/' && e.shiftKey` for cross-platform safety
- Add a small `?` icon button to the board toolbar that opens the help overlay (discoverable for non-power-users)
- No new dependencies — pure React hooks + CSS

---

## Files to Create/Modify

**Create:**
- `client/src/hooks/useKeyboardShortcuts.ts` — central shortcut registry
- `client/src/components/KeyboardShortcutsModal.tsx` — help overlay
- CSS in `client/src/index.css` — shortcut help styles, `kbd` styling

**Modify:**
- `client/src/App.tsx` — remove existing Cmd+K handler, use new hook
- `client/src/components/KanbanBoard.tsx` — remove existing Escape handler, add board shortcuts
- `client/src/components/CardModal.tsx` — add card-scoped shortcuts
- `client/src/components/BoardHeader.tsx` (or equivalent) — add `?` icon button
