# User Management Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the modal-based User Management edit/create flow with URL-routed pages, remove loud buttons in favor of clickable rows + kebab delete, and unify desktop/mobile rendering.

**Architecture:** UserManagement receives a `subRoute` prop from App.tsx indicating which view to show: list (`null`), create (`"new"`), or edit (`username string`). App.tsx parses `/admin/*` paths and passes the sub-route down. No modals or portals — edit/create are inline page views.

**Tech Stack:** React, TypeScript, existing CSS variables and patterns.

---

### Task 1: Expand App.tsx routing for /admin sub-routes

**Files:**
- Modify: `client/src/App.tsx:11` (Page type)
- Modify: `client/src/App.tsx:27-53` (state + navigateTo)
- Modify: `client/src/App.tsx:56-79` (resolveUrlRoute)
- Modify: `client/src/App.tsx:99-123` (popstate handler)
- Modify: `client/src/App.tsx:181-183` (handleGoToUsers)
- Modify: `client/src/App.tsx:233-243` (UserManagement render)

**Step 1: Add adminSubRoute state and update navigateTo**

Add `adminSubRoute` state (`string | null`). Update `navigateTo` to accept an optional `adminSubRoute` param. When `newPage === 'users'`:
- `null` → path `/admin`
- `"new"` → path `/admin/new`
- any other string → path `/admin/{username}`

```tsx
const [adminSubRoute, setAdminSubRoute] = useState<string | null>(null);

const navigateTo = useCallback((newPage: Page, boardId?: string | null, boardName?: string, adminSub?: string | null) => {
  setPage(newPage);
  setCurrentBoardId(boardId ?? null);
  setAdminSubRoute(newPage === 'users' ? (adminSub ?? null) : null);

  let path = '/';
  if (newPage === 'users') {
    path = adminSub ? `/admin/${adminSub}` : '/admin';
  } else if (newPage === 'board' && boardName) {
    path = '/' + slugify(boardName);
  }

  if (window.location.pathname !== path) {
    window.history.pushState({ page: newPage, boardId, boardName, adminSub }, '', path);
  }
}, []);
```

