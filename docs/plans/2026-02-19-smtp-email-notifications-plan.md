# SMTP Email Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add SMTP email configuration, a DB-backed email queue, expanded notification types, and per-user email notification preferences.

**Architecture:** SMTP settings stored encrypted in `app_settings`, emails queued to a PostgreSQL `email_queue` table and processed by a server-side interval. Each notification event checks user preferences before queueing. A shared `createNotification()` helper centralizes notification creation, socket emit, pref check, and email queueing.

**Tech Stack:** nodemailer (email sending), existing Express/PostgreSQL/Socket.io stack, existing AES-256-GCM crypto util.

---

### Task 1: Install nodemailer and create migration 016

**Files:**
- Modify: `server/package.json`
- Create: `server/src/migrations/016-email-notifications.sql`

**Step 1: Install nodemailer**

Run: `cd /home/bradley/cork/server && npm install nodemailer && npm install -D @types/nodemailer`

**Step 2: Create migration file**

Create `server/src/migrations/016-email-notifications.sql`:

```sql
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
```

**Step 3: Commit**

```bash
git add server/package.json server/package-lock.json server/src/migrations/016-email-notifications.sql
git commit -m "feat: add migration 016 for email queue, notification prefs, and nodemailer"
```

---

### Task 2: Create email service (transporter + queue processor)

**Files:**
- Create: `server/src/services/emailService.ts`

**Step 1: Create the services directory and email service**

Create `server/src/services/emailService.ts`:

```typescript
import nodemailer from 'nodemailer';
import pool from '../db';
import { decrypt } from '../utils/crypto';

let transporter: nodemailer.Transporter | null = null;

// Load SMTP config from app_settings and create transporter
export async function initTransporter(): Promise<boolean> {
  try {
    const result = await pool.query(
      "SELECT key, value FROM app_settings WHERE key LIKE 'smtp_%'"
    );
    const settings: Record<string, any> = {};
    result.rows.forEach((row: any) => { settings[row.key] = row.value; });

    const host = settings.smtp_host;
    const port = settings.smtp_port || 587;
    const from = settings.smtp_from_address;

    if (!host || !from) {
      transporter = null;
      return false;
    }

    const auth = settings.smtp_username ? {
      user: settings.smtp_username,
      pass: settings.smtp_password ? decrypt(settings.smtp_password) : undefined,
    } : undefined;

    transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: settings.smtp_tls !== false, // default true
      auth,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    return true;
  } catch (err) {
    console.error('Failed to init SMTP transporter:', err);
    transporter = null;
    return false;
  }
}

// Re-init transporter (called when admin updates SMTP settings)
export async function refreshTransporter(): Promise<boolean> {
  return initTransporter();
}

// Get the "from" address from settings
async function getFromAddress(): Promise<string | null> {
  try {
    const result = await pool.query(
      "SELECT value FROM app_settings WHERE key = 'smtp_from_address'"
    );
    return result.rows[0]?.value || null;
  } catch {
    return null;
  }
}

// Queue an email for sending
export async function queueEmail(
  toEmail: string,
  subject: string,
  bodyHtml: string,
  notificationId?: string
): Promise<void> {
  if (!transporter) return; // SMTP not configured
  try {
    await pool.query(
      `INSERT INTO email_queue (to_email, subject, body_html, notification_id)
       VALUES ($1, $2, $3, $4)`,
      [toEmail, subject, bodyHtml, notificationId || null]
    );
  } catch (err) {
    console.error('Failed to queue email:', err);
  }
}

// Send a test email immediately (not queued)
export async function sendTestEmail(toEmail: string): Promise<{ success: boolean; error?: string }> {
  if (!transporter) {
    return { success: false, error: 'SMTP not configured' };
  }
  const from = await getFromAddress();
  if (!from) {
    return { success: false, error: 'From address not configured' };
  }
  try {
    await transporter.sendMail({
      from,
      to: toEmail,
      subject: 'Plank - SMTP Test',
      html: '<h2>SMTP is working!</h2><p>Your Plank email notifications are configured correctly.</p>',
    });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to send test email' };
  }
}

// Process the email queue (called by interval)
export async function processEmailQueue(): Promise<void> {
  if (!transporter) return;

  const from = await getFromAddress();
  if (!from) return;

  try {
    // Grab up to 10 pending emails that are ready
    const result = await pool.query(
      `SELECT * FROM email_queue
       WHERE status = 'pending' AND next_attempt_at <= NOW()
       ORDER BY created_at ASC
       LIMIT 10`
    );

    for (const email of result.rows) {
      try {
        await transporter.sendMail({
          from,
          to: email.to_email,
          subject: email.subject,
          html: email.body_html,
        });
        await pool.query(
          "UPDATE email_queue SET status = 'sent' WHERE id = $1",
          [email.id]
        );
      } catch (err: any) {
        const attempts = email.attempts + 1;
        if (attempts >= 3) {
          await pool.query(
            "UPDATE email_queue SET status = 'failed', attempts = $2, error = $3 WHERE id = $1",
            [email.id, attempts, err.message || 'Unknown error']
          );
        } else {
          // Backoff: 1m, 5m, 30m
          const backoffMinutes = [1, 5, 30][attempts - 1];
          await pool.query(
            `UPDATE email_queue SET attempts = $2, error = $3,
             next_attempt_at = NOW() + INTERVAL '${backoffMinutes} minutes'
             WHERE id = $1`,
            [email.id, attempts, err.message || 'Unknown error']
          );
        }
      }
    }
  } catch (err) {
    console.error('Email queue processing error:', err);
  }
}

export function isSmtpConfigured(): boolean {
  return transporter !== null;
}
```

