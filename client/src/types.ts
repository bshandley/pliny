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

export interface Card {
  id: string;
  column_id: string;
  title: string;
  description?: string;
  assignee?: string; // Deprecated, use assignees
  assignees?: string[];
  due_date?: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}
