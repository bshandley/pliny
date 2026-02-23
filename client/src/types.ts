export interface User {
  id: string;
  username: string;
  role: 'READ' | 'COLLABORATOR' | 'ADMIN';
  email?: string;
  display_name?: string;
  avatar_url?: string;
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
  custom_fields?: CustomField[];
}

export interface BoardMember {
  id: string;
  username: string;
  role: 'READ' | 'COLLABORATOR' | 'ADMIN';
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
  assignee_name?: string | null;
  due_date?: string | null;
  priority?: 'low' | 'medium' | 'high' | null;
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
  type: 'assigned_card' | 'mention_card' | 'mention_comment' | 'due_date_reminder' | 'card_completed' | 'comment_added' | 'checklist_assigned' | 'description_changed';
  card_id: string;
  board_id: string;
  actor_id: string;
  actor_username: string;
  board_name: string;
  detail: Record<string, any>;
  read: boolean;
  created_at: string;
}

export interface CustomField {
  id: string;
  board_id: string;
  name: string;
  field_type: 'text' | 'number' | 'date' | 'dropdown' | 'checkbox';
  options: string[] | null;
  position: number;
  show_on_card: boolean;
}

export interface CustomFieldValue {
  value: string;
  field_type: string;
  name: string;
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
  start_date?: string | null;
  archived?: boolean;
  checklist?: { total: number; checked: number; overdue?: number } | null;
  dated_checklist_items?: ChecklistItem[];
  members?: CardMember[];
  custom_field_values?: Record<string, CustomFieldValue>;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface SearchResult {
  type: 'card' | 'comment' | 'checklist_item';
  card_id: string;
  card_title: string;
  board_id: string;
  board_name: string;
  column_name: string;
  match_text: string;
  rank: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
}

export interface OidcPublicConfig {
  enabled: boolean;
  button_label: string;
}

export interface OidcAdminConfig {
  enabled: boolean;
  issuer_url: string;
  client_id: string;
  client_secret_masked: string;
  button_label: string;
  claim_email: string;
  claim_name: string;
  claim_avatar: string;
  callback_base_url: string;
  callback_url: string;
}

export interface TotpSetupResponse {
  qr_code: string;
  secret: string;
  backup_codes: string[];
}

export interface BoardTemplate {
  id: string;
  name: string;
  description?: string;
  is_builtin: boolean;
  data: {
    columns: {
      name: string;
      position: number;
      cards: {
        title: string;
        description: string;
        position: number;
        checklist_items?: { text: string; position: number }[];
      }[];
    }[];
    labels: { name: string; color: string }[];
    custom_fields: {
      name: string;
      field_type: string;
      options?: string[];
      position: number;
      show_on_card: boolean;
    }[];
  };
  column_count?: number;
  card_count?: number;
  created_by?: string;
  created_at: string;
}