**Step 2: Commit**

```bash
git add server/src/services/emailService.ts
git commit -m "feat: add email service with queue processing and SMTP transporter"
```

---

### Task 3: Create email templates

**Files:**
- Create: `server/src/services/emailTemplates.ts`

**Step 1: Create email templates**

Create `server/src/services/emailTemplates.ts`:

```typescript
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:5173';

function baseTemplate(content: string, preferencesLink: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:8px;border:1px solid #e2e4e9;">
        <tr><td style="padding:24px 28px 0;">
          <div style="font-size:13px;font-weight:700;color:#6b7280;letter-spacing:0.02em;margin-bottom:16px;">PLANK</div>
        </td></tr>
        <tr><td style="padding:0 28px 24px;">
          ${content}
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #e2e4e9;">
          <div style="font-size:11px;color:#9ca3af;line-height:1.5;">
            You received this because of your notification settings.
            <a href="${preferencesLink}" style="color:#6b7280;">Manage preferences</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function viewCardButton(boardSlug: string): string {
  const url = `${APP_BASE_URL}/${boardSlug}`;
  return `<a href="${url}" style="display:inline-block;padding:10px 20px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;margin-top:16px;">View Card</a>`;
}

const preferencesUrl = `${APP_BASE_URL}/profile`;

interface TemplateContext {
  actorUsername: string;
  cardTitle: string;
  boardName: string;
  boardSlug?: string;
  commentText?: string;
  dueDate?: string;
}

export function assignedCardEmail(ctx: TemplateContext): { subject: string; html: string } {
  const slug = ctx.boardSlug || '';
  return {
    subject: `[${ctx.boardName}] You were added to "${ctx.cardTitle}"`,
    html: baseTemplate(`
      <p style="margin:0 0 8px;font-size:14px;color:#1f2937;line-height:1.5;">
        <strong>${ctx.actorUsername}</strong> added you to <strong>${ctx.cardTitle}</strong> in <strong>${ctx.boardName}</strong>.
      </p>
      ${viewCardButton(slug)}
    `, preferencesUrl),
  };
}

export function mentionCommentEmail(ctx: TemplateContext): { subject: string; html: string } {
  const slug = ctx.boardSlug || '';
  return {
    subject: `[${ctx.boardName}] @${ctx.actorUsername} mentioned you on "${ctx.cardTitle}"`,
    html: baseTemplate(`
      <p style="margin:0 0 8px;font-size:14px;color:#1f2937;line-height:1.5;">
        <strong>@${ctx.actorUsername}</strong> mentioned you on <strong>${ctx.cardTitle}</strong> in <strong>${ctx.boardName}</strong>.
      </p>
      ${ctx.commentText ? `<div style="margin:12px 0;padding:12px 16px;background:#f9fafb;border-left:3px solid #d1d5db;border-radius:4px;font-size:13px;color:#4b5563;line-height:1.5;">${ctx.commentText}</div>` : ''}
      ${viewCardButton(slug)}
    `, preferencesUrl),
  };
}

export function dueDateReminderEmail(ctx: TemplateContext): { subject: string; html: string } {
  const slug = ctx.boardSlug || '';
  return {
    subject: `[${ctx.boardName}] "${ctx.cardTitle}" is due tomorrow`,
    html: baseTemplate(`
      <p style="margin:0 0 8px;font-size:14px;color:#1f2937;line-height:1.5;">
        <strong>${ctx.cardTitle}</strong> in <strong>${ctx.boardName}</strong> is due <strong>${ctx.dueDate || 'tomorrow'}</strong>.
      </p>
      ${viewCardButton(slug)}
    `, preferencesUrl),
  };
}

export function cardCompletedEmail(ctx: TemplateContext): { subject: string; html: string } {
  const slug = ctx.boardSlug || '';
  return {
    subject: `[${ctx.boardName}] "${ctx.cardTitle}" was marked complete`,
    html: baseTemplate(`
      <p style="margin:0 0 8px;font-size:14px;color:#1f2937;line-height:1.5;">
        <strong>${ctx.actorUsername}</strong> moved <strong>${ctx.cardTitle}</strong> to done in <strong>${ctx.boardName}</strong>.
      </p>
      ${viewCardButton(slug)}
    `, preferencesUrl),
  };
}

export function commentAddedEmail(ctx: TemplateContext): { subject: string; html: string } {
  const slug = ctx.boardSlug || '';
  return {
    subject: `[${ctx.boardName}] @${ctx.actorUsername} commented on "${ctx.cardTitle}"`,
    html: baseTemplate(`
      <p style="margin:0 0 8px;font-size:14px;color:#1f2937;line-height:1.5;">
        <strong>${ctx.actorUsername}</strong> commented on <strong>${ctx.cardTitle}</strong> in <strong>${ctx.boardName}</strong>.
      </p>
      ${ctx.commentText ? `<div style="margin:12px 0;padding:12px 16px;background:#f9fafb;border-left:3px solid #d1d5db;border-radius:4px;font-size:13px;color:#4b5563;line-height:1.5;">${ctx.commentText}</div>` : ''}
      ${viewCardButton(slug)}
    `, preferencesUrl),
  };
}

export function checklistAssignedEmail(ctx: TemplateContext): { subject: string; html: string } {
  const slug = ctx.boardSlug || '';
  return {
    subject: `[${ctx.boardName}] A subtask was assigned to you on "${ctx.cardTitle}"`,
    html: baseTemplate(`
      <p style="margin:0 0 8px;font-size:14px;color:#1f2937;line-height:1.5;">
        <strong>${ctx.actorUsername}</strong> assigned you a subtask on <strong>${ctx.cardTitle}</strong> in <strong>${ctx.boardName}</strong>.
      </p>
      ${viewCardButton(slug)}
    `, preferencesUrl),
  };
}

export function descriptionChangedEmail(ctx: TemplateContext): { subject: string; html: string } {
  const slug = ctx.boardSlug || '';
  return {
    subject: `[${ctx.boardName}] "${ctx.cardTitle}" description was updated`,
    html: baseTemplate(`
      <p style="margin:0 0 8px;font-size:14px;color:#1f2937;line-height:1.5;">
        <strong>${ctx.actorUsername}</strong> updated the description of <strong>${ctx.cardTitle}</strong> in <strong>${ctx.boardName}</strong>.
      </p>
      ${viewCardButton(slug)}
    `, preferencesUrl),
  };
}
```

