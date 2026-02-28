import { Board, Column, Card, User, BoardMember, Label, Comment, ChecklistItem, ActivityEntry, Notification, CustomField, BoardTemplate, SearchResponse, Attachment, ApiToken, Webhook, WebhookDelivery } from './types';

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

  private async fetch(url: string, options: RequestInit = {}, fnName?: string) {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (fnName) {
      headers['X-Client-Fn'] = fnName;
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
    }, 'login');
    if (data.requires_2fa) {
      return { requires_2fa: true, ticket: data.ticket };
    }
    this.setToken(data.token);
    return { user: data.user };
  }

  async me(): Promise<User> {
    return this.fetch('/auth/me', {}, 'me');
  }

  async register(username: string, password: string, role: 'GUEST' | 'MEMBER' | 'ADMIN') {
    return this.fetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, role }),
    }, 'register');
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    return this.fetch('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }, 'forgotPassword');
  }

  async resetPassword(token: string, password: string): Promise<{ message: string }> {
    return this.fetch('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }, 'resetPassword');
  }

  async getProfile(): Promise<any> {
    return this.fetch('/profile', {}, 'getProfile');
  }

  async updateProfile(data: { display_name?: string; email?: string; current_password?: string; new_password?: string }): Promise<any> {
    return this.fetch('/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    }, 'updateProfile');
  }

  // Users
  async getUsers(): Promise<User[]> {
    return this.fetch('/users', {}, 'getUsers');
  }

  async updateUser(id: string, updates: { username?: string; password?: string; role?: 'GUEST' | 'MEMBER' | 'ADMIN' }): Promise<User> {
    return this.fetch(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }, 'updateUser');
  }

  async deleteUser(id: string): Promise<void> {
    return this.fetch(`/users/${id}`, { method: 'DELETE' }, 'deleteUser');
  }

  // Boards
  async getBoards(): Promise<Board[]> {
    return this.fetch('/boards', {}, 'getBoards');
  }

  async getBoard(id: string): Promise<Board> {
    return this.fetch(`/boards/${id}`, {}, 'getBoard');
  }

  async createBoard(name: string, description?: string): Promise<Board> {
    return this.fetch('/boards', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }, 'createBoard');
  }

  async updateBoard(id: string, updates: Partial<Board>): Promise<Board> {
    return this.fetch(`/boards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }, 'updateBoard');
  }

  async deleteBoard(id: string): Promise<void> {
    return this.fetch(`/boards/${id}`, { method: 'DELETE' }, 'deleteBoard');
  }

  async starBoard(id: string): Promise<{ starred: boolean }> {
    return this.fetch(`/boards/${id}/star`, { method: 'POST' }, 'starBoard');
  }

  async unstarBoard(id: string): Promise<{ starred: boolean }> {
    return this.fetch(`/boards/${id}/star`, { method: 'DELETE' }, 'unstarBoard');
  }

  // Board Members
  async getBoardMembers(boardId: string): Promise<BoardMember[]> {
    return this.fetch(`/boards/${boardId}/members`, {}, 'getBoardMembers');
  }

  async addBoardMember(boardId: string, userId: string, role: string = 'EDITOR'): Promise<void> {
    return this.fetch(`/boards/${boardId}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, role }),
    }, 'addBoardMember');
  }

  async changeBoardMemberRole(boardId: string, userId: string, role: string): Promise<void> {
    return this.fetch(`/boards/${boardId}/members/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }, 'changeBoardMemberRole');
  }

  async removeBoardMember(boardId: string, userId: string): Promise<void> {
    return this.fetch(`/boards/${boardId}/members/${userId}`, {
      method: 'DELETE',
    }, 'removeBoardMember');
  }

  // Columns
  async createColumn(board_id: string, name: string, position: number): Promise<Column> {
    return this.fetch('/columns', {
      method: 'POST',
      body: JSON.stringify({ board_id, name, position }),
    }, 'createColumn');
  }

  async updateColumn(id: string, updates: Partial<Column>): Promise<Column> {
    return this.fetch(`/columns/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }, 'updateColumn');
  }

  async deleteColumn(id: string): Promise<void> {
    return this.fetch(`/columns/${id}`, { method: 'DELETE' }, 'deleteColumn');
  }

  // Cards
  async createCard(column_id: string, title: string, position: number, description?: string, assignee?: string): Promise<Card> {
    return this.fetch('/cards', {
      method: 'POST',
      body: JSON.stringify({ column_id, title, description, assignee, position }),
    }, 'createCard');
  }

  async updateCard(id: string, updates: Partial<Card>): Promise<Card> {
    return this.fetch(`/cards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }, 'updateCard');
  }

  async deleteCard(id: string): Promise<void> {
    return this.fetch(`/cards/${id}`, { method: 'DELETE' }, 'deleteCard');
  }

  async getCard(id: string): Promise<Card> {
    return this.fetch(`/cards/${id}`, {}, 'getCard');
  }

  async getSubtasks(cardId: string): Promise<any[]> {
    return this.fetch(`/cards/${cardId}/subtasks`, {}, 'getSubtasks');
  }

  async createSubtask(cardId: string, title: string, columnId: string): Promise<Card> {
    return this.fetch(`/cards/${cardId}/subtasks`, {
      method: 'POST',
      body: JSON.stringify({ title, column_id: columnId }),
    }, 'createSubtask');
  }

  // Labels
  async getBoardLabels(boardId: string): Promise<Label[]> {
    return this.fetch(`/boards/${boardId}/labels`, {}, 'getBoardLabels');
  }

  async createLabel(boardId: string, name: string, color: string): Promise<Label> {
    return this.fetch(`/boards/${boardId}/labels`, {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    }, 'createLabel');
  }

  async updateLabel(id: string, name: string, color: string): Promise<Label> {
    return this.fetch(`/labels/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, color }),
    }, 'updateLabel');
  }

  async deleteLabel(id: string): Promise<void> {
    return this.fetch(`/labels/${id}`, { method: 'DELETE' }, 'deleteLabel');
  }

  // Comments
  async getCardComments(cardId: string): Promise<Comment[]> {
    return this.fetch(`/cards/${cardId}/comments`, {}, 'getCardComments');
  }

  async addCardComment(cardId: string, text: string): Promise<Comment> {
    return this.fetch(`/cards/${cardId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }, 'addCardComment');
  }

  async deleteComment(id: string): Promise<void> {
    return this.fetch(`/comments/${id}`, { method: 'DELETE' }, 'deleteComment');
  }

  // Checklists
  async getCardChecklist(cardId: string): Promise<ChecklistItem[]> {
    return this.fetch(`/cards/${cardId}/checklist`, {}, 'getCardChecklist');
  }

  async addChecklistItem(cardId: string, text: string): Promise<ChecklistItem> {
    return this.fetch(`/cards/${cardId}/checklist`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }, 'addChecklistItem');
  }

  async updateChecklistItem(id: string, updates: Partial<ChecklistItem>): Promise<ChecklistItem> {
    return this.fetch(`/checklist/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }, 'updateChecklistItem');
  }

  async deleteChecklistItem(id: string): Promise<void> {
    return this.fetch(`/checklist/${id}`, { method: 'DELETE' }, 'deleteChecklistItem');
  }
  // Custom Fields
  async getCustomFields(boardId: string): Promise<CustomField[]> {
    return this.fetch(`/boards/${boardId}/custom-fields`, {}, 'getCustomFields');
  }

  async createCustomField(boardId: string, data: { name: string; field_type: string; options?: string[]; show_on_card?: boolean }): Promise<CustomField> {
    return this.fetch(`/boards/${boardId}/custom-fields`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, 'createCustomField');
  }

  async updateCustomField(fieldId: string, data: Partial<{ name: string; options: string[]; position: number; show_on_card: boolean }>): Promise<CustomField> {
    return this.fetch(`/custom-fields/${fieldId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }, 'updateCustomField');
  }

  async deleteCustomField(fieldId: string): Promise<void> {
    return this.fetch(`/custom-fields/${fieldId}`, { method: 'DELETE' }, 'deleteCustomField');
  }

  async setCardCustomFields(cardId: string, values: Record<string, string | null>): Promise<void> {
    return this.fetch(`/cards/${cardId}/custom-fields`, {
      method: 'PUT',
      body: JSON.stringify(values),
    }, 'setCardCustomFields');
  }

  // Analytics
  async getBoardAnalytics(boardId: string, days: number = 30): Promise<any> {
    return this.fetch(`/boards/${boardId}/analytics?days=${days}`, {}, 'getBoardAnalytics');
  }

  // Activity
  async getCardActivity(cardId: string): Promise<ActivityEntry[]> {
    return this.fetch(`/cards/${cardId}/activity`, {}, 'getCardActivity');
  }

  // Notifications
  async getNotifications(): Promise<Notification[]> {
    return this.fetch('/notifications', {}, 'getNotifications');
  }

  async markNotificationRead(id: string): Promise<void> {
    return this.fetch(`/notifications/${id}/read`, { method: 'PUT' }, 'markNotificationRead');
  }

  async markAllNotificationsRead(): Promise<void> {
    return this.fetch('/notifications/read-all', { method: 'PUT' }, 'markAllNotificationsRead');
  }

  // SSO
  async getOidcPublicConfig(): Promise<{ enabled: boolean; button_label: string }> {
    const response = await fetch('/api/auth/oidc/config');
    return response.json();
  }

  // SSO Admin Settings
  async getOidcSettings() {
    return this.fetch('/settings/oidc', {}, 'getOidcSettings');
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
    }, 'updateOidcSettings');
  }

  // Templates
  async getTemplates(): Promise<BoardTemplate[]> {
    return this.fetch('/templates', {}, 'getTemplates');
  }

  async createTemplateFromBoard(boardId: string, name: string, description?: string): Promise<BoardTemplate> {
    return this.fetch('/templates', {
      method: 'POST',
      body: JSON.stringify({ board_id: boardId, name, description }),
    }, 'createTemplateFromBoard');
  }

  async useTemplate(templateId: string, name: string, description?: string): Promise<Board> {
    return this.fetch(`/templates/${templateId}/use`, {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }, 'useTemplate');
  }

  async deleteTemplate(templateId: string): Promise<void> {
    return this.fetch(`/templates/${templateId}`, { method: 'DELETE' }, 'deleteTemplate');
  }

  // App Settings
  async getAppSettings(): Promise<Record<string, any>> {
    return this.fetch('/app-settings', {}, 'getAppSettings');
  }

  async updateAppSetting(key: string, value: any): Promise<void> {
    return this.fetch(`/app-settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }, 'updateAppSetting');
  }

  async testSmtp(to: string): Promise<{ message: string }> {
    return this.fetch('/app-settings/smtp-test', {
      method: 'POST',
      body: JSON.stringify({ to }),
    }, 'testSmtp');
  }

  async getNotificationPreferences(): Promise<Record<string, boolean>> {
    return this.fetch('/notifications/preferences', {}, 'getNotificationPreferences');
  }

  async updateNotificationPreferences(prefs: Record<string, boolean>): Promise<Record<string, boolean>> {
    return this.fetch('/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(prefs),
    }, 'updateNotificationPreferences');
  }

  async getSmtpStatus(): Promise<{ configured: boolean }> {
    return this.fetch('/app-settings/smtp-status', {}, 'getSmtpStatus');
  }

  // TOTP 2FA
  async getTotpStatus(): Promise<{ enabled: boolean }> {
    return this.fetch('/settings/totp/status', {}, 'getTotpStatus');
  }

  async setupTotp(): Promise<{ qr_code: string; secret: string; backup_codes: string[] }> {
    return this.fetch('/settings/totp/setup', { method: 'POST' }, 'setupTotp');
  }

  async enableTotp(code: string): Promise<{ message: string }> {
    return this.fetch('/settings/totp/enable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }, 'enableTotp');
  }

  async disableTotp(password: string): Promise<{ message: string }> {
    return this.fetch('/settings/totp', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    }, 'disableTotp');
  }

  async verify2fa(ticket: string, code: string) {
    const data = await this.fetch('/auth/verify-2fa', {
      method: 'POST',
      body: JSON.stringify({ ticket, code }),
    }, 'verify2fa');
    this.setToken(data.token);
    return data.user;
  }
  // Search
  async search(q: string, limit: number = 20): Promise<SearchResponse> {
    return this.fetch(`/search?q=${encodeURIComponent(q)}&limit=${limit}`, {}, 'search');
  }

  // Attachments
  async getAttachments(cardId: string): Promise<Attachment[]> {
    return this.fetch(`/cards/${cardId}/attachments`, {}, 'getAttachments');
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
      xhr.setRequestHeader('X-Client-Fn', 'uploadAttachment');
      xhr.send(formData);
    });
  }

  async deleteAttachment(id: string): Promise<void> {
    return this.fetch(`/attachments/${id}`, { method: 'DELETE' }, 'deleteAttachment');
  }

  // API Tokens
  async getApiTokens(): Promise<ApiToken[]> {
    return this.fetch('/tokens', {}, 'getApiTokens');
  }

  async createApiToken(name: string, expiresInDays?: number): Promise<ApiToken> {
    return this.fetch('/tokens', {
      method: 'POST',
      body: JSON.stringify({ name, expires_in_days: expiresInDays }),
    }, 'createApiToken');
  }

  async revokeApiToken(id: string): Promise<void> {
    return this.fetch(`/tokens/${id}`, { method: 'DELETE' }, 'revokeApiToken');
  }

  async revokeAllApiTokens(): Promise<void> {
    return this.fetch('/tokens', { method: 'DELETE' }, 'revokeAllApiTokens');
  }

  // Webhooks
  async getWebhooks(): Promise<Webhook[]> {
    return this.fetch('/webhooks', {}, 'getWebhooks');
  }

  async getBoardWebhooks(boardId: string): Promise<Webhook[]> {
    return this.fetch(`/webhooks/board/${boardId}`, {}, 'getBoardWebhooks');
  }

  async createWebhook(data: { url: string; events: string[]; description?: string; board_id?: string }): Promise<Webhook> {
    return this.fetch('/webhooks', {
      method: 'POST',
      body: JSON.stringify(data),
    }, 'createWebhook');
  }

  async updateWebhook(id: string, updates: { url?: string; events?: string[]; description?: string; enabled?: boolean }): Promise<Webhook> {
    return this.fetch(`/webhooks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }, 'updateWebhook');
  }

  async deleteWebhook(id: string): Promise<void> {
    return this.fetch(`/webhooks/${id}`, { method: 'DELETE' }, 'deleteWebhook');
  }

  async getWebhookDeliveries(webhookId: string, limit?: number): Promise<WebhookDelivery[]> {
    const params = limit ? `?limit=${limit}` : '';
    return this.fetch(`/webhooks/${webhookId}/deliveries${params}`, {}, 'getWebhookDeliveries');
  }

  async redeliverWebhook(deliveryId: string): Promise<void> {
    return this.fetch(`/webhooks/deliveries/${deliveryId}/redeliver`, { method: 'POST' }, 'redeliverWebhook');
  }

  async regenerateWebhookSecret(webhookId: string): Promise<{ secret: string }> {
    return this.fetch(`/webhooks/${webhookId}/regenerate-secret`, { method: 'POST' }, 'regenerateWebhookSecret');
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
  // Card Relations
  async getCardRelations(cardId: string): Promise<any> {
    return this.fetch(`/cards/${cardId}/relations`, {}, 'getCardRelations');
  }

  async addCardRelation(cardId: string, targetCardId: string, relationType: string): Promise<any> {
    return this.fetch(`/cards/${cardId}/relations`, {
      method: 'POST',
      body: JSON.stringify({ target_card_id: targetCardId, relation_type: relationType }),
    }, 'addCardRelation');
  }

  async deleteCardRelation(cardId: string, targetCardId: string): Promise<any> {
    return this.fetch(`/cards/${cardId}/relations/${targetCardId}`, {
      method: 'DELETE',
    }, 'deleteCardRelation');
  }

  // Public Board Links
  async generatePublicLink(boardId: string): Promise<{ token: string; publicUrl: string }> {
    return this.fetch(`/boards/${boardId}/public-link`, { method: 'POST' }, 'generatePublicLink');
  }

  async revokePublicLink(boardId: string): Promise<void> {
    return this.fetch(`/boards/${boardId}/public-link`, { method: 'DELETE' }, 'revokePublicLink');
  }

  async getPublicBoard(token: string): Promise<any> {
    const response = await fetch(`/api/public/${token}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }
    return response.json();
  }

  // JSON Export
  async exportBoardJson(boardId: string): Promise<any> {
    return this.fetch(`/boards/${boardId}/export`, {}, 'exportBoardJson');
  }
}

export const api = new ApiClient();
