import { useState, useEffect, useRef, useContext } from 'react';
import { User } from '../types';
import AppBarContext from '../contexts/AppBarContext';

interface UserMenuProps {
  user: User;
  theme: 'light' | 'dark';
  onToggleTheme: (e?: React.MouseEvent) => void;
  onLogout: () => void;
}

export default function UserMenu({ user, theme, onToggleTheme, onLogout }: UserMenuProps) {
  const appBarCtx = useContext(AppBarContext);
  const onGoToProfile = appBarCtx?.onGoToProfile;
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const initial = (user.display_name || user.username).charAt(0).toUpperCase();

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        className="user-menu-trigger"
        onClick={() => setOpen(!open)}
        aria-label="User menu"
      >
        {user.avatar_url ? (
          <img src={user.avatar_url} alt={user.display_name || user.username} className="user-avatar user-avatar-img" />
        ) : (
          <span className="user-avatar">{initial}</span>
        )}
      </button>

      {open && (
        <div className="user-menu-dropdown">
          <div className="user-menu-info">
            <span className="user-menu-name">{user.display_name || user.username}</span>
            <span className={`role-badge role-${user.role.toLowerCase()}`}>{user.role}</span>
          </div>
          <div className="user-menu-divider" />
          <button onClick={(e) => { setOpen(false); onToggleTheme(e); }} className="user-menu-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {theme === 'light' ? (
                <><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></>
              ) : (
                <><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></>
              )}
            </svg>
            {theme === 'light' ? 'Dark mode' : 'Light mode'}
          </button>
          <button onClick={() => { onGoToProfile?.(); setOpen(false); }} className="user-menu-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            Profile
          </button>
          <button onClick={() => { onLogout(); setOpen(false); }} className="user-menu-item user-menu-logout">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
