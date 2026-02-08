# Board & Column Management + Label Filter Colors

## Overview
Five UI improvements: delete boards, archive boards, rename boards, colored label filter dropdown, rename columns. Most backend APIs already exist — this is primarily frontend work plus one migration for board archiving.

## 1. Database Migration

```sql
ALTER TABLE boards ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE;
```

No other schema changes needed.

## 2. Backend Changes (server/src/routes/boards.ts)

- GET /boards: include `archived` field in response
- PUT /boards/:id: allow `archived` field in updates (for archive/unarchive)
- Delete and rename already work via existing endpoints

## 3. Board List Kebab Menu (client/src/components/BoardList.tsx)

Add a three-dot kebab menu (admin-only) on each board card with three actions:
- **Rename** — small modal to edit board name, calls PUT /boards/:id
- **Archive** — calls PUT /boards/:id with { archived: true }, removes from active list
- **Delete** — confirmation modal (useConfirm), calls DELETE /boards/:id

Board list filters out archived boards by default. Below the active boards grid, a collapsible **"Archived Boards"** section shows archived boards with a **Restore** button (calls PUT with { archived: false }). Same pattern as card archiving.

## 4. Column Header Kebab Menu (client/src/components/KanbanBoard.tsx)

Replace the standalone X delete button on each column header with a kebab menu (admin-only). Two actions:
- **Rename** — inline text input replaces column name. Enter/blur saves, Escape cancels. Calls PUT /columns/:id with { name }.
- **Delete** — same confirmation modal behavior as current X button.

## 5. Label Colors in Filter Dropdown (client/src/components/KanbanBoard.tsx)

Replace the native `<select>` for label filtering with a custom dropdown component:
- Trigger button styled to match other filter selects
- Dropdown list shows colored circle + label name per row
- "All labels" default option
- Closes on selection or clicking outside

## 6. Race Conditions & Real-Time Safety

### Board archived while someone is viewing it
- On `loadBoard`, if the returned board has `archived: true`, navigate back to board list.

### Board deleted while someone is viewing it
- On `loadBoard` 404, navigate back to board list gracefully (no error flash).

### Column deleted while someone is dragging a card into it
- Wrap drop handler in try/catch. On failure, reload board silently (board refreshes to current state).

### Concurrent renames
- Last write wins. Both users see updated state on next WebSocket refresh. No conflict resolution needed.

### Board list consistency
- Board list already re-fetches on socket events. Archive/delete by another user causes seamless re-render.

## Files to Modify

1. **New migration**: `server/src/migrations/005-board-archive.sql`
2. **server/src/routes/boards.ts**: include archived field in GET, allow in PUT
3. **server/src/migrations/run.ts**: register new migration
4. **client/src/types.ts**: add `archived?: boolean` to Board interface
5. **client/src/api.ts**: no changes needed (updateBoard already passes arbitrary fields)
6. **client/src/components/BoardList.tsx**: kebab menu, archived section, rename modal
7. **client/src/components/KanbanBoard.tsx**: column kebab menu, label filter dropdown, archived board redirect, drop error handling
8. **client/src/index.css**: styles for kebab menus, custom dropdown, archived section
