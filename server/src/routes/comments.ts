import { Router } from 'express';
import pool from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Get comments for a card
router.get('/cards/:cardId/comments', authenticate, async (req: AuthRequest, res) => {
  try {
    const { cardId } = req.params;
    const result = await pool.query(
      `SELECT cc.*, u.username
       FROM card_comments cc
       JOIN users u ON cc.user_id = u.id
       WHERE cc.card_id = $1
       ORDER BY cc.created_at ASC`,
      [cardId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add comment (any authenticated user can comment)
router.post('/cards/:cardId/comments', authenticate, async (req: AuthRequest, res) => {
  try {
    const { cardId } = req.params;
    const { text } = req.body;
    if (!text?.trim()) {
      return res.status(400).json({ error: 'Comment text is required' });
    }
    if (text.length > 5000) {
      return res.status(400).json({ error: 'Comment text must be 5000 characters or fewer' });
    }
    const result = await pool.query(
      'INSERT INTO card_comments (card_id, user_id, text) VALUES ($1, $2, $3) RETURNING *',
      [cardId, req.user!.id, text.trim()]
    );
    // Fetch with username
    const comment = await pool.query(
      `SELECT cc.*, u.username
       FROM card_comments cc
       JOIN users u ON cc.user_id = u.id
       WHERE cc.id = $1`,
      [result.rows[0].id]
    );
    // Parse @mentions and create notifications
    const commentText = comment.rows[0].text;
    const mentions = [...commentText.matchAll(/@(\w+)/g)].map((m: RegExpMatchArray) => m[1]);

    if (mentions.length > 0) {
      const cardInfo = await pool.query(
        `SELECT c.id, c.title, col.board_id FROM cards c
         JOIN columns col ON c.column_id = col.id
         WHERE c.id = $1`,
        [cardId]
      );

      if (cardInfo.rows.length > 0) {
        const { title: cardTitle, board_id } = cardInfo.rows[0];

        const boardMembers = await pool.query(
          `SELECT DISTINCT u.id, u.username FROM users u
           LEFT JOIN board_members bm ON u.id = bm.user_id AND bm.board_id = $1
           WHERE u.role = 'ADMIN' OR bm.board_id = $1`,
          [board_id]
        );

        const memberMap = new Map<string, string>();
        boardMembers.rows.forEach((m: any) => memberMap.set(m.username.toLowerCase(), m.id));

        const io = req.app.get('io');
        const userSockets: Map<string, string[]> = req.app.get('userSockets');

        for (const mention of mentions) {
          const memberId = memberMap.get(mention.toLowerCase());
          if (memberId && memberId !== req.user!.id) {
            const notif = await pool.query(
              `INSERT INTO notifications (user_id, type, card_id, board_id, actor_id, detail)
               VALUES ($1, 'mention_comment', $2, $3, $4, $5) RETURNING *`,
              [memberId, cardId, board_id, req.user!.id,
               JSON.stringify({ card_title: cardTitle, comment_text: commentText.substring(0, 200) })]
            );

            if (io && userSockets) {
              const sockets = userSockets.get(memberId);
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
      }
    }

    res.status(201).json(comment.rows[0]);
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete comment (only comment author or admin)
router.delete('/comments/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const comment = await pool.query('SELECT * FROM card_comments WHERE id = $1', [id]);
    if (comment.rows.length === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    if (comment.rows[0].user_id !== req.user!.id && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await pool.query('DELETE FROM card_comments WHERE id = $1', [id]);
    res.json({ message: 'Comment deleted' });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
