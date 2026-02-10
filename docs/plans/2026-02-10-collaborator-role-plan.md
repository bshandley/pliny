# Collaborator Role & Card Detail View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a COLLABORATOR role that can comment on cards with full @mention support, and give all non-admin users a read-only card detail view when clicking cards.

**Architecture:** Database migration adds the new role value, types are updated across client/server, KanbanCard is refactored from two modes (editing/collapsed) to three (editing/detail/collapsed), and KanbanBoard passes `userRole` instead of a boolean.

**Tech Stack:** PostgreSQL, Express/TypeScript, React/TypeScript

---

### Task 1: Database Migration

**Files:**
- Create: `server/src/migrations/007-collaborator-role.sql`
- Modify: `server/src/migrations/run.ts`

**Step 1: Create the migration SQL**

Create `server/src/migrations/007-collaborator-role.sql`:
```sql
-- Migration: Add COLLABORATOR role
-- Idempotent: safe to re-run

DO $$
BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('READ', 'COLLABORATOR', 'ADMIN'));
END $$;
```

**Step 2: Register migration in runner**

In `server/src/migrations/run.ts`, add after the `006` block:

```typescript
    // Add collaborator role
    const collaboratorRole = fs.readFileSync(
      path.join(__dirname, '007-collaborator-role.sql'),
      'utf-8'
    );
    await pool.query(collaboratorRole);
```

**Step 3: Commit**

```bash
git add server/src/migrations/007-collaborator-role.sql server/src/migrations/run.ts
git commit -m "feat: add 007 migration for COLLABORATOR role"
```

---

### Task 2: Update Server Types & Auth

**Files:**
- Modify: `server/src/middleware/auth.ts`
- Modify: `server/src/types.ts`

**Step 1: Update server types**

In `server/src/types.ts`, find the role type definition and add `'COLLABORATOR'` to the union. If using inline types in auth.ts, update there.

In `server/src/middleware/auth.ts`, update the JWT decoded type from `role: 'READ' | 'ADMIN'` to `role: 'READ' | 'COLLABORATOR' | 'ADMIN'`.

**Step 2: Update comment delete authorization**

In `server/src/routes/comments.ts`, the delete route already checks `comment.user_id !== req.user.id && req.user.role !== 'ADMIN'`. This works correctly for COLLABORATOR — they can delete their own comments. No change needed.

**Step 3: Commit**

```bash
git add server/src/middleware/auth.ts server/src/types.ts
git commit -m "feat: update server types for COLLABORATOR role"
```

---

### Task 3: Update Client Types

**Files:**
- Modify: `client/src/types.ts`

**Step 1: Update role unions**

In `client/src/types.ts`, update both `User` and `BoardMember` interfaces:

```typescript
// User interface
role: 'READ' | 'COLLABORATOR' | 'ADMIN';

// BoardMember interface
role: 'READ' | 'COLLABORATOR' | 'ADMIN';
```

**Step 2: Commit**

```bash
git add client/src/types.ts
git commit -m "feat: update client types for COLLABORATOR role"
```

---

### Task 4: Update KanbanBoard to Pass userRole

**Files:**
- Modify: `client/src/components/KanbanBoard.tsx`
- Modify: `client/src/components/KanbanCard.tsx` (props only)

**Step 1: Update KanbanBoardProps**

In `KanbanBoard.tsx`, update the props type:
```typescript
userRole: 'READ' | 'COLLABORATOR' | 'ADMIN';
```

**Step 2: Update KanbanCard props**

In `KanbanCard.tsx`, replace `canWrite: boolean` with `userRole: 'READ' | 'COLLABORATOR' | 'ADMIN'` in the props interface.

**Step 3: Update KanbanBoard card rendering**

In `KanbanBoard.tsx`, change the KanbanCard usage from `canWrite={isAdmin}` to `userRole={userRole}`.

**Step 4: Update KanbanCard to derive canWrite internally**

At the top of the KanbanCard component, add:
```typescript
const canWrite = userRole === 'ADMIN';
const canComment = userRole === 'ADMIN' || userRole === 'COLLABORATOR';
```

This keeps all existing `canWrite` checks working without changes.

**Step 5: Update App.tsx**

In `App.tsx`, update the `userRole` prop type to include `'COLLABORATOR'`:
```typescript
userRole={user?.role || 'READ'}
```
This already works since the role comes from the server, but ensure the type allows it.

**Step 6: Commit**

```bash
git add client/src/components/KanbanBoard.tsx client/src/components/KanbanCard.tsx client/src/App.tsx
git commit -m "feat: pass userRole to KanbanCard instead of canWrite boolean"
```

