export interface User {
  id: string;
  username: string;
  role: 'READ' | 'ADMIN';
  created_at?: string;
}

export interface Board {
  id: string;
  name: string;
  description?: string;
  archived?: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  columns?: Column[];
}

export interface BoardMember {
  id: string;
  username: string;
  role: 'READ' | 'ADMIN';
  added_at: string;
}

export interface Column {
  id: string;
  board_id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
  cards?: Card[];
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Comment {
  id: string;
  card_id: string;
  user_id: string;
  username: string;
  text: string;
  created_at: string;
}

export interface ChecklistItem {
  id: string;
  card_id: string;
  text: string;
  checked: boolean;
  position: number;
}

export interface CardMember {
  id: string;
  username: string;
}

export interface ActivityEntry {
  id: string;
  card_id: string;
  user_id: string;
  username: string;
  action: string;
  detail: Record<string, any> | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: 'mention_card' | 'mention_comment';
  card_id: string;
  board_id: string;
  actor_id: string;
  actor_username: string;
  board_name: string;
  detail: Record<string, any>;
  read: boolean;
  created_at: string;
}

export interface Card {
  id: string;
  column_id: string;
  title: string;
  description?: string;
  assignee?: string; // Deprecated, use assignees
  assignees?: string[];
  labels?: Label[];
  due_date?: string | null;
  archived?: boolean;
  checklist?: { total: number; checked: number } | null;
  members?: CardMember[];
  position: number;
  created_at: string;
  updated_at: string;
}
