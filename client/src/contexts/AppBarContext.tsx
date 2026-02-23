import { createContext, useContext } from 'react';
import { User, Notification } from '../types';

export interface AppBarContextType {
  user: User | null;
  notifications: Notification[];
  unreadCount: number;
  onMarkRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onNavigateToBoard: (boardId: string, cardId?: string) => void;
  onGoToNotifications: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: (e?: React.MouseEvent) => void;
  onLogout: () => void;
  onSearchOpen: () => void;
  onGoToProfile?: () => void;
}

const AppBarContext = createContext<AppBarContextType | null>(null);

export function useAppBar(): AppBarContextType {
  const ctx = useContext(AppBarContext);
  if (!ctx) throw new Error('useAppBar must be used within AppBarProvider');
  return ctx;
}

export default AppBarContext;
