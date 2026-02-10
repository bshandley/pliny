# Card Activity, @Mentions, and Notifications

## Overview

Three interconnected features that bring collaboration visibility to Plank:

1. **Card activity logging** - Track meaningful changes to cards as a timeline
2. **@Mentions** - Tag board members and assignees in cards and comments
3. **Notifications** - In-app real-time notifications triggered by @mentions

## Key Design Decisions

- **Assignees stay as freeform strings**, separate from board members (user accounts). Assignees may not have system access.
- **@Mentions target board members** (real users) for notifications. Assignees can be @mentioned in comments for autocompletion only (no notification).
- **Activity logging tracks core + field changes**: created, moved, archived/unarchived, title, description, assignees, members, labels, due date.
- **Notifications are in-app only**, delivered in real-time via existing Socket.io. No email.
- **Only explicit @mentions trigger notifications**. No "watch" or subscription model.
- **Single combined input** for assigning members and assignees on cards, with a grouped autocomplete dropdown.
- **Color-coded chips** distinguish members (blue, will notify) from assignees (gray, no notification).
- **Activity displays inside the card** as a collapsible section, not as a board-level feed.

## Database Schema

### `card_activity`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, default gen_random_uuid() |
| card_id | uuid | FK to cards, ON DELETE CASCADE |
| user_id | uuid | FK to users |
| action | text | One of: `created`, `moved`, `archived`, `unarchived`, `title_changed`, `description_changed`, `assignees_changed`, `members_changed`, `labels_changed`, `due_date_changed` |
| detail | jsonb | Nullable. Structured context, e.g. `{"from_column": "Backlog", "to_column": "In Progress"}` or `{"added": ["Bradley"], "removed": []}` |
| created_at | timestamp | Default CURRENT_TIMESTAMP |

### `card_members`

Links real user accounts to cards (the @member-on-card feature).

| Column | Type | Notes |
|--------|------|-------|
| card_id | uuid | FK to cards, ON DELETE CASCADE |
| user_id | uuid | FK to users, ON DELETE CASCADE |
| created_at | timestamp | Default CURRENT_TIMESTAMP |

PK on `(card_id, user_id)`.

### `notifications`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, default gen_random_uuid() |
| user_id | uuid | FK to users, ON DELETE CASCADE. The recipient. |
| type | text | `mention_card` or `mention_comment` |
| card_id | uuid | FK to cards, ON DELETE CASCADE |
| board_id | uuid | FK to boards, ON DELETE CASCADE |
| actor_id | uuid | FK to users. Who triggered the notification. |
| detail | jsonb | e.g. `{"comment_text": "Hey @Bradley check this"}` |
| read | boolean | Default false |
| created_at | timestamp | Default CURRENT_TIMESTAMP |

No changes to existing tables. Assignees remain as-is (freeform strings in `card_assignees`).

## API Endpoints

### Activity

- `GET /api/cards/:cardId/activity` - Returns activity entries for a card, newest-first. Joins `users` for username.

### Card Members

- `GET /api/cards/:cardId/members` - List members on a card (user id + username).
- `PUT /api/cards/:cardId/members` - Set card members (accepts array of user IDs, replaces current set). Mirrors how assignees work.

### Notifications

- `GET /api/notifications` - Current user's notifications, newest-first, limit 50. Includes board name and card title via joins.
- `PUT /api/notifications/:id/read` - Mark single notification as read.
- `PUT /api/notifications/read-all` - Mark all as read.

## Activity Logging

Activity entries are created server-side inside existing card route handlers. On card update, the server compares old values to new values and inserts a `card_activity` row for each changed field.

For column moves (`column_id` changes), the detail stores column names looked up at write time, so entries remain readable if columns are later renamed or deleted.

Activity logging is fire-and-forget. Failures are logged but do not block the card update response.

## @Mention System

### Comment @mentions

Comments stay as plain text in the database. Parsing happens at two points:

1. **Frontend (display)** - Regex `/@(\w+)/g` finds mentions. Each is checked against the board's members and assignees lists, then rendered as a colored chip: blue for members, gray for assignees, plain text if no match.

2. **Backend (notification creation)** - On comment POST, the server parses text for @mentions, cross-references against board members, and creates a `notifications` row for each mentioned member. Assignee mentions are ignored.

### Card @member flow

The card edit form uses a combined autocomplete input. On save, PUT `/api/cards/:id` receives both `assignees` (string array) and `members` (user ID array). The server:

1. Updates `card_assignees` (existing behavior)
2. Diffs `card_members` - old vs new to find added/removed
3. Creates `card_activity` entries for changes to either
4. Creates `notifications` for newly-added members

### Autocomplete dropdown

Grouped dropdown with two sections:

- **Members** header (with bell icon) - from board members list. Blue chips.
- **Assignees** header - from board assignees list. Gray chips.

Both filter as you type after `@`.

## Notifications & Bell UI

### Socket.io

The server tracks which socket connections belong to which user IDs (`Map<userId, socketId[]>`). When a notification is created, it emits `notification:new` to the target user with the full notification object.

Point-to-point delivery, no new rooms needed.

### Bell icon

Located in the app header, top-right area:

- Red badge with unread count (hidden when 0)
- Click opens a dropdown panel
- Each row: actor username, action description, card title, board name, relative time
  - "**Bradley** mentioned you on **Fix login bug** in Design Board - 2m ago"
  - "**Bradley** added you to **API redesign** in Backend Board - 1h ago"
- Click a notification: marks as read, navigates to that board
- "Mark all as read" button at top
- Unread notifications have subtle highlight; read ones are dimmed
- No automatic pruning for now

## Frontend Components

### Modified

**`KanbanCard.tsx`** - Largest change:
- Combined autocomplete replaces assignee-only input. Grouped dropdown, color-coded chips.
- New collapsible "Activity" section below Comments. Read-only timeline.
- Loads card members and activity on edit (alongside comments/checklist).

**`KanbanBoard.tsx`** - Minor:
- Passes board members list to KanbanCard.
- Comment rendering uses MentionText for @mention chip display.

### New

**`NotificationBell.tsx`** - Bell icon + dropdown in app header. Self-contained: fetches notifications on mount, listens for `notification:new` socket events, handles mark-as-read.

**`MentionText.tsx`** - Utility component. Takes plain text + members/assignees lists, renders @mentions as colored chips. Used by comment rendering.

### Unchanged

`BoardList.tsx`, `BoardMembers.tsx`, `BoardAssignees.tsx`, `BoardLabels.tsx`, `Login.tsx`, `UserManagement.tsx`, `PlankLogo.tsx`.
