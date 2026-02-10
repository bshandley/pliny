# Collaborator Role & Card Detail View Design

**Goal:** Add a COLLABORATOR role that can comment on cards with full @mention support, give READ users a read-only card detail view, and establish a three-tier permission model.

**Architecture:** Add COLLABORATOR to the DB role constraint, pass `userRole` to KanbanCard instead of a boolean, and refactor the card component into three view modes (editing, detail, collapsed).

---

## Role Hierarchy & Permissions

Three roles, ordered by capability:

| Capability | READ | COLLABORATOR | ADMIN |
|---|---|---|---|
| View boards they're a member of | Yes | Yes | Yes (all boards) |
| View collapsed cards | Yes | Yes | Yes |
| Click to open card detail view | Yes | Yes | Yes |
| View comments, checklist, activity | Yes | Yes | Yes |
| Post/delete own comments | No | Yes | Yes |
| @mention in comments | No | Yes | Yes |
| Edit cards, assignees, members, labels | No | No | Yes |
| Create/delete/move cards & columns | No | No | Yes |
| Manage boards, users, board members | No | No | Yes |

Card detail view has three modes:
- **ADMIN**: Full edit panel (current behavior)
- **COLLABORATOR**: Read-only card details + interactive comment section
- **READ**: Fully read-only detail view (view everything, edit nothing)

## Database & Backend

Migration updates the role constraint:
```sql
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('READ', 'COLLABORATOR', 'ADMIN'));
```

No route changes needed:
- `requireAdmin` routes stay ADMIN-only (cards, columns, boards, labels, etc.)
- `authenticate` routes stay open to all roles (viewing boards, comments, activity, notifications)

## Frontend Changes

**Types:** Update `User` and `BoardMember` role unions to include `'COLLABORATOR'`.

**KanbanBoard:** Pass `userRole` to KanbanCard instead of `canWrite` boolean. Board-level `isAdmin` checks for columns, dragging, etc. stay unchanged.

**KanbanCard:** Refactor from two modes to three:

1. **Editing** (ADMIN) — full edit panel with save/cancel (current behavior)
2. **Detail view** (COLLABORATOR and READ) — read-only view of title, description, labels, members, assignees, due date, checklist, activity, comments. COLLABORATOR gets comment input; READ does not.
3. **Collapsed** (all roles) — card face, clickable for everyone

Detail view reuses existing section rendering (checklist, comments, activity) but strips edit controls. Uses fullscreen portal on mobile, inline expanded on desktop. Click-outside-to-close works the same.
