import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { logActivity } from './activity';

const router = Router();

// Get members for a card
router.get('/cards/:cardId/members', authenticate, async (req: AuthRequest, res) => {
  try {
    const { cardId } = req.params;
    const result = await pool.query(
      `SELECT u.id, u.username FROM card_members cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.card_id = $1
       ORDER BY cm.created_at`,
      [cardId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get card members error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Set card members (replace all)
router.put('/cards/:cardId/members', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const client = await pool.connect();
  try {
    const { cardId } = req.params;
    const { members } = req.body; // array of user IDs

    await client.query('BEGIN');

    // Get old members
    const oldResult = await client.query(
      'SELECT user_id FROM card_members WHERE card_id = $1',
      [cardId]
    );
    const oldMemberIds = oldResult.rows.map((r: any) => r.user_id);

    // Replace
    await client.query('DELETE FROM card_members WHERE card_id = $1', [cardId]);
    if (Array.isArray(members) && members.length > 0) {
      const vals = members.map((_: string, i: number) => `($1, $${i + 2})`).join(', ');
      await client.query(
        `INSERT INTO card_members (card_id, user_id) VALUES ${vals}`,
        [cardId, ...members]
      );
    }

    await client.query('COMMIT');

    // Log activity
    const oldSet = new Set(oldMemberIds);
    const newSet = new Set(members || []);
    const added = (members || []).filter((id: string) => !oldSet.has(id));
    const removed = oldMemberIds.filter((id: string) => !newSet.has(id));
    if (added.length > 0 || removed.length > 0) {
      const allIds = [...added, ...removed];
      const users = await pool.query('SELECT id, username FROM users WHERE id = ANY($1)', [allIds]);
      const nameMap: Record<string, string> = {};
      users.rows.forEach((u: any) => { nameMap[u.id] = u.username; });
      logActivity(cardId, req.user!.id, 'members_changed', {
        added: added.map((id: string) => nameMap[id] || id),
        removed: removed.map((id: string) => nameMap[id] || id)
      });
    }

    // Create notifications for added members
    const io = req.app.get('io');
    const userSockets: Map<string, string[]> = req.app.get('userSockets');
    if (added.length > 0 && io && userSockets) {
      // Get card info for notification detail
      const cardInfo = await pool.query(
        `SELECT c.title, col.board_id FROM cards c
         JOIN columns col ON c.column_id = col.id
         WHERE c.id = $1`,
        [cardId]
      );
      if (cardInfo.rows.length > 0) {
        const { title, board_id } = cardInfo.rows[0];
        for (const userId of added) {
          if (userId === req.user!.id) continue; // don't notify yourself
          const notif = await pool.query(
            `INSERT INTO notifications (user_id, type, card_id, board_id, actor_id, detail)
             VALUES ($1, 'mention_card', $2, $3, $4, $5) RETURNING *`,
            [userId, cardId, board_id, req.user!.id, JSON.stringify({ card_title: title })]
          );
          // Emit via socket
          const sockets = userSockets.get(userId);
          if (sockets) {
            for (const sid of sockets) {
              io.to(sid).emit('notification:new', {
                ...notif.rows[0],
                actor_username: req.user!.username
              });
            }
          }
        }
      }
    }

    // Return updated members
    const result = await pool.query(
      `SELECT u.id, u.username FROM card_members cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.card_id = $1
       ORDER BY cm.created_at`,
      [cardId]
    );
    res.json(result.rows);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Set card members error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

export default router;
