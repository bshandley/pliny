# Confirmation Modals Design

Replace `window.confirm()` calls with styled in-app confirmation modals using a React Context + hook pattern.

## Architecture

Three pieces, all in one file (`contexts/ConfirmContext.tsx`):

- **ConfirmContext + ConfirmProvider** - Wraps the app, manages modal state, renders a single ConfirmModal at the top level.
- **useConfirm hook** - Returns an async `confirm()` function any component can call.
- **ConfirmModal** - Presentational component: message text, Cancel button, contextual action button (red/destructive).

## API

```tsx
const confirm = useConfirm();

const ok = await confirm("Delete this card?", { confirmLabel: "Delete" });
if (!ok) return;
```

- `message: string` - the prompt text
- `options?: { confirmLabel?: string }` - defaults to "Confirm"
- Returns `Promise<boolean>` - true on confirm, false on cancel/overlay click

## Provider State

Single pending confirmation stored as:

```tsx
{ message: string; confirmLabel: string; resolve: (value: boolean) => void } | null
```

When `confirm()` is called, a Promise is created and the `resolve` function is stashed in state. Clicking Confirm calls `resolve(true)`, Cancel or overlay calls `resolve(false)`. State resets to null after either.

## Styling

Reuses existing `.modal-overlay` / `.modal` CSS classes. One new class: `.btn-danger` for the red confirm button.

## Refactor Targets

5 call sites across 4 files:

| File | Action |
|------|--------|
| `KanbanBoard.tsx` | Delete card |
| `KanbanBoard.tsx` | Delete column |
| `BoardMembers.tsx` | Remove member |
| `BoardAssignees.tsx` | Remove assignee |
| `UserManagement.tsx` | Delete user |

Each changes from `if (!confirm(...)) return;` to `if (!await confirm(...)) return;` with `const confirm = useConfirm();` added.

## File Changes

- **New:** `client/src/contexts/ConfirmContext.tsx` - Provider, hook, and modal component
- **Edit:** `client/src/App.tsx` - wrap with `<ConfirmProvider>`
- **Edit:** `client/src/components/KanbanBoard.tsx` - 2 call sites
- **Edit:** `client/src/components/BoardMembers.tsx` - 1 call site
- **Edit:** `client/src/components/BoardAssignees.tsx` - 1 call site
- **Edit:** `client/src/components/UserManagement.tsx` - 1 call site
