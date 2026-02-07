import { Request } from 'express';

export interface User {
  id: string;
  username: string;
  password_hash: string;
  role: 'READ' | 'ADMIN';
  created_at: Date;
}

export interface Board {
  id: string;
  name: string;
  description?: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface BoardMember {
  board_id: string;
  user_id: string;
  added_at: Date;
}

export interface Column {
  id: string;
  board_id: string;
  name: string;
  position: number;
  created_at: Date;
  updated_at: Date;
}

export interface Card {
  id: string;
  column_id: string;
  title: string;
  description?: string;
  assignee?: string;
  position: number;
  created_at: Date;
  updated_at: Date;
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: 'READ' | 'ADMIN';
  };
}
