# SMTP Email Notifications Design

**Date:** 2026-02-19

## Overview

Add full SMTP email support and a per-event notification preference system. Users get 7 notification event types with individual on/off toggles. Emails are queued in PostgreSQL for retry resilience.

## SMTP Configuration (Admin)

Activated in the existing GeneralSettings SMTP stub.

**Fields:**
- SMTP Host (text)
- Port (number, default 587)
- Username (text, optional)
- Password (text/password, optional — encrypted at rest via AES-256-GCM using existing `crypto.ts`)
- From Address (email)
- TLS toggle (on by default)
- "Test Connection" button — sends test email to admin's address

**Storage:** `app_settings` table (existing). GET endpoint masks password (`"••••••••"` if set). Dedicated SMTP routes handle encryption/decryption and test-send.

## Notification Types (Extended)

| Event | Type string | Trigger location | Who gets notified |
|-------|------------|-----------------|-------------------|
| Assigned to card | `assigned_card` | cardMembers.ts | Added member |
| Mentioned in comment | `mention_comment` | comments.ts | @mentioned user |
| Due date approaching | `due_date_reminder` | Interval timer | All card members |
| Card moved to done | `card_completed` | cards.ts (column move) | All card members |
| New comment on your card | `comment_added` | comments.ts | All card members (except commenter) |
| Checklist item assigned | `checklist_assigned` | checklists.ts | Assigned user |
| Card description changed | `description_changed` | cards.ts | All card members (except editor) |

**Notes:**
- Existing `mention_card` renamed to `assigned_card`
- "Done" column = rightmost column in the board (Kanban convention)
- Due date reminder: server interval every 15 min, fires once at 24h before due date. `reminded_at` column on cards prevents duplicates.

## Email Queue (DB-backed)

**Table: `email_queue`**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| notification_id | UUID | FK to notifications (nullable — test emails have none) |
| to_email | VARCHAR(255) | Recipient |
| subject | VARCHAR(500) | Subject line |
| body_html | TEXT | Rendered HTML |
| status | VARCHAR(20) | `pending`, `sent`, `failed` |
| attempts | INTEGER | Default 0, max 3 |
| next_attempt_at | TIMESTAMP | Retry backoff: 1m, 5m, 30m |
| error | TEXT | Last error message |
| created_at | TIMESTAMP | |

**Processing:** `setInterval` in `server/src/index.ts` runs every 30s. Queries `status = 'pending' AND next_attempt_at <= NOW()`, sends via nodemailer, updates status. After 3 failures → `failed`.

If SMTP not configured, no emails queued. In-app notifications always work regardless.

## User Notification Preferences

**Table: `user_notification_preferences`**

| Column | Type | Default |
|--------|------|---------|
| user_id | UUID | PK, FK to users (CASCADE) |
| email_assigned_card | BOOLEAN | true |
| email_mention_comment | BOOLEAN | true |
| email_due_date_reminder | BOOLEAN | true |
| email_card_completed | BOOLEAN | false |
| email_comment_added | BOOLEAN | false |
| email_checklist_assigned | BOOLEAN | true |
| email_description_changed | BOOLEAN | false |

**Defaults rationale:** Direct-action events (assigned, mentioned, checklist assigned, due date) default on. Ambient-activity events (comment added, card completed, description changed) default off.

**UI:** New "Email Notifications" section in ProfileSettings below 2FA. 7 checkboxes with labels and descriptions. If SMTP not configured, shows banner and disables toggles.

**API:**
- `GET /api/notifications/preferences` — returns prefs (creates default row if none)
- `PUT /api/notifications/preferences` — updates prefs

**Flow:** On notification event → check recipient prefs → if email pref is true AND SMTP configured AND user has email → queue email.

## Email Templates

Inline HTML templates (no engine dependency). Each type has a function returning `{ subject, html }`.

**Subject lines:**
- `assigned_card`: `[Board] You were added to "Card Title"`
- `mention_comment`: `[Board] @actor mentioned you on "Card Title"`
- `due_date_reminder`: `[Board] "Card Title" is due tomorrow`
- `card_completed`: `[Board] "Card Title" was marked complete`
- `comment_added`: `[Board] @actor commented on "Card Title"`
- `checklist_assigned`: `[Board] A subtask was assigned to you on "Card Title"`
- `description_changed`: `[Board] "Card Title" description was updated`

**Body:** Actor + action, card title (linked), board name, brief context, "View Card" button, "Manage preferences" footer link.

**APP_BASE_URL:** Environment variable for generating email links.

## Migration & Integration

**Migration 015:**
- `email_queue` table
- `user_notification_preferences` table
- `reminded_at` TIMESTAMP column on `cards`

**New dependency:** `nodemailer`

**Files created:**
- `server/src/services/emailService.ts` — transporter, queue processor, `queueEmail()`
- `server/src/services/emailTemplates.ts` — per-type template functions
- `server/src/routes/notificationPreferences.ts` — GET/PUT user prefs

**Files modified:**
- `server/src/routes/appSettings.ts` — SMTP keys, encrypt/decrypt password, test endpoint
- `server/src/routes/comments.ts` — `comment_added` notification, queue emails
- `server/src/routes/cardMembers.ts` — rename to `assigned_card`, queue emails
- `server/src/routes/cards.ts` — `card_completed`, `description_changed` notifications
- `server/src/routes/checklists.ts` — `checklist_assigned` notification
- `server/src/index.ts` — start queue processor + due date reminder intervals, mount prefs route
- `client/src/types.ts` — expand Notification type union
- `client/src/api.ts` — prefs API methods
- `client/src/components/GeneralSettings.tsx` — activate SMTP form, password field, test button
- `client/src/components/ProfileSettings.tsx` — Email Notifications section with 7 toggles
- `client/src/components/NotificationBell.tsx` — handle new notification type display strings

**Shared helper:** `createNotification()` — handles DB insert, socket emit, preference check, email queueing in one call. Reduces duplication across routes.