**Step 2: Update resolveUrlRoute to parse /admin/* sub-routes**

Replace the `if (slug === 'admin')` block with parsing that handles `/admin`, `/admin/new`, and `/admin/{username}`:

```tsx
if (slug === 'admin' || slug.startsWith('admin/')) {
  if (authenticatedUser.role === 'ADMIN') {
    setPage('users');
    const sub = slug === 'admin' ? null : slug.substring('admin/'.length);
    setAdminSubRoute(sub || null);
  }
  return;
}
```

**Step 3: Update popstate handler for admin sub-routes**

In the `handlePopState` callback, restore `adminSubRoute` from `state.adminSub`, and in the no-state fallback parse the URL the same way:

```tsx
const handlePopState = (e: PopStateEvent) => {
  const state = e.state;
  if (state) {
    setPage(state.page || 'boards');
    setCurrentBoardId(state.boardId || null);
    setAdminSubRoute(state.page === 'users' ? (state.adminSub ?? null) : null);
  } else {
    const slug = getPathSlug();
    if (!slug) {
      setPage('boards');
      setCurrentBoardId(null);
      setAdminSubRoute(null);
    } else if (slug === 'admin' || slug.startsWith('admin/')) {
      setPage('users');
      setCurrentBoardId(null);
      const sub = slug === 'admin' ? null : slug.substring('admin/'.length);
      setAdminSubRoute(sub || null);
    }
  }
};
```

**Step 4: Pass navigateTo and adminSubRoute to UserManagement**

Update the render block and add a navigation helper:

```tsx
const handleAdminNavigate = (sub: string | null) => {
  navigateTo('users', null, undefined, sub);
};

// In the render:
<UserManagement
  onBack={handleBackToBoards}
  onLogout={handleLogout}
  currentUser={user}
  subRoute={adminSubRoute}
  onNavigate={handleAdminNavigate}
/>
```

**Step 5: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: Expand App.tsx routing for /admin sub-routes"
```

---

### Task 2: Refactor UserManagement — list view with clickable rows and kebab

**Files:**
- Modify: `client/src/components/UserManagement.tsx`

**Step 1: Update props interface and component signature**

Add `subRoute` and `onNavigate` props. Remove `createPortal` import and `useIsMobile` import (no longer needed):

```tsx
interface UserManagementProps {
  onBack: () => void;
  onLogout: () => void;
  currentUser: User;
  subRoute: string | null;
  onNavigate: (sub: string | null) => void;
}
```

**Step 2: Remove modal/portal state and methods**

Remove: `showCreateModal`, `editingUser` state variables, `openEditModal`, `openCreateModal`, `renderMobileForm`, `renderDesktopModal`.

The `subRoute` prop now drives which view to show:
- `null` → user list
- `"new"` → create form
- `username` → edit form (look up user from `users` array)

**Step 3: Build the user list view with clickable rows and kebab**

Add kebab state (`openMenuId`, `menuRef`) following the BoardList.tsx pattern. Add click-outside handler for kebab.

Each table row:
- `onClick` → `onNavigate(user.username)` (navigates to edit page)
- `cursor: pointer` via new CSS class `user-row-clickable`
- Actions column: kebab button (stops propagation) with dropdown containing only "Delete"
- Kebab hidden for `currentUser.id === user.id`

```tsx
const [openMenuId, setOpenMenuId] = useState<string | null>(null);
const menuRef = useRef<HTMLDivElement>(null);

// Close kebab on outside click
useEffect(() => {
  if (!openMenuId) return;
  const handleClick = (e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      setOpenMenuId(null);
    }
  };
  document.addEventListener('mousedown', handleClick);
  return () => document.removeEventListener('mousedown', handleClick);
}, [openMenuId]);
```

Table row:
```tsx
<tr
  key={user.id}
  className="user-row-clickable"
  onClick={() => onNavigate(user.username)}
>
  <td className="user-name-cell">{user.username}</td>
  <td className="user-role-cell">
    <span className={`role-badge role-${user.role.toLowerCase()}`}>{user.role}</span>
  </td>
  <td className="user-created-cell">
    {user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}
  </td>
  <td className="actions-cell">
    {user.id !== currentUser.id && (
      <div className="user-kebab" ref={openMenuId === user.id ? menuRef : undefined}>
        <button
          className="btn-kebab"
          onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === user.id ? null : user.id); }}
          title="User actions"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
          </svg>
        </button>
        {openMenuId === user.id && (
          <div className="kebab-dropdown">
            <button className="kebab-danger" onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleDelete(user); }}>Delete</button>
          </div>
        )}
      </div>
    )}
  </td>
</tr>
```

Header "Actions" th → empty `<th>` (or thin width).

`+ New User` button calls `onNavigate('new')` instead of opening a modal.

**Step 4: Commit**

```bash
git add client/src/components/UserManagement.tsx
git commit -m "feat: Refactor user list with clickable rows and kebab delete"
```

---

### Task 3: Build the edit/create user page view

**Files:**
- Modify: `client/src/components/UserManagement.tsx`

**Step 1: Add form state initialization from subRoute**

When `subRoute` is `"new"` or a username, initialize form state. Use a `useEffect` keyed on `subRoute` and `users`:

```tsx
const [formData, setFormData] = useState({ username: '', password: '', role: 'READ' as 'READ' | 'COLLABORATOR' | 'ADMIN' });
const [error, setError] = useState('');

const editingUser = subRoute && subRoute !== 'new'
  ? users.find(u => u.username === subRoute) ?? null
  : null;

useEffect(() => {
  if (subRoute === 'new') {
    setFormData({ username: '', password: '', role: 'READ' });
    setError('');
  } else if (editingUser) {
    setFormData({ username: editingUser.username, password: '', role: editingUser.role });
    setError('');
  }
}, [subRoute, editingUser?.id]);
```

**Step 2: Update handleCreate to navigate back on success**

```tsx
const handleCreate = async (e: React.FormEvent) => {
  e.preventDefault();
  setError('');
  try {
    await api.register(formData.username, formData.password, formData.role);
    await loadUsers();
    onNavigate(null); // back to list
  } catch (err: any) {
    setError(err.message || 'Failed to create user');
  }
};
```

**Step 3: Update handleUpdate to navigate back on success**

If username changed, navigate back to list (since the slug changed). Otherwise navigate back:

```tsx
const handleUpdate = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!editingUser) return;
  setError('');
  try {
    const updates: { username?: string; password?: string; role?: 'READ' | 'COLLABORATOR' | 'ADMIN' } = {};
    if (formData.username && formData.username !== editingUser.username) updates.username = formData.username;
    if (formData.password) updates.password = formData.password;
    if (formData.role !== editingUser.role) updates.role = formData.role;

    if (Object.keys(updates).length === 0) {
      onNavigate(null);
      return;
    }

    await api.updateUser(editingUser.id, updates);
    await loadUsers();
    onNavigate(null); // back to list
  } catch (err: any) {
    setError(err.message || 'Failed to update user');
  }
};
```

**Step 4: Render the form page**

Add a `renderFormPage` function that renders a unified page for both create and edit:

```tsx
const renderFormPage = () => {
  const isCreate = subRoute === 'new';
  const title = isCreate ? 'New User' : `Edit ${editingUser?.username}`;
  const onSubmit = isCreate ? handleCreate : handleUpdate;
  const submitLabel = isCreate ? 'Create' : 'Save';

  if (!isCreate && !editingUser) {
    // User not found — redirect back to list
    onNavigate(null);
    return null;
  }

  return (
    <div className="board-list-container">
      <header className="board-list-header">
        <div className="header-left">
          <button onClick={() => onNavigate(null)} className="btn-icon">←</button>
          <h1>{title}</h1>
        </div>
        <div className="header-actions">
          <button type="submit" form="user-form" className="btn-primary btn-sm">{submitLabel}</button>
        </div>
      </header>
      <div className="user-form-page">
        <form id="user-form" onSubmit={onSubmit}>
          {renderFormFields(isCreate ? 'create' : 'edit')}
        </form>
      </div>
    </div>
  );
};
```

**Step 5: Switch on subRoute in the main return**

```tsx
if (subRoute) {
  return renderFormPage();
}

return (
  // ... existing list view
);
```

**Step 6: Commit**

```bash
git add client/src/components/UserManagement.tsx
git commit -m "feat: Add edit/create user page view with URL routing"
```

---

### Task 4: Update CSS — remove old styles, add new styles

**Files:**
- Modify: `client/src/index.css`

**Step 1: Add clickable row and user-kebab styles**

After the existing `.actions-cell` rule (line ~1775), add:

```css
.user-row-clickable {
  cursor: pointer;
}

.user-row-clickable:hover {
  background: var(--bg);
}

.user-kebab {
  position: relative;
}

.user-kebab .btn-kebab {
  opacity: 0.5;
}

.user-row-clickable:hover .btn-kebab {
  opacity: 1;
}
```

**Step 2: Add user-form-page styles**

Replace the `.user-form-fullscreen` block (lines 1779–1826) with:

```css
/* ---- User Form Page ---- */

