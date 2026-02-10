import { Router } from 'express';
import { Pool } from 'pg';
import pool from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Get activity for a card
router.get('/cards/:cardId/activity', authenticate, async (req: AuthRequest, res) => {
  try {
    const { cardId } = req.params;
    const result = await pool.query(
      `SELECT ca.*, u.username
       FROM card_activity ca
       JOIN users u ON ca.user_id = u.id
       WHERE ca.card_id = $1
       ORDER BY ca.created_at DESC`,
      [cardId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get activity error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

// Helper: log a single activity entry (fire-and-forget)
export async function logActivity(
  cardId: string,
  userId: string,
  action: string,
  detail?: Record<string, any>,
  client?: Pool | any
) {
  const db = client || pool;
  try {
    await db.query(
      'INSERT INTO card_activity (card_id, user_id, action, detail) VALUES ($1, $2, $3, $4)',
      [cardId, userId, action, detail ? JSON.stringify(detail) : null]
    );
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}
