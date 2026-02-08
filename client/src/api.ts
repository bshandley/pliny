import { Board, Column, Card, User, BoardMember, Label, Comment, ChecklistItem } from './types';

const API_URL = '/api';

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem('token');
    }
    return this.token;
  }

  private async fetch(url: string, options: RequestInit = {}) {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_URL}${url}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  // Auth
  async login(username: string, password: string) {
    const data = await this.fetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    this.setToken(data.token);
    return data.user;
  }

  async me(): Promise<User> {
    return this.fetch('/auth/me');
  }

  async register(username: string, password: string, role: 'READ' | 'ADMIN') {
    return this.fetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, role }),
    });
  }

  // Users
  async getUsers(): Promise<User[]> {
    return this.fetch('/users');
  }

  async updateUser(id: string, updates: { username?: string; password?: string; role?: 'READ' | 'ADMIN' }): Promise<User> {
    return this.fetch(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteUser(id: string): Promise<void> {
    return this.fetch(`/users/${id}`, { method: 'DELETE' });
  }

  // Boards
  async getBoards(): Promise<Board[]> {
    return this.fetch('/boards');
  }

  async getBoard(id: string): Promise<Board> {
    return this.fetch(`/boards/${id}`);
  }

  async createBoard(name: string, description?: string): Promise<Board> {
    return this.fetch('/boards', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
  }

  async updateBoard(id: string, updates: Partial<Board>): Promise<Board> {
    return this.fetch(`/boards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteBoard(id: string): Promise<void> {
    return this.fetch(`/boards/${id}`, { method: 'DELETE' });
  }

  // Board Members
  async getBoardMembers(boardId: string): Promise<BoardMember[]> {
    return this.fetch(`/boards/${boardId}/members`);
  }

  async addBoardMember(boardId: string, userId: string): Promise<void> {
    return this.fetch(`/boards/${boardId}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  }

  async removeBoardMember(boardId: string, userId: string): Promise<void> {
    return this.fetch(`/boards/${boardId}/members/${userId}`, {
      method: 'DELETE',
    });
  }

  // Columns
  async createColumn(board_id: string, name: string, position: number): Promise<Column> {
    return this.fetch('/columns', {
      method: 'POST',
      body: JSON.stringify({ board_id, name, position }),
    });
  }

  async updateColumn(id: string, updates: Partial<Column>): Promise<Column> {
    return this.fetch(`/columns/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteColumn(id: string): Promise<void> {
    return this.fetch(`/columns/${id}`, { method: 'DELETE' });
  }

  // Cards
  async createCard(column_id: string, title: string, position: number, description?: string, assignee?: string): Promise<Card> {
    return this.fetch('/cards', {
      method: 'POST',
      body: JSON.stringify({ column_id, title, description, assignee, position }),
    });
  }

  async updateCard(id: string, updates: Partial<Card>): Promise<Card> {
    return this.fetch(`/cards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteCard(id: string): Promise<void> {
    return this.fetch(`/cards/${id}`, { method: 'DELETE' });
  }

  // Assignees
  async getBoardAssignees(boardId: string): Promise<{ id: string; name: string; created_at: string }[]> {
    return this.fetch(`/boards/${boardId}/assignees`);
  }

  async addBoardAssignee(boardId: string, name: string): Promise<{ id: string; name: string; created_at: string }> {
    return this.fetch(`/boards/${boardId}/assignees`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async renameBoardAssignee(boardId: string, assigneeId: string, name: string): Promise<{ id: string; name: string; created_at: string }> {
    return this.fetch(`/boards/${boardId}/assignees/${assigneeId}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  }

  async deleteBoardAssignee(boardId: string, assigneeId: string): Promise<void> {
    return this.fetch(`/boards/${boardId}/assignees/${assigneeId}`, {
      method: 'DELETE',
    });
  }

  // Labels
  async getBoardLabels(boardId: string): Promise<Label[]> {
    return this.fetch(`/boards/${boardId}/labels`);
  }

  async createLabel(boardId: string, name: string, color: string): Promise<Label> {
    return this.fetch(`/boards/${boardId}/labels`, {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    });
  }

  async updateLabel(id: string, name: string, color: string): Promise<Label> {
    return this.fetch(`/labels/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, color }),
    });
  }

  async deleteLabel(id: string): Promise<void> {
    return this.fetch(`/labels/${id}`, { method: 'DELETE' });
  }

  // Comments
  async getCardComments(cardId: string): Promise<Comment[]> {
    return this.fetch(`/cards/${cardId}/comments`);
  }

  async addCardComment(cardId: string, text: string): Promise<Comment> {
    return this.fetch(`/cards/${cardId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  async deleteComment(id: string): Promise<void> {
    return this.fetch(`/comments/${id}`, { method: 'DELETE' });
  }

  // Checklists
  async getCardChecklist(cardId: string): Promise<ChecklistItem[]> {
    return this.fetch(`/cards/${cardId}/checklist`);
  }

  async addChecklistItem(cardId: string, text: string): Promise<ChecklistItem> {
    return this.fetch(`/cards/${cardId}/checklist`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  async updateChecklistItem(id: string, updates: Partial<ChecklistItem>): Promise<ChecklistItem> {
    return this.fetch(`/checklist/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteChecklistItem(id: string): Promise<void> {
    return this.fetch(`/checklist/${id}`, { method: 'DELETE' });
  }
}

export const api = new ApiClient();
