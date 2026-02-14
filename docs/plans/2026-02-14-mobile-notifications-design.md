# Mobile Notifications Design

## Problem

The notification bell lives in a floating FAB cluster (bottom-right). On mobile Android, the bottom sheet dropdown flashes and immediately closes — the click-outside handler fires on the same touch event. The bottom-right position also feels wrong for mobile.

## Design

### Behavior Change

On mobile, the notification bell moves from the FAB cluster into the page header. Tapping it navigates to a full-screen notification page (same pattern as user management). Desktop is unchanged — bell stays in FAB, dropdown opens as before.

### Mobile: Bell in Header

- Board list page: bell icon added to header area
- Board page (KanbanBoard): bell icon added to header-actions
- Hidden from `.global-actions` on mobile via CSS (`display: none`)
- Badge (unread count) renders the same way

### Mobile: Full-Screen Notification Page

- New page type `notifications` in App.tsx routing
- Header: back arrow + "Notifications" title + "Mark all read" button
- Scrollable list of notification items (reuses existing notification-item styling)
- Tapping a notification marks it read and navigates to the board
- Back button returns to previous page
- No URL routing needed — this is a transient page like modals

### Desktop: Unchanged

- Bell stays in `.global-actions` FAB cluster (bottom-right)
- Dropdown opens on click as it does now
- No changes to desktop behavior

### Component Changes

**NotificationBell.tsx:**
- Accept `isMobile` prop
- When mobile: clicking bell calls a navigation callback instead of toggling dropdown
- When desktop: existing dropdown behavior unchanged

**App.tsx:**
- Add `notifications` to Page type
- Add notification page rendering with back navigation
- Pass notification state/socket down to the notification page

**New: NotificationPage component (or inline in App.tsx):**
- Full-screen list with header
- Reuses notification data from NotificationBell's socket listener
- Mark read + navigate on tap

### Files

**Modified:**
- `client/src/App.tsx` — page type, header bell on mobile, notification page
- `client/src/components/NotificationBell.tsx` — isMobile prop, conditional behavior
- `client/src/index.css` — hide bell from FAB on mobile, notification page styles

**Possibly new:**
- `client/src/components/NotificationPage.tsx` — if extracted (vs inline in App)