**Step 2: Commit**

```bash
git add server/src/services/emailTemplates.ts
git commit -m "feat: add email templates for all 7 notification types"
```

---

### Task 4: Create notification helper

This shared helper replaces the duplicated notification creation logic currently scattered across `comments.ts` and `cardMembers.ts`.

**Files:**
- Create: `server/src/services/notificationHelper.ts`

**Step 1: Create the notification helper**

Create `server/src/services/notificationHelper.ts`:

```typescript
import pool from '../db';
import { queueEmail, isSmtpConfigured } from './emailService';
import {
  assignedCardEmail,
  mentionCommentEmail,
  dueDateReminderEmail,
  cardCompletedEmail,
  commentAddedEmail,
  checklistAssignedEmail,
  descriptionChangedEmail,
} from './emailTemplates';

// Map notification type to the preference column name
const PREF_COLUMN_MAP: Record<string, string> = {
  assigned_card: 'email_assigned_card',
  mention_comment: 'email_mention_comment',
  due_date_reminder: 'email_due_date_reminder',
  card_completed: 'email_card_completed',
  comment_added: 'email_comment_added',
  checklist_assigned: 'email_checklist_assigned',
  description_changed: 'email_description_changed',
};

// Map notification type to email template function
const TEMPLATE_MAP: Record<string, (ctx: any) => { subject: string; html: string }> = {
  assigned_card: assignedCardEmail,
  mention_comment: mentionCommentEmail,
  due_date_reminder: dueDateReminderEmail,
  card_completed: cardCompletedEmail,
  comment_added: commentAddedEmail,
  checklist_assigned: checklistAssignedEmail,
  description_changed: descriptionChangedEmail,
};

interface NotificationParams {
  userId: string;         // recipient
  type: string;           // notification type
  cardId: string;
  boardId: string;
  actorId: string;        // who triggered it
  actorUsername: string;
  detail: Record<string, any>;
  io?: any;               // socket.io instance
  userSockets?: Map<string, string[]>;
}

// Get board slug for email links
async function getBoardSlug(boardId: string): Promise<string> {
  try {
    const result = await pool.query(
      "SELECT name FROM boards WHERE id = $1",
      [boardId]
    );
    if (result.rows.length > 0) {
      return result.rows[0].name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }
  } catch {}
  return '';
}

export async function createNotification(params: NotificationParams): Promise<void> {
  const { userId, type, cardId, boardId, actorId, actorUsername, detail, io, userSockets } = params;

  // Don't notify yourself
  if (userId === actorId) return;

  try {
    // 1. Insert notification into DB
    const notif = await pool.query(
      `INSERT INTO notifications (user_id, type, card_id, board_id, actor_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, type, cardId, boardId, actorId, JSON.stringify(detail)]
    );

    const notifRow = notif.rows[0];

    // 2. Emit via socket
    if (io && userSockets) {
      const sockets = userSockets.get(userId);
      if (sockets) {
        for (const sid of sockets) {
          io.to(sid).emit('notification:new', {
            ...notifRow,
            actor_username: actorUsername,
          });
        }
      }
    }

    // 3. Queue email if SMTP configured and user wants it
    if (isSmtpConfigured()) {
      const prefColumn = PREF_COLUMN_MAP[type];
      if (!prefColumn) return;

      // Get user email and preference
      const userResult = await pool.query(
        `SELECT u.email, COALESCE(p.${prefColumn}, ${
          ['email_assigned_card', 'email_mention_comment', 'email_due_date_reminder', 'email_checklist_assigned'].includes(prefColumn) ? 'TRUE' : 'FALSE'
        }) as wants_email
         FROM users u
         LEFT JOIN user_notification_preferences p ON u.id = p.user_id
         WHERE u.id = $1`,
        [userId]
      );

      const user = userResult.rows[0];
      if (user?.email && user.wants_email) {
        const boardSlug = await getBoardSlug(boardId);
        const boardName = detail.board_name || '';

        const templateFn = TEMPLATE_MAP[type];
        if (templateFn) {
          const { subject, html } = templateFn({
            actorUsername,
            cardTitle: detail.card_title || 'a card',
            boardName,
            boardSlug,
            commentText: detail.comment_text,
            dueDate: detail.due_date,
          });
          await queueEmail(user.email, subject, html, notifRow.id);
        }
      }
    }
  } catch (err) {
    console.error('Failed to create notification:', err);
  }
}

