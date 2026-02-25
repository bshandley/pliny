import { Board, Column, Card, User, BoardMember, Label, Comment, ChecklistItem, CardMember, ActivityEntry, Notification, CustomField, BoardTemplate, SearchResponse, Attachment, ApiToken } from './types';

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
  async login(username: string, password: string): Promise<any> {
    const data = await this.fetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (data.requires_2fa) {
      return { requires_2fa: true, ticket: data.ticket };
    }
    this.setToken(data.token);
    return { user: data.user };
  }

  async me(): Promise<User> {
    return this.fetch('/auth/me');
  }

  async register(username: string, password: string, role: 'READ' | 'COLLABORATOR' | 'ADMIN') {
    return this.fetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, role }),
    });
  }

  // Users
  async getUsers(): Promise<User[]> {
    return this.fetch('/users');
  }

  async updateUser(id: string, updates: { username?: string; password?: string; role?: 'READ' | 'COLLABORATOR' | 'ADMIN' }): Promise<User> {
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
  // Custom Fields
  async getCustomFields(boardId: string): Promise<CustomField[]> {
    return this.fetch(`/boards/${boardId}/custom-fields`);
  }

  async createCustomField(boardId: string, data: { name: string; field_type: string; options?: string[]; show_on_card?: boolean }): Promise<CustomField> {
    return this.fetch(`/boards/${boardId}/custom-fields`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateCustomField(fieldId: string, data: Partial<{ name: string; options: string[]; position: number; show_on_card: boolean }>): Promise<CustomField> {
    return this.fetch(`/custom-fields/${fieldId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteCustomField(fieldId: string): Promise<void> {
    return this.fetch(`/custom-fields/${fieldId}`, { method: 'DELETE' });
  }

  async setCardCustomFields(cardId: string, values: Record<string, string | null>): Promise<void> {
    return this.fetch(`/cards/${cardId}/custom-fields`, {
      method: 'PUT',
      body: JSON.stringify(values),
    });
  }

  // Card Members
  async getCardMembers(cardId: string): Promise<CardMember[]> {
    return this.fetch(`/cards/${cardId}/members`);
  }

  async setCardMembers(cardId: string, memberIds: string[]): Promise<CardMember[]> {
    return this.fetch(`/cards/${cardId}/members`, {
      method: 'PUT',
      body: JSON.stringify({ members: memberIds }),
    });
  }

  // Analytics
  async getBoardAnalytics(boardId: string, days: number = 30): Promise<any> {
    return this.fetch(`/boards/${boardId}/analytics?days=${days}`);
  }

  // Activity
  async getCardActivity(cardId: string): Promise<ActivityEntry[]> {
    return this.fetch(`/cards/${cardId}/activity`);
  }

  // Notifications
  async getNotifications(): Promise<Notification[]> {
    return this.fetch('/notifications');
  }

  async markNotificationRead(id: string): Promise<void> {
    return this.fetch(`/notifications/${id}/read`, { method: 'PUT' });
  }

  async markAllNotificationsRead(): Promise<void> {
    return this.fetch('/notifications/read-all', { method: 'PUT' });
  }

  // SSO
  async getOidcPublicConfig(): Promise<{ enabled: boolean; button_label: string }> {
    const response = await fetch('/api/auth/oidc/config');
    return response.json();
  }

  // SSO Admin Settings
  async getOidcSettings() {
    return this.fetch('/settings/oidc');
  }

  async updateOidcSettings(settings: {
    enabled?: boolean;
    issuer_url?: string;
    client_id?: string;
    client_secret?: string;
    button_label?: string;
    claim_email?: string;
    claim_name?: string;
    claim_avatar?: string;
    callback_base_url?: string;
  }) {
    return this.fetch('/settings/oidc', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // Templates
  async getTemplates(): Promise<BoardTemplate[]> {
    return this.fetch('/templates');
  }

  async createTemplateFromBoard(boardId: string, name: string, description?: string): Promise<BoardTemplate> {
    return this.fetch('/templates', {
      method: 'POST',
      body: JSON.stringify({ board_id: boardId, name, description }),
    });
  }

  async useTemplate(templateId: string, name: string, description?: string): Promise<Board> {
    return this.fetch(`/templates/${templateId}/use`, {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
  }

  async deleteTemplate(templateId: string): Promise<void> {
    return this.fetch(`/templates/${templateId}`, { method: 'DELETE' });
  }

  // App Settings
  async getAppSettings(): Promise<Record<string, any>> {
    return this.fetch('/app-settings');
  }

  async updateAppSetting(key: string, value: any): Promise<void> {
    return this.fetch(`/app-settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  }

  async testSmtp(to: string): Promise<{ message: string }> {
    return this.fetch('/app-settings/smtp-test', {
      method: 'POST',
      body: JSON.stringify({ to }),
    });
  }

  async getNotificationPreferences(): Promise<Record<string, boolean>> {
    return this.fetch('/notifications/preferences');
  }

  async updateNotificationPreferences(prefs: Record<string, boolean>): Promise<Record<string, boolean>> {
    return this.fetch('/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(prefs),
    });
  }

  async getSmtpStatus(): Promise<{ configured: boolean }> {
    return this.fetch('/app-settings/smtp-status');
  }

  // TOTP 2FA
  async getTotpStatus(): Promise<{ enabled: boolean }> {
    return this.fetch('/settings/totp/status');
  }

  async setupTotp(): Promise<{ qr_code: string; secret: string; backup_codes: string[] }> {
    return this.fetch('/settings/totp/setup', { method: 'POST' });
  }

  async enableTotp(code: string): Promise<{ message: string }> {
    return this.fetch('/settings/totp/enable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  async disableTotp(password: string): Promise<{ message: string }> {
    return this.fetch('/settings/totp', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    });
  }

  async verify2fa(ticket: string, code: string) {
    const data = await this.fetch('/auth/verify-2fa', {
      method: 'POST',
      body: JSON.stringify({ ticket, code }),
    });
    this.setToken(data.token);
    return data.user;
  }
  // Search
  async search(q: string, limit: number = 20): Promise<SearchResponse> {
    return this.fetch(`/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  }

  // Attachments
  async getAttachments(cardId: string): Promise<Attachment[]> {
    return this.fetch(`/cards/${cardId}/attachments`);
  }

  async uploadAttachment(cardId: string, file: File, onProgress?: (pct: number) => void): Promise<Attachment> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('file', file);

      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        });
      }

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            reject(new Error(err.error || 'Upload failed'));
          } catch {
            reject(new Error('Upload failed'));
          }
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Upload failed')));

      const token = this.getToken();
      xhr.open('POST', `${API_URL}/cards/${cardId}/attachments`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });
  }

  async deleteAttachment(id: string): Promise<void> {
    return this.fetch(`/attachments/${id}`, { method: 'DELETE' });
  }

  // API Tokens
  async getApiTokens(): Promise<ApiToken[]> {
    return this.fetch('/tokens');
  }

  async createApiToken(name: string, expiresInDays?: number): Promise<ApiToken> {
    return this.fetch('/tokens', {
      method: 'POST',
      body: JSON.stringify({ name, expires_in_days: expiresInDays }),
    });
  }

  async revokeApiToken(id: string): Promise<void> {
    return this.fetch(`/tokens/${id}`, { method: 'DELETE' });
  }

  async revokeAllApiTokens(): Promise<void> {
    return this.fetch('/tokens', { method: 'DELETE' });
  }

  // CSV
  async exportBoardCsv(boardId: string): Promise<void> {
    const token = this.getToken();
    const response = await fetch(`${API_URL}/boards/${boardId}/csv/export`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Export failed' }));
      throw new Error(error.error || 'Export failed');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export const api = new ApiClient();
