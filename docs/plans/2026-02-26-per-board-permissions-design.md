# Per-Board Permissions Design

## Overview

Replace global-role-based authorization for board actions with per-board roles stored in `board_members`. Each board member has an independent role (ADMIN, COLLABORATOR, READ) that governs what they can do within that board. Global ADMIN remains a superuser override.

## Data Model

### Schema change (Migration 024)

```sql
ALTER TABLE board_members
  ADD COLUMN role TEXT NOT NULL DEFAULT 'COLLABORATOR'
  CHECK (role IN ('ADMIN', 'COLLABORATOR', 'READ'));
```

### Data migration (same file)

```sql
-- Insert board creators who aren't already in board_members
INSERT INTO board_members (board_id, user_id, role)
SELECT b.id, b.created_by, 'ADMIN'
FROM boards b
WHERE b.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM board_members bm
    WHERE bm.board_id = b.id AND bm.user_id = b.created_by
  );

-- Promote existing creator rows to ADMIN
UPDATE board_members bm
SET role = 'ADMIN'
FROM boards b
WHERE bm.board_id = b.id
  AND bm.user_id = b.created_by;
```

### Board creation change

When a board is created, INSERT the creator into `board_members` with `role = 'ADMIN'`.

### Role hierarchy

```
ADMIN (2) > COLLABORATOR (1) > READ (0)
```

Global ADMIN on `users.role` always acts as board ADMIN on every board.

## Permission Matrix

| Action | READ | COLLABORATOR | ADMIN |
|--------|------|-------------|-------|
| View board, cards, columns, comments | Yes | Yes | Yes |
| Create/edit/delete cards | No | Yes | Yes |
| Move cards between columns | No | Yes | Yes |
| Manage checklists on cards | No | Yes | Yes |
| Upload/delete attachments | No | Yes | Yes |
| Add/delete comments | No | Yes | Yes |
| Create/rename/reorder/delete columns | No | No | Yes |
| Create/edit/delete labels | No | No | Yes |
| Manage custom fields | No | No | Yes |
| Add/remove board members | No | No | Yes |
| Change member roles | No | No | Yes |
| Edit board name/description | No | No | Yes |
| Delete board | No | No | Yes |
| Generate/revoke public link | No | No | Yes |
| View analytics | Yes | Yes | Yes |

## Global vs Board Role Interaction

| Global role | Board behavior |
|-------------|---------------|
| ADMIN | Full access to ALL boards (implicit board ADMIN). Can manage users, create boards. |
| COLLABORATOR | Access only boards in `board_members`. Board-level role governs actions. Can be board ADMIN. |
| READ | Access only boards in `board_members`. Board-level role governs actions. Can be board ADMIN. |

Board creation stays global ADMIN only. User management stays global ADMIN only.

## Middleware Design

### Approach: Per-route `requireBoardRole` middleware

Replace `requireAdmin` on board-scoped routes with `requireBoardRole(minimumRole)`.

```typescript
type BoardRole = 'READ' | 'COLLABORATOR' | 'ADMIN';
const ROLE_RANK = { READ: 0, COLLABORATOR: 1, ADMIN: 2 };

function requireBoardRole(minimumRole: BoardRole) {
  return async (req, res, next) => {
    if (req.user?.role === 'ADMIN') return next(); // global admin override

    const boardId = await resolveBoardId(req);
    if (!boardId) return res.status(404).json({ error: 'Board not found' });

    const result = await pool.query(
      'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
      [boardId, req.user.id]
    );
    if (result.rows.length === 0)
      return res.status(403).json({ error: 'Not a board member' });

    if (ROLE_RANK[result.rows[0].role] < ROLE_RANK[minimumRole])
      return res.status(403).json({ error: 'Insufficient board permissions' });

    req.boardRole = result.rows[0].role;
    next();
  };
}
```

### Board ID resolution

| Route pattern | Resolution |
|---|---|
| `/boards/:id/...` | `req.params.id` |
| `/cards/:id` (PUT/DELETE) | `SELECT board_id FROM cards WHERE id = $1` |
| `/cards` (POST) | `req.body.column_id` -> `SELECT board_id FROM columns WHERE id = $1` |
| `/columns/:id` | `SELECT board_id FROM columns WHERE id = $1` |
| `/columns` (POST) | `req.body.board_id` |
| `/cards/:cardId/comments` | Card -> column -> board chain |
| `/cards/:cardId/checklist` | Same as comments |
| `/boards/:boardId/labels` | `req.params.boardId` |

### Route assignments

