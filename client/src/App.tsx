import { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { api } from './api';
import { User } from './types';
import Login from './components/Login';
import BoardList from './components/BoardList';
import KanbanBoard from './components/KanbanBoard';
import UserManagement from './components/UserManagement';
import NotificationBell from './components/NotificationBell';

type Page = 'boards' | 'users' | 'board';

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

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [currentBoardId, setCurrentBoardId] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('boards');
  const [adminSubRoute, setAdminSubRoute] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifSocket, setNotifSocket] = useState<Socket | null>(null);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    return (saved as 'light' | 'dark') || 'light';
  });

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

    // Try to match slug to a board name
    try {
      const boards = await api.getBoards();
      const match = boards.find((b: any) => slugify(b.name) === slug);
      if (match) {
        setCurrentBoardId(match.id);
        setPage('board');
      }
    } catch {
      // Couldn't load boards, stay on board list
    }
  }, []);

  useEffect(() => {
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
      } else {
        // No state (e.g. initial entry) — resolve from URL
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
        // For board slugs without state, we'd need to re-resolve,
        // but popstate with no state is rare after initial navigation
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
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const handleLogin = async (username: string, password: string) => {
    try {
      const userData = await api.login(username, password);
      setUser(userData);
      await resolveUrlRoute(userData);
    } catch (error: any) {
      throw error;
    }
  };

  const handleLogout = () => {
    api.setToken(null);
    setUser(null);
    setCurrentBoardId(null);
    setAdminSubRoute(null);
    setPage('boards');
    window.history.pushState(null, '', '/');
  };

  const handleSelectBoard = (boardId: string, boardName: string) => {
    navigateTo('board', boardId, boardName);
  };

  const handleBackToBoards = () => {
    navigateTo('boards');
  };

  const handleNavigateToBoard = async (boardId: string) => {
    try {
      const board = await api.getBoard(boardId);
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

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  const ThemeToggle = () => (
    <div className="global-actions">
      {user && notifSocket && (
        <NotificationBell socket={notifSocket} onNavigateToBoard={handleNavigateToBoard} />
      )}
      <button
        className="theme-toggle"
        onClick={toggleTheme}
        aria-label="Toggle theme"
        title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      >
        {theme === 'light' ? '🌙' : '☀️'}
      </button>
    </div>
  );

  if (!user && !api.getToken()) {
    return (
      <>
        <Login onLogin={handleLogin} />
        <ThemeToggle />
      </>
    );
  }

  if (page === 'board' && currentBoardId) {
    return (
      <>
        <KanbanBoard
          boardId={currentBoardId}
          onBack={handleBackToBoards}
          onLogout={handleLogout}
          userRole={user?.role || 'READ'}
        />
        <ThemeToggle />
      </>
    );
  }

  if (page === 'users' && user?.role === 'ADMIN') {
    return (
      <>
        <UserManagement
          onBack={handleBackToBoards}
          onLogout={handleLogout}
          currentUser={user}
          subRoute={adminSubRoute}
          onNavigate={handleAdminNavigate}
        />
        <ThemeToggle />
      </>
    );
  }

  return (
    <>
      <BoardList
        onSelectBoard={handleSelectBoard}
        onLogout={handleLogout}
        onGoToUsers={handleGoToUsers}
        user={user}
      />
      <ThemeToggle />
    </>
  );
}

export default App;
