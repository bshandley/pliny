import { ReactNode } from 'react';
import { useAppBar } from '../contexts/AppBarContext';
import NotificationBell from './NotificationBell';
import UserMenu from './UserMenu';
import PlankLogo from './PlankLogo';

interface AppBarProps {
  title: string;
  onBack?: () => void;
  showLogo?: boolean;
  children?: ReactNode;
}

export default function AppBar({ title, onBack, showLogo, children }: AppBarProps) {
  const {
    user,
    notifications,
    unreadCount,
    onMarkRead,
    onMarkAllRead,
    onNavigateToBoard,
    onGoToNotifications,
    theme,
    onToggleTheme,
    onLogout,
  } = useAppBar();

  return (
    <header className="app-bar">
      <div className="app-bar-left">
        {onBack && (
          <button onClick={onBack} className="app-bar-back" aria-label="Go back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
        )}
        {showLogo && <PlankLogo size={24} />}
        <h1 className="app-bar-title">{title}</h1>
      </div>

      <div className="app-bar-right">
        {children && <div className="app-bar-actions">{children}</div>}

        <div className="app-bar-global">
          {user && (
            <>
              <button
                className="app-bar-icon-btn app-bar-bell-mobile"
                onClick={onGoToNotifications}
                aria-label="Notifications"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                {unreadCount > 0 && (
                  <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
                )}
              </button>

              <div className="app-bar-bell-desktop">
                <NotificationBell
                  notifications={notifications}
                  onMarkRead={onMarkRead}
                  onMarkAllRead={onMarkAllRead}
                  onNavigateToBoard={onNavigateToBoard}
                />
              </div>
            </>
          )}

          {user && (
            <UserMenu
              user={user}
              theme={theme}
              onToggleTheme={onToggleTheme}
              onLogout={onLogout}
            />
          )}
        </div>
      </div>
    </header>
  );
}
