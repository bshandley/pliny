import { Router } from 'express';
import pool from '../db';
import { authenticate, requireBoardRole } from '../middleware/auth';
import { AuthRequest } from '../types';
import { createNotification, notifyCardMembers } from '../services/notificationHelper';
import { triggerWebhook } from '../services/webhookService';

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
router.post('/cards/:cardId/comments', authenticate, requireBoardRole('EDITOR'), async (req: AuthRequest, res) => {
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
        [...mentionedUserIds]
      );

      // Trigger webhook for comment.created
      triggerWebhook('comment.created', {
        comment: comment.rows[0],
        card_id: cardId,
        board_id: board_id,
        user: { id: req.user!.id, username: req.user!.username },
      }, board_id);
    }

    res.status(201).json(comment.rows[0]);
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete comment (only comment author or admin)
router.delete('/comments/:id', authenticate, requireBoardRole('EDITOR'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const comment = await pool.query('SELECT * FROM card_comments WHERE id = $1', [id]);
    if (comment.rows.length === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    // EDITOR can only delete own comments; board/global ADMIN can delete any
    if (comment.rows[0].user_id !== req.user!.id && req.boardRole !== 'ADMIN') {
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
