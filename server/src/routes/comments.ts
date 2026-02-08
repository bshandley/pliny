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