// Convenience: create notifications for all members of a card (except actor)
export async function notifyCardMembers(
  cardId: string,
  type: string,
  actorId: string,
  actorUsername: string,
  detail: Record<string, any>,
  io?: any,
  userSockets?: Map<string, string[]>,
  excludeUserIds?: string[]
): Promise<void> {
  try {
    // Get card's board_id and board_name
    const cardInfo = await pool.query(
      `SELECT c.title, col.board_id, b.name as board_name
       FROM cards c
       JOIN columns col ON c.column_id = col.id
       JOIN boards b ON col.board_id = b.id
       WHERE c.id = $1`,
      [cardId]
    );
    if (cardInfo.rows.length === 0) return;

    const { board_id, board_name, title } = cardInfo.rows[0];
    const fullDetail = { ...detail, card_title: title, board_name };

    // Get card members
    const members = await pool.query(
      'SELECT user_id FROM card_members WHERE card_id = $1',
      [cardId]
    );

    const exclude = new Set([actorId, ...(excludeUserIds || [])]);

    for (const member of members.rows) {
      if (exclude.has(member.user_id)) continue;
      await createNotification({
        userId: member.user_id,
        type,
        cardId,
        boardId: board_id,
        actorId,
        actorUsername,
        detail: fullDetail,
        io,
        userSockets,
      });
    }
  } catch (err) {
    console.error('Failed to notify card members:', err);
  }
}
```

**Step 2: Commit**

```bash
git add server/src/services/notificationHelper.ts
git commit -m "feat: add notification helper with email queueing and card member notifications"
```

---

### Task 5: Create notification preferences API route

**Files:**
- Create: `server/src/routes/notificationPreferences.ts`

**Step 1: Create the route**

Create `server/src/routes/notificationPreferences.ts`:

```typescript
import { Router } from 'express';
import pool from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

const PREF_COLUMNS = [
  'email_assigned_card',
  'email_mention_comment',
  'email_due_date_reminder',
  'email_card_completed',
  'email_comment_added',
  'email_checklist_assigned',
  'email_description_changed',
];

