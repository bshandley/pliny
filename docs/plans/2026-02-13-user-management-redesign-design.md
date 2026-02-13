# User Management Redesign

## Problem

The User Management screen has oversized, visually loud Edit/Delete buttons on mobile. The edit form (modal on desktop, fullscreen portal on mobile) doesn't integrate with URL routing, so the back button doesn't navigate properly. There are no sub-routes — everything lives under `/admin`.

## Design

### URL Routing

| URL | View |
|-----|------|
| `/admin` | User list |
| `/admin/new` | Create user form |
| `/admin/bradley` | Edit user "bradley" |

App.tsx routing expands to parse `/admin/*` sub-routes. `resolveUrlRoute` handles restoring state on page load. Browser back/forward works naturally via `pushState`.

### User List

- **Rows are clickable** — navigates to `/admin/username`
- **Kebab menu (⋮)** on the right of each row with "Delete" option
- **No Edit/Delete buttons** — removed entirely
- **Desktop**: Table layout. Actions column becomes kebab icon. Rows have `cursor: pointer` and hover highlight.
- **Mobile**: Cards show username + role badge + kebab icon. Tap card area to edit. Kebab opens portal dropdown with "Delete".
- **Can't delete yourself** — kebab hidden for current user's row
- **+ New User** button navigates to `/admin/new`

### Edit/Create User Page

A single dedicated page (not a modal) for both desktop and mobile.

- **Header**: Back arrow (←) + title ("Edit bradley" or "New User") + Save/Create button
- **Back button**: Navigates to `/admin`
- **Body**: Username, password (optional on edit), role dropdown
- **Desktop**: Centered with `max-width: 480px`
- **Mobile**: Full-width
- **No delete on edit page** — delete only via kebab on the list

### What Changes

1. **App.tsx**: Expand routing for `/admin`, `/admin/new`, `/admin/username`. Pass sub-route state to UserManagement.
2. **UserManagement.tsx**: Refactor from modals to list view + edit/create page view, switched by route state. Add kebab menu per row. Make rows clickable. Remove modal/portal rendering.
3. **index.css**: Remove fullscreen form portal styles. Remove chunky mobile button overrides. Add clickable row styles, kebab on user rows, centered form page for desktop.

### What Stays

- Form fields (username, password, role dropdown)
- Role badges
- Confirmation dialog for delete
- Header pattern (back arrow + title + action)

### What Gets Deleted

- `renderMobileForm()` and `renderDesktopModal()` — replaced by single page view
- Edit/Delete buttons on user rows
- Mobile-specific actions-cell CSS overrides