.user-form-page {
  max-width: 480px;
  margin: 0 auto;
  padding: 1.5rem 1rem;
}

.user-form-page .form-group {
  margin-bottom: 1.25rem;
}
```

**Step 3: Remove old mobile overrides**

In the `@media (max-width: 600px)` block, remove:
- `.actions-cell` width/margin override (line ~2977-2981)
- `.actions-cell .btn-sm` min-height/padding override (line ~2983-2986)

These were the "chunky button" styles. The kebab replaces them.

**Step 4: Add mobile kebab always-visible override**

In the mobile media query, add the user-kebab btn to the existing always-visible rule:

```css
.btn-kebab,
.btn-column-kebab,
.user-kebab .btn-kebab,
.btn-delete {
  opacity: 1;
}
```

**Step 5: Clean up Actions column on desktop**

The Actions `<th>` is now just a narrow kebab column. Add:

```css
.users-table .actions-cell {
  width: 3rem;
  text-align: center;
}
```

**Step 6: Commit**

```bash
git add client/src/index.css
git commit -m "style: Update CSS for user management redesign"
```

---

### Task 5: Manual testing checklist

**No code changes — just verification.**

**Step 1: Start dev server**

```bash
cd /home/bradley/cork && docker compose up -d --build
```

Or if running locally:
```bash
cd client && npm run dev
```

**Step 2: Test user list**

- Navigate to `/admin` — see user list with clickable rows
- Click a user row → navigates to `/admin/{username}`, shows edit form
- Browser back → returns to `/admin`
- Kebab (⋮) appears on non-self rows, clicking shows "Delete" dropdown
- Kebab click does NOT navigate to edit (stopPropagation)
- Delete triggers confirmation dialog
- `+ New User` → navigates to `/admin/new`
- Current user row has no kebab

**Step 3: Test edit/create form page**

- `/admin/new` shows create form with empty fields, "Create" button in header
- ← back button returns to `/admin`
- Fill form and submit → user created, returns to list
- `/admin/{username}` shows edit form pre-filled, "Save" button in header
- Edit username and save → returns to list, username updated
- Leave password blank → password unchanged
- Can't change own role (dropdown disabled)

**Step 4: Test URL routing**

- Direct navigation to `/admin/new` (page refresh) → shows create form
- Direct navigation to `/admin/bradley` → shows edit form for "bradley"
- Direct navigation to `/admin/nonexistent` → redirects to `/admin`
- Browser back/forward through `/admin` ↔ `/admin/username` works

**Step 5: Test mobile**

- All of the above on a narrow viewport
- Form is full-width, touch-friendly inputs
- Kebab dropdown doesn't get clipped

**Step 6: Final commit (squash if needed)**

If any fixes were made during testing, commit them. Consider squashing into clean commits.