// GET /api/notifications/preferences
router.get('/preferences', authenticate, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM user_notification_preferences WHERE user_id = $1',
      [req.user!.id]
    );

    if (result.rows.length === 0) {
      // Return defaults (don't create row until they save)
      return res.json({
        email_assigned_card: true,
        email_mention_comment: true,
        email_due_date_reminder: true,
        email_card_completed: false,
        email_comment_added: false,
        email_checklist_assigned: true,
        email_description_changed: false,
      });
    }

    const prefs = result.rows[0];
    delete prefs.user_id;
    res.json(prefs);
  } catch (error) {
    console.error('Get notification preferences error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/notifications/preferences
router.put('/preferences', authenticate, async (req: AuthRequest, res) => {
  try {
    const updates: Record<string, boolean> = {};
    for (const col of PREF_COLUMNS) {
      if (req.body[col] !== undefined) {
        updates[col] = Boolean(req.body[col]);
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid preferences provided' });
    }

    // Upsert
    const setClauses = PREF_COLUMNS.map(col =>
      `${col} = COALESCE($${PREF_COLUMNS.indexOf(col) + 2}, ${col})`
    ).join(', ');

    const values = PREF_COLUMNS.map(col => updates[col] ?? null);

    await pool.query(
      `INSERT INTO user_notification_preferences (user_id, ${PREF_COLUMNS.join(', ')})
       VALUES ($1, ${PREF_COLUMNS.map((col, i) => `COALESCE($${i + 2}, ${
         ['email_assigned_card', 'email_mention_comment', 'email_due_date_reminder', 'email_checklist_assigned'].includes(col) ? 'TRUE' : 'FALSE'
       })`).join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${setClauses}`,
      [req.user!.id, ...values]
    );

    // Return updated prefs
    const result = await pool.query(
      'SELECT * FROM user_notification_preferences WHERE user_id = $1',
      [req.user!.id]
    );
    const prefs = result.rows[0];
    delete prefs.user_id;
    res.json(prefs);
  } catch (error) {
    console.error('Update notification preferences error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
```

**Step 2: Commit**

```bash
git add server/src/routes/notificationPreferences.ts
git commit -m "feat: add notification preferences API (GET/PUT)"
```

---

### Task 6: Update SMTP admin settings (appSettings + GeneralSettings)

**Files:**
- Modify: `server/src/routes/appSettings.ts`
- Modify: `client/src/components/GeneralSettings.tsx`
- Modify: `client/src/api.ts`

**Step 1: Update appSettings.ts to support SMTP keys with encryption**

Replace the entire content of `server/src/routes/appSettings.ts`:

```typescript
import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { encrypt, decrypt } from '../utils/crypto';
import { refreshTransporter, sendTestEmail } from '../services/emailService';

const router = Router();

const ALLOWED_KEYS = [
  'registration_enabled',
  'smtp_host',
  'smtp_port',
  'smtp_username',
  'smtp_password',
  'smtp_from_address',
  'smtp_tls',
];

const ENCRYPTED_KEYS = ['smtp_password'];

// GET / — Get all app settings (admin only)
router.get('/', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM app_settings');

    const settings: Record<string, any> = {};
    result.rows.forEach((row: any) => {
      if (ENCRYPTED_KEYS.includes(row.key) && row.value) {
        // Mask encrypted values
        settings[row.key] = '••••••••';
      } else {
        settings[row.key] = row.value;
      }
    });

    res.json(settings);
  } catch (error) {
    console.error('Get app settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /:key — Update a setting (admin only)
router.put('/:key', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (!ALLOWED_KEYS.includes(key)) {
      return res.status(400).json({ error: `Unknown setting: ${key}` });
    }

    if (value === undefined || value === null) {
      return res.status(400).json({ error: 'Value is required' });
    }

    let storeValue = value;
    if (ENCRYPTED_KEYS.includes(key) && value && value !== '••••••••') {
      storeValue = encrypt(value);
    } else if (ENCRYPTED_KEYS.includes(key) && value === '••••••••') {
      // Don't update if masked value sent back
      return res.json({ key, value: '••••••••' });
    }

    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = CURRENT_TIMESTAMP`,
      [key, JSON.stringify(storeValue)]
    );

    // Refresh SMTP transporter when any smtp_ key changes
    if (key.startsWith('smtp_')) {
      await refreshTransporter();
    }

    res.json({ key, value: ENCRYPTED_KEYS.includes(key) ? '••••••••' : value });
  } catch (error) {
    console.error('Update app setting error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /smtp-test — Send test email (admin only)
router.post('/smtp-test', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { to } = req.body;
    if (!to) {
      return res.status(400).json({ error: 'Recipient email (to) is required' });
    }
    const result = await sendTestEmail(to);
    if (result.success) {
      res.json({ message: 'Test email sent successfully' });
    } else {
      res.status(400).json({ error: result.error || 'Failed to send test email' });
    }
  } catch (error) {
    console.error('SMTP test error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
```

**Step 2: Add SMTP and notification prefs API methods to `client/src/api.ts`**

Add these methods to the `ApiClient` class in `client/src/api.ts`, after the existing `updateAppSetting` method (around line 383):

```typescript
  // SMTP Test
  async testSmtp(to: string): Promise<{ message: string }> {
    return this.fetch('/app-settings/smtp-test', {
      method: 'POST',
      body: JSON.stringify({ to }),
    });
  }

  // Notification Preferences
  async getNotificationPreferences(): Promise<Record<string, boolean>> {
    return this.fetch('/notifications/preferences');
  }

  async updateNotificationPreferences(prefs: Record<string, boolean>): Promise<Record<string, boolean>> {
    return this.fetch('/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(prefs),
    });
  }

  // SMTP status (for non-admin users to check if email is available)
  async getSmtpStatus(): Promise<{ configured: boolean }> {
    return this.fetch('/app-settings/smtp-status');
  }
```

Also add a public endpoint for SMTP status in `server/src/routes/appSettings.ts` (add before the export):

```typescript
// GET /smtp-status — Check if SMTP is configured (any authenticated user)
router.get('/smtp-status', authenticate, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      "SELECT value FROM app_settings WHERE key = 'smtp_host'"
    );
    const configured = result.rows.length > 0 && !!result.rows[0].value;
    res.json({ configured });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Step 3: Activate the SMTP form in GeneralSettings.tsx**

Replace the entire `GeneralSettings.tsx` with a working SMTP config form. The key changes:
- Remove `settings-card-disabled` class and `disabled` attribute from SMTP inputs
- Remove "Coming soon" pill
- Add Password field
- Add TLS toggle
- Add "Test Connection" button
- Wire up state management and API calls to save each setting individually

The component should load SMTP settings from `api.getAppSettings()` and save each field via `api.updateAppSetting()`. The password field shows `••••••••` when a password is set. The test button calls `api.testSmtp()` with a user-provided email address.

**Step 4: Commit**

```bash
git add server/src/routes/appSettings.ts client/src/api.ts client/src/components/GeneralSettings.tsx
git commit -m "feat: activate SMTP configuration in admin settings with encrypted password"
```

---

### Task 7: Add notification preferences UI to ProfileSettings

**Files:**
- Modify: `client/src/components/ProfileSettings.tsx`
- Modify: `client/src/index.css`

**Step 1: Add Email Notifications section to ProfileSettings**

Add a new section after the 2FA section (after line 228, before the closing `</div>`s). The section should:
- Fetch SMTP status via `api.getSmtpStatus()` on mount
- Fetch notification preferences via `api.getNotificationPreferences()` on mount
- Show a banner if SMTP is not configured: "Email notifications are not configured by your admin" with all toggles disabled
- Show 7 toggle rows using the existing `.settings-card` / `.setting-row` / `.toggle-switch` CSS classes
- Each toggle calls `api.updateNotificationPreferences({ [key]: newValue })` on change

The 7 toggles with labels and descriptions:
1. **Assigned to card** — "When someone adds you to a card" (default: on)
2. **Mentioned in comment** — "When someone @mentions you in a comment" (default: on)
3. **Due date reminder** — "24 hours before a card you're on is due" (default: on)
4. **Card completed** — "When a card you're on is moved to done" (default: off)
5. **New comment** — "When someone comments on a card you're on" (default: off)
6. **Subtask assigned** — "When a checklist item is assigned to you" (default: on)
7. **Description updated** — "When a card you're on has its description changed" (default: off)

**Step 2: Add CSS for the notification preferences section**

Add to `client/src/index.css` after the existing profile settings styles. Reuse existing `.settings-card`, `.setting-row`, `.toggle-switch` classes. Add:

```css
.notification-prefs-banner {
  padding: 12px 16px;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}
```

**Step 3: Commit**

```bash
git add client/src/components/ProfileSettings.tsx client/src/index.css
git commit -m "feat: add email notification preferences UI in profile settings"
```

---

### Task 8: Wire up notification triggers in routes

This is the core integration task. Update all the route files to use `createNotification` / `notifyCardMembers` instead of inline notification code, and add the new notification types.

**Files:**
- Modify: `server/src/routes/cardMembers.ts`
- Modify: `server/src/routes/comments.ts`
- Modify: `server/src/routes/cards.ts`
- Modify: `server/src/routes/checklists.ts`

**Step 1: Update cardMembers.ts**

Replace the existing inline notification code (lines 71-103) with:

```typescript
import { createNotification } from '../services/notificationHelper';

// ... in the PUT handler, after logging activity, replace the notification block:

// Create notifications for added members
if (added.length > 0) {
  const io = req.app.get('io');
  const userSockets: Map<string, string[]> = req.app.get('userSockets');
  const cardInfo = await pool.query(
    `SELECT c.title, col.board_id, b.name as board_name
     FROM cards c JOIN columns col ON c.column_id = col.id
     JOIN boards b ON col.board_id = b.id
     WHERE c.id = $1`,
    [cardId]
  );
  if (cardInfo.rows.length > 0) {
    const { title, board_id, board_name } = cardInfo.rows[0];
    for (const userId of added) {
      await createNotification({
        userId,
        type: 'assigned_card',
        cardId,
        boardId: board_id,
        actorId: req.user!.id,
        actorUsername: req.user!.username,
        detail: { card_title: title, board_name },
        io,
        userSockets,
      });
    }
  }
}
```

**Step 2: Update comments.ts**

Replace the inline @mention notification code (lines 50-101) with:

```typescript
import { createNotification, notifyCardMembers } from '../services/notificationHelper';

// ... after inserting the comment, replace the mentions block:

const commentText = comment.rows[0].text;
const io = req.app.get('io');
const userSockets: Map<string, string[]> = req.app.get('userSockets');

// Get card info
const cardInfo = await pool.query(
  `SELECT c.title, col.board_id, b.name as board_name
   FROM cards c JOIN columns col ON c.column_id = col.id
   JOIN boards b ON col.board_id = b.id
   WHERE c.id = $1`,
  [cardId]
);

if (cardInfo.rows.length > 0) {
  const { title: cardTitle, board_id, board_name } = cardInfo.rows[0];

  // 1. Notify @mentioned users
  const mentions = [...commentText.matchAll(/@(\w+)/g)].map((m: RegExpMatchArray) => m[1]);
  const mentionedUserIds = new Set<string>();

  if (mentions.length > 0) {
    const boardMembers = await pool.query(
      `SELECT DISTINCT u.id, u.username FROM users u
       LEFT JOIN board_members bm ON u.id = bm.user_id AND bm.board_id = $1
       WHERE u.role = 'ADMIN' OR bm.board_id = $1`,
      [board_id]
    );
    const memberMap = new Map<string, string>();
    boardMembers.rows.forEach((m: any) => memberMap.set(m.username.toLowerCase(), m.id));

    for (const mention of mentions) {
      const memberId = memberMap.get(mention.toLowerCase());
      if (memberId && memberId !== req.user!.id) {
        mentionedUserIds.add(memberId);
        await createNotification({
          userId: memberId,
          type: 'mention_comment',
          cardId,
          boardId: board_id,
          actorId: req.user!.id,
          actorUsername: req.user!.username,
          detail: { card_title: cardTitle, board_name, comment_text: commentText.substring(0, 200) },
          io,
          userSockets,
        });
      }
    }
  }

  // 2. Notify card members about new comment (excluding commenter and already-mentioned users)
  await notifyCardMembers(
    cardId,
    'comment_added',
    req.user!.id,
    req.user!.username,
    { comment_text: commentText.substring(0, 200) },
    io,
    userSockets,
    [...mentionedUserIds]  // exclude already-notified mention recipients
  );
}
```

**Step 3: Update cards.ts to add card_completed and description_changed notifications**

In `server/src/routes/cards.ts`, after the activity logging section (around line 169), add:

```typescript
import { notifyCardMembers } from '../services/notificationHelper';

// ... after the description_changed activity log:
if (description !== undefined && (description || null) !== (old.description || null)) {
  logActivity(id, req.user!.id, 'description_changed');
  // Notify card members
  const io = req.app.get('io');
  const userSockets: Map<string, string[]> = req.app.get('userSockets');
  notifyCardMembers(id, 'description_changed', req.user!.id, req.user!.username, {}, io, userSockets);
}

// ... after the column move activity log, detect "done" column:
if (column_id !== undefined && column_id !== old.column_id) {
  // ... existing activity logging ...

  // Check if moved to last (rightmost) column = "done"
  const colPositions = await pool.query(
    'SELECT id, position FROM columns WHERE board_id = (SELECT board_id FROM columns WHERE id = $1) ORDER BY position DESC LIMIT 1',
    [column_id]
  );
  if (colPositions.rows.length > 0 && colPositions.rows[0].id === column_id) {
    const io = req.app.get('io');
    const userSockets: Map<string, string[]> = req.app.get('userSockets');
    notifyCardMembers(id, 'card_completed', req.user!.id, req.user!.username, {}, io, userSockets);
  }
}
```

**Step 4: Update checklists.ts to add checklist_assigned notification**

In the PUT handler of `server/src/routes/checklists.ts`, after updating the checklist item, add:

```typescript
import { createNotification } from '../services/notificationHelper';

// ... after the UPDATE query returns, if assignee_name was changed:
if (assignee_name !== undefined && assignee_name) {
  // Look up user by username (assignee_name is a username string)
  const assignee = await pool.query(
    'SELECT id FROM users WHERE username = $1',
    [assignee_name]
  );
  if (assignee.rows.length > 0) {
    const assigneeUserId = assignee.rows[0].id;
    // Get card info
    const item = result.rows[0];
    const cardInfo = await pool.query(
      `SELECT c.title, col.board_id, b.name as board_name
       FROM cards c JOIN columns col ON c.column_id = col.id
       JOIN boards b ON col.board_id = b.id
       WHERE c.id = $1`,
      [item.card_id]
    );
    if (cardInfo.rows.length > 0) {
      const { title, board_id, board_name } = cardInfo.rows[0];
      const io = req.app.get('io');
      const userSockets: Map<string, string[]> = req.app.get('userSockets');
      await createNotification({
        userId: assigneeUserId,
        type: 'checklist_assigned',
        cardId: item.card_id,
        boardId: board_id,
        actorId: req.user!.id,
        actorUsername: req.user!.username,
        detail: { card_title: title, board_name },
        io,
        userSockets,
      });
    }
  }
}
```

**Step 5: Commit**

```bash
git add server/src/routes/cardMembers.ts server/src/routes/comments.ts server/src/routes/cards.ts server/src/routes/checklists.ts
git commit -m "feat: wire up all 7 notification types with email queueing"
```

---

### Task 9: Update server index.ts (mount routes, start intervals)

**Files:**
- Modify: `server/src/index.ts`

**Step 1: Add imports and mount routes**

Add at top of `server/src/index.ts`:
```typescript
import notificationPreferencesRoutes from './routes/notificationPreferences';
import { initTransporter, processEmailQueue } from './services/emailService';
```

Mount the preferences route (alongside existing notification routes):
```typescript
app.use('/api/notifications', notificationPreferencesRoutes);
```

Note: This must be mounted BEFORE the existing `app.use('/api/notifications', notificationRoutes)` so that `/api/notifications/preferences` matches before the catch-all `/:id/read` route. Or alternatively, mount on the same router.

Actually, better approach: merge the preferences routes into the existing notifications router mount. Since the preferences route uses `/preferences` path and existing routes use `/`, `/:id/read`, and `/read-all`, just mount both on `/api/notifications`:

```typescript
app.use('/api/notifications', notificationPreferencesRoutes);
app.use('/api/notifications', notificationRoutes);
```

**Step 2: Start intervals in the server startup**

In the `httpServer.listen` callback, after migrations and seed:

```typescript
httpServer.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  try {
    await runMigrations();
    await seedBuiltinTemplates();
    await initTransporter();
  } catch (err) {
    console.error('Startup tasks failed:', err);
  }

  // Email queue processor — every 30 seconds
  setInterval(processEmailQueue, 30_000);

  // Due date reminder checker — every 15 minutes
  setInterval(checkDueDateReminders, 15 * 60_000);
});
```

**Step 3: Add due date reminder function**

Add to `server/src/index.ts` (or create a separate file and import):

```typescript
import { queueEmail, isSmtpConfigured } from './services/emailService';
import { dueDateReminderEmail } from './services/emailTemplates';
import { createNotification } from './services/notificationHelper';

async function checkDueDateReminders() {
  if (!isSmtpConfigured()) return;

  try {
    // Find cards due within 24 hours that haven't been reminded
    const result = await pool.query(
      `SELECT c.id, c.title, c.due_date, col.board_id, b.name as board_name
       FROM cards c
       JOIN columns col ON c.column_id = col.id
       JOIN boards b ON col.board_id = b.id
       WHERE c.due_date IS NOT NULL
         AND c.due_date <= CURRENT_DATE + INTERVAL '1 day'
         AND c.due_date >= CURRENT_DATE
         AND c.reminded_at IS NULL
         AND c.archived = FALSE`
    );

    for (const card of result.rows) {
      // Mark as reminded first to prevent duplicates
      await pool.query('UPDATE cards SET reminded_at = NOW() WHERE id = $1', [card.id]);

      // Get card members
      const members = await pool.query(
        'SELECT cm.user_id FROM card_members cm WHERE cm.card_id = $1',
        [card.id]
      );

      for (const member of members.rows) {
        await createNotification({
          userId: member.user_id,
          type: 'due_date_reminder',
          cardId: card.id,
          boardId: card.board_id,
          actorId: member.user_id, // self — actorId won't be shown for reminders
          actorUsername: 'Plank',
          detail: {
            card_title: card.title,
            board_name: card.board_name,
            due_date: card.due_date,
          },
          io,
          userSockets,
        });
      }
    }
  } catch (err) {
    console.error('Due date reminder check failed:', err);
  }
}
```

Note: The due date reminder uses `actorId: member.user_id` (self) which means `createNotification` would skip it due to the self-check. We need to handle this: for `due_date_reminder` type, the actor IS the system, so we should either skip the self-check for this type or use a special system actor ID. Simplest: modify `createNotification` to skip the self-check when `type === 'due_date_reminder'`.

**Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: mount notification prefs route, start email queue and due date reminder intervals"
```

---

### Task 10: Update client types and NotificationBell

**Files:**
- Modify: `client/src/types.ts`
- Modify: `client/src/components/NotificationBell.tsx`

**Step 1: Expand Notification type in types.ts**

Update the `type` field in the Notification interface (line 84):

```typescript
type: 'assigned_card' | 'mention_card' | 'mention_comment' | 'due_date_reminder' | 'card_completed' | 'comment_added' | 'checklist_assigned' | 'description_changed';
```

Note: Keep `mention_card` for backward compat with existing notifications in DB.

**Step 2: Update getNotificationText in NotificationBell.tsx**

Replace the `getNotificationText` function (lines 49-55):

```typescript
const getNotificationText = (notif: Notification) => {
  const cardTitle = notif.detail?.card_title || 'a card';
  switch (notif.type) {
    case 'assigned_card':
    case 'mention_card': // legacy
      return { action: 'added you to', target: cardTitle };
    case 'mention_comment':
      return { action: 'mentioned you on', target: cardTitle };
    case 'due_date_reminder':
      return { action: 'reminder:', target: `${cardTitle} is due soon` };
    case 'card_completed':
      return { action: 'completed', target: cardTitle };
    case 'comment_added':
      return { action: 'commented on', target: cardTitle };
    case 'checklist_assigned':
      return { action: 'assigned you a subtask on', target: cardTitle };
    case 'description_changed':
      return { action: 'updated description of', target: cardTitle };
    default:
      return { action: 'updated', target: cardTitle };
  }
};
```

**Step 3: Commit**

```bash
git add client/src/types.ts client/src/components/NotificationBell.tsx
git commit -m "feat: expand notification types in client with display text for all 7 types"
```

---

### Task 11: Build and verify

**Step 1: Build server**

Run: `cd /home/bradley/cork/server && npm run build`

Fix any TypeScript errors.

**Step 2: Build client**

Run: `cd /home/bradley/cork/client && npm run build`

Fix any TypeScript errors.

**Step 3: Verify migration runs**

Run: `cd /home/bradley/cork/server && npm run migrate`

Verify the output shows migration 016 executed without errors.

**Step 4: Final commit and push**

```bash
git add -A
git commit -m "fix: resolve build errors from email notification integration"
git push
```

---

### Task Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Install nodemailer + migration 016 | package.json, 016-email-notifications.sql |
| 2 | Email service (transporter + queue) | services/emailService.ts |
| 3 | Email templates (7 types) | services/emailTemplates.ts |
| 4 | Notification helper (shared) | services/notificationHelper.ts |
| 5 | Notification preferences API | routes/notificationPreferences.ts |
| 6 | SMTP admin settings | routes/appSettings.ts, GeneralSettings.tsx, api.ts |
| 7 | User notification prefs UI | ProfileSettings.tsx, index.css |
| 8 | Wire up notification triggers | cardMembers.ts, comments.ts, cards.ts, checklists.ts |
| 9 | Server startup (routes, intervals) | index.ts |
| 10 | Client types + NotificationBell | types.ts, NotificationBell.tsx |
| 11 | Build and verify | All files |
