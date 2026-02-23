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
import type { TemplateContext } from './emailTemplates';

export interface NotificationParams {
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

// Map notification type -> preference column name
const PREF_COLUMN_MAP: Record<string, string> = {
  assigned_card: 'email_assigned_card',
  mention_comment: 'email_mention_comment',
  due_date_reminder: 'email_due_date_reminder',
  card_completed: 'email_card_completed',
  comment_added: 'email_comment_added',
  checklist_assigned: 'email_checklist_assigned',
  description_changed: 'email_description_changed',
};

// Columns that default to TRUE when no preference row exists
const DEFAULTS_TRUE = new Set([
  'email_assigned_card',
  'email_mention_comment',
  'email_due_date_reminder',
  'email_checklist_assigned',
]);

// Map notification type -> email template function
const TEMPLATE_MAP: Record<string, (ctx: TemplateContext) => { subject: string; html: string }> = {
  assigned_card: assignedCardEmail,
  mention_comment: mentionCommentEmail,
  due_date_reminder: dueDateReminderEmail,
  card_completed: cardCompletedEmail,
  comment_added: commentAddedEmail,
  checklist_assigned: checklistAssignedEmail,
  description_changed: descriptionChangedEmail,
};

/**
 * Convert a board name to a URL slug.
 * Lowercases, replaces non-alphanumeric chars with dashes, trims leading/trailing dashes.
 */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Core notification creation function.
 *
 * 1. Skip self-notifications (unless due_date_reminder)
 * 2. Insert into notifications table
 * 3. Emit socket event to recipient
 * 4. Check email preference and queue email if appropriate
 *
 * Never throws — logs errors and returns silently.
 */
export async function createNotification(params: NotificationParams): Promise<void> {
  try {
    const {
      userId,
      type,
      cardId,
      boardId,
      actorId,
      actorUsername,
      detail,
      io,
      userSockets,
    } = params;

    // Don't notify yourself — except for due date reminders
    if (userId === actorId && type !== 'due_date_reminder') {
      return;
    }

    // 1. Insert notification
    const notifResult = await pool.query(
      `INSERT INTO notifications (user_id, type, card_id, board_id, actor_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, type, cardId, boardId, actorId, JSON.stringify(detail)]
    );
    const notif = notifResult.rows[0];

    // 2. Emit socket event to all of the recipient's connected sockets
    if (io && userSockets) {
      const sockets = userSockets.get(userId);
      if (sockets) {
        for (const sid of sockets) {
          io.to(sid).emit('notification:new', {
            ...notif,
            actor_username: actorUsername,
          });
        }
      }
    }

    // 3. Queue email if SMTP is configured and user wants it
    if (isSmtpConfigured()) {
      const prefColumn = PREF_COLUMN_MAP[type];
      if (prefColumn) {
        const defaultVal = DEFAULTS_TRUE.has(prefColumn) ? 'TRUE' : 'FALSE';
        const prefResult = await pool.query(
          `SELECT u.email, COALESCE(p.${prefColumn}, ${defaultVal}) as wants_email
           FROM users u
           LEFT JOIN user_notification_preferences p ON u.id = p.user_id
           WHERE u.id = $1`,
          [userId]
        );

        if (prefResult.rows.length > 0) {
          const { email, wants_email } = prefResult.rows[0];
          if (email && wants_email) {
            const templateFn = TEMPLATE_MAP[type];
            if (templateFn) {
              // Get board name for slug
              const boardResult = await pool.query(
                'SELECT name FROM boards WHERE id = $1',
                [boardId]
              );
              const boardName = boardResult.rows[0]?.name || '';
              const boardSlug = toSlug(boardName);

              const ctx: TemplateContext = {
                actorUsername,
                cardTitle: detail.card_title || '',
                boardName: detail.board_name || boardName,
                boardSlug,
                commentText: detail.comment_text,
                dueDate: detail.due_date,
              };

              const { subject, html } = templateFn(ctx);
              await queueEmail(email, subject, html, notif.id);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('createNotification error:', error);
  }
}

/**
 * Notify all members of a card about an event.
 *
 * 1. Queries card info (title, board_id, board_name) via JOIN through columns to boards
 * 2. Queries card_members for the card
 * 3. Calls createNotification for each member (excluding actor and excludeUserIds)
 *
 * Never throws — logs errors and returns silently.
 */
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
    // 1. Get card info
    const cardResult = await pool.query(
      `SELECT c.title, col.board_id, b.name as board_name
       FROM cards c
       JOIN columns col ON c.column_id = col.id
       JOIN boards b ON col.board_id = b.id
       WHERE c.id = $1`,
      [cardId]
    );

    if (cardResult.rows.length === 0) {
      return;
    }

    const { title: cardTitle, board_id: boardId, board_name: boardName } = cardResult.rows[0];

    // 2. Get card members
    const membersResult = await pool.query(
      'SELECT user_id FROM card_members WHERE card_id = $1',
      [cardId]
    );

    const excludeSet = new Set(excludeUserIds || []);

    // 3. Notify each member
    const enrichedDetail = {
      ...detail,
      card_title: cardTitle,
      board_name: boardName,
    };

    for (const row of membersResult.rows) {
      const memberId = row.user_id;

      // Skip the actor and any explicitly excluded users
      if (memberId === actorId || excludeSet.has(memberId)) {
        continue;
      }

      await createNotification({
        userId: memberId,
        type,
        cardId,
        boardId,
        actorId,
        actorUsername,
        detail: enrichedDetail,
        io,
        userSockets,
      });
    }
  } catch (error) {
    console.error('notifyCardMembers error:', error);
  }
}
