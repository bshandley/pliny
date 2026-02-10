import { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { api } from '../api';
import { Notification } from '../types';

interface NotificationBellProps {
  socket: Socket | null;
  onNavigateToBoard: (boardId: string) => void;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const secs = Math.floor((now - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function NotificationBell({ socket, onNavigateToBoard }: NotificationBellProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadNotifications();
  }, []);

  useEffect(() => {
    if (!socket) return;
    const handler = (notif: Notification) => {
      setNotifications(prev => [notif, ...prev].slice(0, 50));
    };
    socket.on('notification:new', handler);
    return () => { socket.off('notification:new', handler); };
  }, [socket]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const loadNotifications = async () => {
    try {
      const data = await api.getNotifications();
      setNotifications(data);
    } catch (err) {
      console.error('Failed to load notifications:', err);
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleClick = async (notif: Notification) => {
    if (!notif.read) {
      await api.markNotificationRead(notif.id);
      setNotifications(prev =>
        prev.map(n => n.id === notif.id ? { ...n, read: true } : n)
      );
    }
    setOpen(false);
    onNavigateToBoard(notif.board_id);
  };

  const handleMarkAllRead = async () => {
    await api.markAllNotificationsRead();
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const getNotificationText = (notif: Notification) => {
    const cardTitle = notif.detail?.card_title || 'a card';
    if (notif.type === 'mention_card') {
      return { action: 'added you to', target: cardTitle };
    }
    return { action: 'mentioned you on', target: cardTitle };
  };

  return (
    <div className="notification-bell" ref={dropdownRef}>
      <button
        className="btn-icon notification-bell-btn"
        onClick={() => setOpen(!open)}
        aria-label="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unreadCount > 0 && (
          <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="notification-dropdown">
          <div className="notification-header">
            <strong>Notifications</strong>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="notification-mark-all">
                Mark all read
              </button>
            )}
          </div>
          <div className="notification-list">
            {notifications.length === 0 ? (
              <div className="notification-empty">No notifications yet</div>
            ) : (
              notifications.map(notif => {
                const { action, target } = getNotificationText(notif);
                return (
                  <button
                    key={notif.id}
                    className={`notification-item ${!notif.read ? 'unread' : ''}`}
                    onClick={() => handleClick(notif)}
                  >
                    <div className="notification-content">
                      <span className="notification-text">
                        <strong>{notif.actor_username}</strong> {action} <strong>{target}</strong>
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
      )}
    </div>
  );
}