---

### Task 5: Add Card Detail View Mode

This is the main task. KanbanCard currently has two render paths:
1. `isEditing && canWrite` → edit panel
2. Default → collapsed card face

We add a third: detail view for non-admin users who click a card.

**Files:**
- Modify: `client/src/components/KanbanCard.tsx`

**Step 1: Make cards clickable for all roles**

Change the collapsed card's onClick from:
```typescript
onClick={() => canWrite && onEditStart()}
```
to:
```typescript
onClick={() => onEditStart()}
```

And update the cursor style from:
```typescript
style={{ cursor: canWrite ? 'pointer' : 'default' }}
```
to:
```typescript
style={{ cursor: 'pointer' }}
```

**Step 2: Create renderDetailView function**

Add a new function `renderDetailView()` that shows read-only card content. This renders:

- Card title as an `<h3>` (not an input)
- Labels as static colored badges (reuse existing label rendering from collapsed view, but full label names)
- Members and assignees as static chips (no remove buttons, no input)
- Description as a `<p>` (not a textarea)
- Due date as text (not a date input)
- Checklist section (collapsible, read-only — checkboxes disabled, no add/delete)
- Comments section (collapsible, always show comments list):
  - COLLABORATOR: show comment input with @mention autocomplete
  - READ: no comment input
- Activity section (collapsible, read-only — same as current)
- Close button (×) in the top-right corner

The detail view should load comments, checklist, and activity on open (same as current edit mode).

**Step 3: Update render logic**

Change the main render from:
```typescript
if (isEditing && canWrite) {
  // edit panel
}
// collapsed card
```
to:
```typescript
if (isEditing && canWrite) {
  // edit panel (ADMIN) — unchanged
}
if (isEditing && !canWrite) {
  // detail view (COLLABORATOR and READ)
  if (isMobile) {
    return createPortal(<fullscreen detail view>, document.body);
  }
  return <inline detail view>;
}
// collapsed card (all roles)
```

**Step 4: Update click-outside behavior**

The existing click-outside effect calls `handleSaveRef.current()`. For non-admin users, clicking outside should just close (call `onEditEnd()` directly, not save). Update the effect:

```typescript
useEffect(() => {
  if (!isEditing || isMobile) return;
  const handleClickOutside = (e: MouseEvent) => {
    if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
      if (canWrite) {
        handleSaveRef.current();
      } else {
        onEditEnd();
      }
    }
  };
  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, [isEditing, isMobile, canWrite]);
```

Also attach `cardRef` to the detail view wrapper div.

**Step 5: Commit**

```bash
git add client/src/components/KanbanCard.tsx
git commit -m "feat: add read-only card detail view for COLLABORATOR and READ roles"
```

---

### Task 6: Add Detail View Styles

**Files:**
- Modify: `client/src/index.css`

**Step 1: Add styles for the detail view**

Add CSS for the detail view elements:
- `.card-detail` — container styling similar to `.kanban-card.editing` but without edit affordances
- `.card-detail-title` — styled as a heading, not an input
- `.card-detail-description` — styled as body text
- `.card-detail-field` — label + value pairs for due date, etc.
- `.card-detail-close` — close button positioned top-right
- `.card-detail-chips` — static chip display for members/assignees
- Read-only checklist items (disabled checkbox styling)

Keep styles minimal — reuse existing card styles where possible.

**Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "style: add card detail view styles"
```

---

### Task 7: Update User Management UI for COLLABORATOR Role

**Files:**
- Modify: `client/src/components/UserManagement.tsx` (or wherever admin creates/edits users)

**Step 1: Find and update role selection UI**

The admin user management screen needs to show COLLABORATOR as an option when creating or editing users. Find the role dropdown/select and add the new option.

**Step 2: Commit**

```bash
git add client/src/components/UserManagement.tsx
git commit -m "feat: add COLLABORATOR option to user management UI"
```

---

### Task 8: Verify TypeScript Compilation & Test

**Step 1: Compile both projects**

```bash
cd server && npx tsc --noEmit
cd ../client && npx tsc --noEmit
```

Fix any type errors.

**Step 2: Manual verification checklist**

- ADMIN: Can click card → edit panel (unchanged)
- COLLABORATOR: Can click card → detail view with comment input + @mentions
- READ: Can click card → detail view without comment input
- All roles: Click outside closes detail/edit view
- All roles: Mobile opens fullscreen portal
- Comment @mentions work for COLLABORATOR
- COLLABORATOR can delete own comments
- Admin can create users with COLLABORATOR role

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve type errors and polish"
```
