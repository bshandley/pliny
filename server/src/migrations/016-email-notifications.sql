-- Migration 016: Email notifications infrastructure

-- Email queue for resilient delivery
CREATE TABLE IF NOT EXISTS email_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID REFERENCES notifications(id) ON DELETE SET NULL,
  to_email VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  body_html TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status, next_attempt_at);

-- User notification preferences
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_assigned_card BOOLEAN NOT NULL DEFAULT TRUE,
  email_mention_comment BOOLEAN NOT NULL DEFAULT TRUE,
  email_due_date_reminder BOOLEAN NOT NULL DEFAULT TRUE,
  email_card_completed BOOLEAN NOT NULL DEFAULT FALSE,
  email_comment_added BOOLEAN NOT NULL DEFAULT FALSE,
  email_checklist_assigned BOOLEAN NOT NULL DEFAULT TRUE,
  email_description_changed BOOLEAN NOT NULL DEFAULT FALSE
);

-- Due date reminder dedup
ALTER TABLE cards ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMP;
