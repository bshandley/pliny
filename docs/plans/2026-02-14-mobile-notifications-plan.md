# Mobile Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix broken mobile notifications by moving the bell to the header and opening a full-screen notification page on mobile instead of the broken dropdown.

**Architecture:** Lift notification state (notifications array, socket listener, load/mark-read functions) from NotificationBell into App.tsx so it can be shared between the desktop dropdown (NotificationBell) and the new mobile notification page. Add `notifications` as a new Page type. On mobile, the bell in the header navigates to the notification page. Desktop behavior is unchanged.

**Tech Stack:** React, TypeScript, Socket.IO (existing), existing notification API endpoints.

---

### Task 1: Lift notification state from NotificationBell into App.tsx

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/NotificationBell.tsx`

The notification state (notifications array, socket listener, load/mark-read) currently lives inside NotificationBell. We need it in App.tsx so both the desktop dropdown and the mobile page can share it.

**Step 1: Add notification state and logic to App.tsx**

In `client/src/App.tsx`, add notification imports and state after line 4:

```tsx
import { User, Notification } from './types';
```

Add state after `notifSocket` (after line 34):
```tsx
const [notifications, setNotifications] = useState<Notification[]>([]);
```

Add notification load function after the `resolveUrlRoute` callback (after line 93):
```tsx
const loadNotifications = useCallback(async () => {
  try {
    const data = await api.getNotifications();
    setNotifications(data);
  } catch (err) {
    console.error('Failed to load notifications:', err);
  }
}, []);
```

Add a useEffect to load notifications and listen for new ones after the notifSocket effect (after line 154):
```tsx
useEffect(() => {
  if (!user) return;
  loadNotifications();
}, [user, loadNotifications]);

