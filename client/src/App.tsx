import { useState, useEffect, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { io, Socket } from 'socket.io-client';
import { api } from './api';
import { User, Notification } from './types';
import AppBarContext from './contexts/AppBarContext';
import Login from './components/Login';
import BoardList from './components/BoardList';
import KanbanBoard from './components/KanbanBoard';
import UserManagement from './components/UserManagement';
import ProfileSettings from './components/ProfileSettings';
import AppBar from './components/AppBar';

type Page = 'boards' | 'users' | 'board' | 'notifications' | 'profile';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function getPathSlug(): string {
  return window.location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [currentBoardId, setCurrentBoardId] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('boards');
  const [adminSubRoute, setAdminSubRoute] = useState<string | null>(null);
  const [boardViewMode, setBoardViewMode] = useState<'board' | 'calendar' | 'table' | 'timeline'>('board');
  const [prevPage, setPrevPage] = useState<{ page: Page; boardId: string | null; viewMode: 'board' | 'calendar' | 'table' | 'timeline' }>({ page: 'boards', boardId: null, viewMode: 'board' });
  const [loading, setLoading] = useState(true);
  const [notifSocket, setNotifSocket] = useState<Socket | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [initialCardId, setInitialCardId] = useState<string | null>(null);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [sso2faTicket, setSso2faTicket] = useState<string | null>(null);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    return (saved as 'light' | 'dark') || 'light';
  });

  const navigateTo = useCallback((newPage: Page, boardId?: string | null, boardName?: string, adminSub?: string | null, viewMode?: 'board' | 'calendar' | 'table' | 'timeline') => {
    setPage(newPage);
    setCurrentBoardId(boardId ?? null);
    setAdminSubRoute(newPage === 'users' ? (adminSub ?? null) : null);
    setBoardViewMode(newPage === 'board' ? (viewMode ?? 'board') : 'board');

    let path = '/';
    if (newPage === 'users') {
      path = adminSub ? `/admin/${adminSub}` : '/admin';
    } else if (newPage === 'board' && boardName) {
      const suffix = viewMode && viewMode !== 'board' ? '/' + viewMode : '';
      path = '/' + slugify(boardName) + suffix;
    }

    if (window.location.pathname !== path) {
      window.history.pushState({ page: newPage, boardId, boardName, adminSub, viewMode }, '', path);
    }
  }, []);

  // Resolve URL path to page state after auth
  const resolveUrlRoute = useCallback(async (authenticatedUser: User) => {
    const slug = getPathSlug();

    if (!slug) return; // root → board list (default)

    if (slug === 'admin' || slug.startsWith('admin/')) {
      if (authenticatedUser.role === 'ADMIN') {
        setPage('users');
        const sub = slug === 'admin' ? null : slug.substring('admin/'.length);
        setAdminSubRoute(sub || null);
      }
      return;
    }

    if (slug === 'profile') {
      setPage('profile');
      return;
    }

    // Try to match slug to a board name (with optional /calendar or /table suffix)
    let boardSlug = slug;
    let resolvedViewMode: 'board' | 'calendar' | 'table' | 'timeline' = 'board';
    if (slug.endsWith('/calendar')) {
      boardSlug = slug.slice(0, -'/calendar'.length);
      resolvedViewMode = 'calendar';
    } else if (slug.endsWith('/table')) {
      boardSlug = slug.slice(0, -'/table'.length);
      resolvedViewMode = 'table';
    } else if (slug.endsWith('/timeline')) {
      boardSlug = slug.slice(0, -'/timeline'.length);
      resolvedViewMode = 'timeline';
    }

    try {
      const boards = await api.getBoards();
      const match = boards.find((b: any) => slugify(b.name) === boardSlug);
      if (match) {
        setCurrentBoardId(match.id);
        setPage('board');
        setBoardViewMode(resolvedViewMode);
      }
    } catch {
      // Couldn't load boards, stay on board list
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const data = await api.getNotifications();
      setNotifications(data);
    } catch (err) {
      console.error('Failed to load notifications:', err);
    }
  }, []);

  useEffect(() => {
    // Check for SSO token in URL fragment (e.g., /#token=xxx or /#sso_error=xxx)
    const hash = window.location.hash.slice(1); // remove leading #
    const hashParams = new URLSearchParams(hash);
    const ssoToken = hashParams.get('token');
    const ssoErrorParam = hashParams.get('sso_error');

    const ssoRequires2fa = hashParams.get('requires_2fa') === 'true';
    const sso2faTicketParam = hashParams.get('ticket');

    if (ssoRequires2fa && sso2faTicketParam) {
      window.history.replaceState(null, '', window.location.pathname);
      setSso2faTicket(sso2faTicketParam);
      setLoading(false);
      return;
    }

    if (ssoToken) {
      window.history.replaceState(null, '', window.location.pathname);
      api.setToken(ssoToken);
      api.me()
        .then(async (userData) => {
          setUser(userData);
          await resolveUrlRoute(userData);
          setLoading(false);
        })
        .catch(() => {
          api.setToken(null);
          setLoading(false);
        });
      return;
    }

    if (ssoErrorParam) {
      setSsoError(ssoErrorParam);
      window.history.replaceState(null, '', window.location.pathname);
    }

    const token = api.getToken();
    if (token) {
      api.me()
        .then(async (userData) => {
          setUser(userData);
          await resolveUrlRoute(userData);
          setLoading(false);
        })
        .catch(() => {
          api.setToken(null);
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, [resolveUrlRoute]);

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const state = e.state;
      if (state) {
        setPage(state.page || 'boards');
        setCurrentBoardId(state.boardId || null);
        setAdminSubRoute(state.page === 'users' ? (state.adminSub ?? null) : null);
        setBoardViewMode(state.page === 'board' ? (state.viewMode ?? 'board') : 'board');
      } else {
        // No state (e.g. initial entry) — resolve from URL
        const slug = getPathSlug();
        if (!slug) {
          setPage('boards');
          setCurrentBoardId(null);
          setAdminSubRoute(null);
        } else if (slug === 'profile') {
          setPage('profile');
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

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Notification socket — connects when user is authenticated
  useEffect(() => {
    if (user) {
      const token = api.getToken();
      const s = io('/', { auth: { token } });
      setNotifSocket(s);
      return () => { s.disconnect(); setNotifSocket(null); };
    } else {
      setNotifSocket(null);
    }
  }, [user]);

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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = async (e?: React.MouseEvent) => {
    // Fallback for browsers without View Transitions API or reduced motion
    if (
      !(document as any).startViewTransition ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setTheme(prev => prev === 'light' ? 'dark' : 'light');
      return;
    }

    // Get circle origin from the clicked button
    let x = window.innerWidth - 24;
    let y = 24;
    if (e?.currentTarget) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    }

    const transition = (document as any).startViewTransition(() => {
      flushSync(() => {
        setTheme(prev => prev === 'light' ? 'dark' : 'light');
      });
    });

    await transition.ready;

    const right = window.innerWidth - x;
    const bottom = window.innerHeight - y;
    const maxRadius = Math.hypot(
      Math.max(x, right),
      Math.max(y, bottom)
    );

    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${maxRadius}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration: 500,
        easing: 'ease-in-out',
        fill: 'forwards',
        pseudoElement: '::view-transition-new(root)',
      }
    );
  };

  const handleLogin = async (username: string, password: string) => {
    const result = await api.login(username, password);
    if (result.requires_2fa) {
      const err: any = new Error('2FA required');
      err.requires_2fa = true;
      err.ticket = result.ticket;
      throw err;
    }
    setUser(result.user);
    await resolveUrlRoute(result.user);
  };

  const handleSsoLogin = async (_token: string) => {
    const userData = await api.me();
    setUser(userData);
    await resolveUrlRoute(userData);
  };

  const handleLogout = () => {
    api.setToken(null);
    setUser(null);
    setCurrentBoardId(null);
    setAdminSubRoute(null);
    setBoardViewMode('board');
    setPage('boards');
    window.history.pushState(null, '', '/');
  };

  const handleSelectBoard = (boardId: string, boardName: string) => {
    navigateTo('board', boardId, boardName);
  };

  const handleBackToBoards = () => {
    navigateTo('boards');
  };

  const handleNavigateToBoard = async (boardId: string, cardId?: string) => {
    try {
      const board = await api.getBoard(boardId);
      setInitialCardId(cardId ?? null);
      navigateTo('board', boardId, board.name);
    } catch {
      // Board may have been deleted
    }
  };

  const handleGoToUsers = () => {
    navigateTo('users');
  };

  const handleAdminNavigate = (sub: string | null) => {
    navigateTo('users', null, undefined, sub);
  };

  const handleViewChange = (viewMode: 'board' | 'calendar' | 'table' | 'timeline') => {
    if (!currentBoardId) return;
    const slug = getPathSlug().replace(/\/(calendar|table|timeline)$/, '');
    const suffix = viewMode === 'board' ? '' : '/' + viewMode;
    const path = '/' + slug + suffix;
    setBoardViewMode(viewMode);
    window.history.pushState({ page: 'board', boardId: currentBoardId, viewMode }, '', path);
  };

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

  const handleGoToProfile = () => {
    setPrevPage({ page, boardId: currentBoardId, viewMode: boardViewMode });
    setPage('profile');
    window.history.pushState({ page: 'profile' }, '', '/profile');
  };

  const handleGoToNotifications = () => {
    setPrevPage({ page, boardId: currentBoardId, viewMode: boardViewMode });
    setPage('notifications');
    window.history.pushState({ page: 'notifications' }, '', window.location.pathname);
  };

  const handleBackFromNotifications = () => {
    setPage(prevPage.page);
    setCurrentBoardId(prevPage.boardId);
    setBoardViewMode(prevPage.viewMode);
  };

  const handleNotificationClick = async (notif: Notification) => {
    await handleMarkNotificationRead(notif.id);
    handleNavigateToBoard(notif.board_id, notif.card_id);
  };

  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

  const appBarContext = useMemo(() => ({
    user,
    notifications,
    unreadCount,
    onMarkRead: handleMarkNotificationRead,
    onMarkAllRead: handleMarkAllNotificationsRead,
    onNavigateToBoard: handleNavigateToBoard,
    onGoToNotifications: handleGoToNotifications,
    theme,
    onToggleTheme: toggleTheme,
    onLogout: handleLogout,
    onGoToProfile: handleGoToProfile,
  }), [user, notifications, unreadCount, theme]);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user && !api.getToken()) {
    return (
      <>
        <Login onLogin={handleLogin} onSsoLogin={handleSsoLogin} ssoError={ssoError} sso2faTicket={sso2faTicket} onSso2faComplete={() => setSso2faTicket(null)} />
        <button
          className="login-theme-toggle"
          onClick={(e) => { toggleTheme(e); }}
          aria-label="Toggle theme"
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {theme === 'light' ? (
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            ) : (
              <><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></>
            )}
          </svg>
        </button>
      </>
    );
  }

  return (
    <AppBarContext.Provider value={appBarContext}>
      {page === 'board' && currentBoardId ? (
        <KanbanBoard
          boardId={currentBoardId}
          onBack={handleBackToBoards}
          userRole={user?.role || 'READ'}
          viewMode={boardViewMode}
          onViewChange={handleViewChange}
          initialCardId={initialCardId}
          onCardOpened={() => setInitialCardId(null)}
        />
      ) : page === 'users' && user?.role === 'ADMIN' ? (
        <UserManagement
          onBack={handleBackToBoards}
          currentUser={user}
          subRoute={adminSubRoute}
          onNavigate={handleAdminNavigate}
        />
      ) : page === 'notifications' ? (
        <div className="notification-page">
          <AppBar title="Notifications" onBack={handleBackFromNotifications}>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllNotificationsRead} className="notification-mark-all">Mark all read</button>
            )}
          </AppBar>
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
      ) : page === 'profile' ? (
        <ProfileSettings
          user={user!}
          onBack={handleBackFromNotifications}
        />
      ) : (
        <BoardList
          onSelectBoard={handleSelectBoard}
          onGoToUsers={handleGoToUsers}
          user={user}
        />
      )}
    </AppBarContext.Provider>
  );
}

export default App;
