# Unified Card Assignment Model

## Problem

Cards have two parallel assignment systems: `card_assignees` (free-text names from a pre-configured `board_assignees` pool) and `card_members` (real user accounts). This is confusing, redundant, and splits notification logic from display logic.

## Decision

Merge into a single `card_assignees` table with an optional `user_id`. Linked assignments (real account) get notifications. Unlinked assignments (free-text name) are labels only. Drop `card_members`, `board_assignees`. Keep `board_members` (access control, separate concern). Also unify checklist item assignees.

## New Schema

### card_assignees (replaces old card_assignees + card_members)

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | Row identity |
| card_id | UUID FK cards ON DELETE CASCADE | |
| user_id | UUID FK users ON DELETE CASCADE, nullable | Non-null = linked |
| display_name | VARCHAR(100), nullable | Non-null = unlinked free-text. NULL when linked (derive name via JOIN to users) |
| created_at | TIMESTAMP | |

Constraints:
- `UNIQUE (card_id, user_id) WHERE user_id IS NOT NULL`
- `UNIQUE (card_id, display_name) WHERE user_id IS NULL`
- `CHECK (user_id IS NOT NULL OR display_name IS NOT NULL)`

### card_checklist_items changes

Add `assignee_user_id UUID FK users ON DELETE SET NULL`. Existing `assignee_name` stays for unlinked. If `assignee_user_id` is set, it's linked (derive display name via JOIN).

### Tables dropped

- `card_members` — absorbed into card_assignees
- `board_assignees` — no more pre-configured name pool

### Tables unchanged

- `board_members` — access control, untouched

## Migration 017

1. Rename old `card_assignees` to `card_assignees_old`
2. Create new `card_assignees` with new schema
3. Migrate `card_members` rows as linked assignments (user_id set, display_name NULL)
4. Migrate `card_assignees_old` rows:
   - If assignee_name matches a users.username AND no linked row exists for that card+user yet → insert as linked (auto-link)
   - Otherwise → insert as unlinked (display_name = assignee_name)
   - Skip duplicates (same card + same resolved identity)
5. Add `assignee_user_id` to `card_checklist_items`, migrate existing `assignee_name` values that match usernames to linked form
6. Drop `card_members`, `board_assignees`, `card_assignees_old`
7. Drop old indexes, create new indexes on card_assignees(card_id), card_assignees(user_id)

## API Changes

### Removed endpoints
- `GET/PUT /cards/:cardId/members`
- `GET/POST/PUT/DELETE /boards/:boardId/assignees/:assigneeId`

### Modified endpoints

**Card update** (`PUT /cards/:id`): `assignees` field changes from `string[]` to `{ user_id?, display_name? }[]`. Server auto-links if a `display_name` matches a board member's username.

**Board fetch** (`GET /boards/:id`): Card objects change from separate `assignees: string[]` + `members: {id, username}[]` to unified `assignees: { id, user_id?, username?, display_name }[]`.

**Analytics** (`GET /boards/:id/analytics`): `cards_by_assignee` uses `COALESCE(u.username, ca.display_name, 'Unassigned')`.

**CSV export**: Outputs resolved name (username for linked, display_name for unlinked).
**CSV import**: Accepts names, auto-links to users where possible, creates unlinked otherwise. No more board_assignees auto-creation.

**Checklist items**: Accept `assignee_user_id` alongside `assignee_name`. Return both fields.

### Public API v1

Assignee shape changes from strings to objects. No backward compat needed (no existing users).

## Notification Changes

`notifyCardMembers()` query changes from:
```sql
SELECT user_id FROM card_members WHERE card_id = $1
```
to:
```sql
SELECT user_id FROM card_assignees WHERE card_id = $1 AND user_id IS NOT NULL
```

Due date reminder in index.ts uses the same new query.

## UI Changes

### KanbanCard assignment picker
Single unified autocomplete. Board members shown first (user icon prefix). Below, free-text entry for unlinked names. No more "Members" vs "Assignees" groups. Chips show username for linked (with user icon), display_name for unlinked. Auto-link if typed name matches a board member.

### BoardAssignees component
Deleted. "Manage Assignees" kebab menu item removed.

### Checklist item assignee dropdown
Shows board members first, then free-text entry option. Same pattern as card picker.

### TableCell, TableView, DashboardView, MentionText
Updated to use unified `assignees` array with new shape. Display `username || display_name`.

### Card footer (collapsed view)
Single row of assignee badges. Linked assignees get a subtle user icon. Unlinked are plain text chips.

## Activity Log

Unified to single `assignees_changed` action. `members_changed` action type no longer produced. Old activity entries still render fine (display logic handles both).

## Files Affected

### Server (delete)
- `server/src/routes/cardMembers.ts`
- `server/src/routes/assignees.ts`

### Server (modify)
- `server/src/routes/cards.ts` — assignee update logic
- `server/src/routes/boards.ts` — board fetch query
- `server/src/routes/analytics.ts` — by-assignee query
- `server/src/routes/csv.ts` — import/export
- `server/src/routes/v1.ts` — public API response shape, checklist assignee
- `server/src/services/notificationHelper.ts` — query change
- `server/src/index.ts` — remove cardMembers route, update due-date reminder query
- `server/src/migrations/schema.sql` — update canonical schema

### Server (create)
- `server/src/migrations/017-unify-assignees.sql`

### Client (delete)
- `client/src/components/BoardAssignees.tsx`

### Client (modify)
- `client/src/components/KanbanCard.tsx` — unified picker, single state
- `client/src/components/KanbanBoard.tsx` — remove board assignees loading/menu item
- `client/src/components/TableView.tsx` — updated data shape
- `client/src/components/TableCell.tsx` — updated AssigneesCell
- `client/src/components/DashboardView.tsx` — updated chart data
- `client/src/components/MentionText.tsx` — updated mention matching
- `client/src/api.ts` — remove board assignee CRUD, remove card member CRUD, update types
- `client/src/types.ts` — unified Assignee type, remove CardMember
- `client/src/index.css` — update assignee chip styles
