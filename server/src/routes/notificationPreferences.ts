import { Router } from 'express';
import pool from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

const PREFERENCE_COLUMNS = [
  'email_assigned_card',
  'email_mention_comment',
  'email_due_date_reminder',
  'email_card_completed',
  'email_comment_added',
  'email_checklist_assigned',
  'email_description_changed',
] as const;

const DEFAULTS: Record<string, boolean> = {
  email_assigned_card: true,
  email_mention_comment: true,
  email_due_date_reminder: true,
  email_card_completed: false,
  email_comment_added: false,
  email_checklist_assigned: true,
  email_description_changed: false,
};

// Get notification preferences for current user
router.get('/preferences', authenticate, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM user_notification_preferences WHERE user_id = $1',
      [req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.json({ ...DEFAULTS });
    }

    const row = { ...result.rows[0] };
    delete row.user_id;
    res.json(row);
  } catch (error) {
    console.error('Get notification preferences error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update notification preferences for current user
router.put('/preferences', authenticate, async (req: AuthRequest, res) => {
  try {
    // Build values from request body, falling back to defaults for unspecified columns
    const values: boolean[] = [];
    for (const col of PREFERENCE_COLUMNS) {
      if (col in req.body && typeof req.body[col] === 'boolean') {
        values.push(req.body[col]);
      } else {
        values.push(DEFAULTS[col]);
      }
    }

    const colList = PREFERENCE_COLUMNS.join(', ');
    const paramList = PREFERENCE_COLUMNS.map((_, i) => `$${i + 2}`).join(', ');
    const updateList = PREFERENCE_COLUMNS.map((col, i) => `${col} = EXCLUDED.${col}`).join(', ');

    const result = await pool.query(
      `INSERT INTO user_notification_preferences (user_id, ${colList})
       VALUES ($1, ${paramList})
       ON CONFLICT (user_id) DO UPDATE SET ${updateList}
       RETURNING *`,
      [req.user!.id, ...values]
    );

    const row = { ...result.rows[0] };
    delete row.user_id;
    res.json(row);
  } catch (error) {
    console.error('Update notification preferences error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