useEffect(() => {
  if (!notifSocket) return;
  const handler = (notif: Notification) => {
    setNotifications(prev => [notif, ...prev].slice(0, 50));
  };
  notifSocket.on('notification:new', handler);
  return () => { notifSocket.off('notification:new', handler); };
}, [notifSocket]);
```

Add mark-read handlers after `handleViewChange` (after line 216):
```tsx
const handleMarkNotificationRead = async (id: string) => {
  try {
    await api.markNotificationRead(id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  } catch (err) {
    console.error('Failed to mark notification read:', err);
  }
};

const handleMarkAllNotificationsRead = async () => {
  try {
    await api.markAllNotificationsRead();
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  } catch (err) {
    console.error('Failed to mark all read:', err);
  }
};
```

**Step 2: Update NotificationBell to receive state via props**

Replace NotificationBell's props interface and remove its internal state management. The component should now just render the dropdown using data passed via props:

```tsx
interface NotificationBellProps {
  notifications: Notification[];
  onMarkRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onNavigateToBoard: (boardId: string) => void;
}

export default function NotificationBell({ notifications, onMarkRead, onMarkAllRead, onNavigateToBoard }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
```

Remove:
- The `socket` prop
- The `loadNotifications` function and its `useEffect`
- The socket listener `useEffect`
- The `handleMarkAllRead` function (use `onMarkAllRead` prop instead)
- The internal `notifications` state

Keep:
- The `open` state and dropdown ref
- The click-outside useEffect
- The `timeAgo` helper function
- The `unreadCount` calculation
- The `handleClick` function (but use `onMarkRead` instead of `api.markNotificationRead`)
- The `getNotificationText` function
- The JSX rendering

Update `handleClick`:
```tsx
const handleClick = async (notif: Notification) => {
  if (!notif.read) {
    await onMarkRead(notif.id);
  }
  setOpen(false);
  onNavigateToBoard(notif.board_id);
};
```

Update "Mark all read" button to use `onMarkAllRead`:
```tsx
<button onClick={onMarkAllRead} className="notification-mark-all">
```

Remove the `Socket` import since it's no longer needed.

**Step 3: Update App.tsx to pass new props to NotificationBell**

Update the NotificationBell usage in ThemeToggle (line 230):

```tsx
{user && (
  <NotificationBell
    notifications={notifications}
    onMarkRead={handleMarkNotificationRead}
    onMarkAllRead={handleMarkAllNotificationsRead}
    onNavigateToBoard={handleNavigateToBoard}
  />
)}
```

Note: No longer need `notifSocket` check since NotificationBell doesn't use the socket directly.

**Step 4: Commit**

```bash
git add client/src/App.tsx client/src/components/NotificationBell.tsx
git commit -m "refactor: Lift notification state from NotificationBell into App"
```

---

### Task 2: Add notification page and mobile bell in header

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/BoardList.tsx`
- Modify: `client/src/components/KanbanBoard.tsx`
- Modify: `client/src/index.css`

**Step 1: Add `notifications` page type to App.tsx**

Update the Page type (line 11):
```tsx
type Page = 'boards' | 'users' | 'board' | 'notifications';
```

Add a state to track where to return to when leaving notifications:
```tsx
const [prevPage, setPrevPage] = useState<{ page: Page; boardId: string | null; viewMode: 'board' | 'calendar' }>({ page: 'boards', boardId: null, viewMode: 'board' });
```

Add a handler for navigating to the notification page (after the mark-all-read handler):
```tsx
const handleGoToNotifications = () => {
  setPrevPage({ page, boardId: currentBoardId, viewMode: boardViewMode });
  setPage('notifications');
};

const handleBackFromNotifications = () => {
  setPage(prevPage.page);
  setCurrentBoardId(prevPage.boardId);
  setBoardViewMode(prevPage.viewMode);
};

const handleNotificationClick = async (notif: Notification) => {
  await handleMarkNotificationRead(notif.id);
  handleNavigateToBoard(notif.board_id);
};
```

**Step 2: Render notification page in App.tsx**

Add a new page render block before the board list return (before line 283). The notification page is a simple full-screen list:

```tsx
if (page === 'notifications') {
  const unreadCount = notifications.filter(n => !n.read).length;
  return (
    <>
      <div className="notification-page">
        <header className="notification-page-header">
          <button onClick={handleBackFromNotifications} className="btn-icon">←</button>
          <h1>Notifications</h1>
          {unreadCount > 0 && (
            <button onClick={handleMarkAllNotificationsRead} className="notification-mark-all">Mark all read</button>
          )}
        </header>
        <div className="notification-page-list">
          {notifications.length === 0 ? (
            <div className="notification-empty">No notifications yet</div>
          ) : (
            notifications.map(notif => {
              const cardTitle = notif.detail?.card_title || 'a card';
              const action = notif.type === 'mention_card' ? 'added you to' : 'mentioned you on';
              return (
                <button
                  key={notif.id}
                  className={`notification-item${!notif.read ? ' unread' : ''}`}
                  onClick={() => handleNotificationClick(notif)}
                >
                  <div className="notification-content">
                    <span className="notification-text">
                      <strong>{notif.actor_username}</strong> {action} <strong>{cardTitle}</strong>
                      {notif.board_name && <span className="notification-board"> in {notif.board_name}</span>}
                    </span>
                    <span className="notification-time">{timeAgo(notif.created_at)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
      <ThemeToggle />
    </>
  );
}
```

Move the `timeAgo` function from NotificationBell.tsx into a shared location. The simplest approach: copy it into App.tsx as a module-level function (before the `App` function). Then remove it from NotificationBell.tsx and import it, OR just duplicate it since it's a tiny helper. Alternatively, export it from NotificationBell. Use the simplest approach: move it to App.tsx and export it from there, then import in NotificationBell.

Actually, the simplest approach: keep `timeAgo` in NotificationBell.tsx (it's still used there for the desktop dropdown), and duplicate it in App.tsx for the notification page. It's 8 lines. Or better: extract to a tiny utility. But YAGNI — just duplicate the 8-line function in App.tsx for now.

**Step 3: Add bell icon to BoardList header for mobile**

Update `BoardList.tsx` props to accept notification data:

```tsx
interface BoardListProps {
  onSelectBoard: (id: string, name: string) => void;
  onLogout: () => void;
  onGoToUsers: () => void;
  user: User | null;
  notificationCount?: number;
  onGoToNotifications?: () => void;
}
```

Add destructuring:
```tsx
export default function BoardList({ onSelectBoard, onLogout, onGoToUsers, user, notificationCount = 0, onGoToNotifications }: BoardListProps) {
```

Add a bell button in the header-actions div (line 129), before the Users button:
```tsx
<div className="header-actions">
  {onGoToNotifications && (
    <button onClick={onGoToNotifications} className="btn-icon header-bell mobile-only" aria-label="Notifications">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
      {notificationCount > 0 && <span className="notification-badge">{notificationCount > 9 ? '9+' : notificationCount}</span>}
    </button>
  )}
  {isAdmin && (
```

Pass the new props from App.tsx:
```tsx
<BoardList
  onSelectBoard={handleSelectBoard}
  onLogout={handleLogout}
  onGoToUsers={handleGoToUsers}
  user={user}
  notificationCount={notifications.filter(n => !n.read).length}
  onGoToNotifications={handleGoToNotifications}
/>
```

**Step 4: Add bell icon to KanbanBoard header for mobile**

Update `KanbanBoardProps`:
```tsx
interface KanbanBoardProps {
  boardId: string;
  onBack: () => void;
  onLogout: () => void;
  userRole: 'READ' | 'COLLABORATOR' | 'ADMIN';
  viewMode: 'board' | 'calendar';
  onViewChange: (mode: 'board' | 'calendar') => void;
  notificationCount?: number;
  onGoToNotifications?: () => void;
}
```

Add destructuring:
```tsx
export default function KanbanBoard({ boardId, onBack, onLogout, userRole, viewMode, onViewChange, notificationCount = 0, onGoToNotifications }: KanbanBoardProps) {
```

Add bell button in header-actions (after the view toggle div, before the mobile filter button, around line 513):
```tsx
{onGoToNotifications && (
  <button onClick={onGoToNotifications} className="btn-icon header-bell mobile-only" aria-label="Notifications">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
    {notificationCount > 0 && <span className="notification-badge">{notificationCount > 9 ? '9+' : notificationCount}</span>}
  </button>
)}
```

Pass the new props from App.tsx:
```tsx
<KanbanBoard
  boardId={currentBoardId}
  onBack={handleBackToBoards}
  onLogout={handleLogout}
  userRole={user?.role || 'READ'}
  viewMode={boardViewMode}
  onViewChange={handleViewChange}
  notificationCount={notifications.filter(n => !n.read).length}
  onGoToNotifications={handleGoToNotifications}
/>
```

**Step 5: Add CSS**

Add notification page styles to `client/src/index.css`:

```css
/* ---- Notification Page ---- */

.notification-page {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.notification-page-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border);
}

.notification-page-header h1 {
  font-family: var(--font-display);
  font-size: 1.1rem;
  margin: 0;
  flex: 1;
}

.notification-page-list {
  flex: 1;
  overflow-y: auto;
}
```

Add header bell styling:
```css
.header-bell {
  position: relative;
}
```

Hide the bell in `.global-actions` on mobile and hide header bells on desktop. Add inside `@media (max-width: 768px)`:
```css
  .global-actions .notification-bell {
    display: none;
  }
```

The `.mobile-only` class already exists and handles showing header bells only on mobile (it's `display: none` on desktop, shown on mobile).

**Step 6: Commit**

```bash
git add client/src/App.tsx client/src/components/BoardList.tsx client/src/components/KanbanBoard.tsx client/src/index.css
git commit -m "feat: Add mobile notification page with bell in header"
```

---

### Task 3: Manual testing checklist

**No code changes — verification only.**

**Desktop (should be unchanged):**
- Bell icon visible in bottom-right FAB cluster
- Clicking bell opens dropdown with notification list
- Clicking a notification marks it read and navigates to board
- "Mark all read" works
- No bell visible in page headers

**Mobile (new behavior):**
- Bell icon visible in board list header and board header
- Badge shows unread count
- Bell NOT visible in bottom-right FAB cluster
- Tapping bell navigates to full-screen notification page
- Notification page shows header with back arrow, title, "Mark all read"
- Tapping a notification marks it read and navigates to the board
- Back button returns to previous page (board list or board)
- No flash/disappear behavior

**Edge cases:**
- Navigate to notifications from board list, tap notification → goes to board
- Navigate to notifications from board, tap back → returns to board
- Real-time: new notification arrives while on notification page → appears in list
- Empty state: "No notifications yet" shown when list is empty