```
POST   /boards                    -> requireAdmin (global — board creation)
GET    /boards/:id                -> requireBoardRole('READ')
PUT    /boards/:id                -> requireBoardRole('ADMIN')
DELETE /boards/:id                -> requireBoardRole('ADMIN')
GET    /boards/:id/members        -> requireBoardRole('READ')
POST   /boards/:id/members        -> requireBoardRole('ADMIN')
DELETE /boards/:id/members/:uid   -> requireBoardRole('ADMIN')
POST   /boards/:id/public-link    -> requireBoardRole('ADMIN')
DELETE /boards/:id/public-link    -> requireBoardRole('ADMIN')
GET    /boards/:id/analytics      -> requireBoardRole('READ')     [FIX: was unprotected]
GET    /boards/:id/export         -> requireBoardRole('READ')

POST   /cards                     -> requireBoardRole('COLLABORATOR')
PUT    /cards/:id                 -> requireBoardRole('COLLABORATOR')
DELETE /cards/:id                 -> requireBoardRole('COLLABORATOR')

POST   /columns                   -> requireBoardRole('ADMIN')
PUT    /columns/:id               -> requireBoardRole('ADMIN')
DELETE /columns/:id               -> requireBoardRole('ADMIN')

POST   /cards/:cardId/comments    -> requireBoardRole('COLLABORATOR')  [FIX: was unprotected]
DELETE /comments/:id              -> requireBoardRole('COLLABORATOR')  [FIX: was unprotected]

POST   /cards/:cardId/checklist   -> requireBoardRole('COLLABORATOR')
PUT    /checklist/:id             -> requireBoardRole('COLLABORATOR')
DELETE /checklist/:id             -> requireBoardRole('COLLABORATOR')

POST   /boards/:boardId/labels    -> requireBoardRole('ADMIN')
PUT    /labels/:id                -> requireBoardRole('ADMIN')
DELETE /labels/:id                -> requireBoardRole('ADMIN')

POST   /cards/:cardId/attachments -> requireBoardRole('COLLABORATOR')  [FIX: was unprotected]
DELETE /attachments/:id           -> requireBoardRole('COLLABORATOR')  [FIX: was unprotected]

POST   /custom-fields             -> requireBoardRole('ADMIN')
PUT    /custom-fields/:id         -> requireBoardRole('ADMIN')
DELETE /custom-fields/:id         -> requireBoardRole('ADMIN')
```

## UI Changes

### Board member list (BoardMembers.tsx)

- Show board role badge instead of global role
- Role dropdown next to each member (visible to board ADMINs only)
- Dropdown options: ADMIN, COLLABORATOR, READ
- Disabled on self if last admin (tooltip: "Cannot change — you are the last admin")
- Remove button visible to board ADMINs only, disabled on last admin

### Add member flow

- Show ALL non-member users (not just READ users)
- Add role picker dropdown next to user selector (default: COLLABORATOR)
- Only visible to board ADMINs and global ADMINs

### Board settings visibility

- Board ADMINs: name/description editing, member management, public link, danger zone
- COLLABORATOR/READ: read-only board info, member list (no add/remove/role-change)

### Card/column UI gating

- Hide "Add Card", "Edit", "Delete" for READ members
- Hide "Add Column", column edit/delete for non-board-ADMINs
- Hide comment input for READ members

### API response

Extend `GET /boards/:id` to include `currentUserRole: 'ADMIN' | 'COLLABORATOR' | 'READ'` for the authenticated user. Frontend uses this to gate UI elements.

## Edge Cases

1. **Last admin removal/demotion:** Rejected with error "Cannot remove the last board admin. Transfer admin to another member first."

2. **User deletion orphaning boards:** Blocked. If deleting a user would leave any board with no ADMIN, reject the delete with a 400 listing affected boards. Global admin must reassign board admins first.

3. **Global ADMIN demoted:** They lose superuser access but retain any explicit `board_members` roles. Boards they're not members of become inaccessible.

4. **Board with zero members:** Only global ADMINs can see/access it and add themselves.

5. **Self-demotion:** Allowed if another ADMIN exists. Rejected if last admin.

6. **Race conditions:** Use `SELECT ... FOR UPDATE` on `board_members` rows when checking/modifying admin count.

## Security fixes included

- Analytics endpoint: add `requireBoardRole('READ')` (was unprotected)
- Comments endpoints: add `requireBoardRole('COLLABORATOR')` (was unprotected)
- Attachments endpoints: add `requireBoardRole('COLLABORATOR')` (was unprotected)
