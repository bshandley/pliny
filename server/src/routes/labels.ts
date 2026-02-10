import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Get labels for a board
router.get('/boards/:boardId/labels', authenticate, async (req: AuthRequest, res) => {
  try {
    const { boardId } = req.params;
    const result = await pool.query(
      'SELECT * FROM board_labels WHERE board_id = $1 ORDER BY created_at',
      [boardId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get labels error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create label
router.post('/boards/:boardId/labels', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { boardId } = req.params;
    const { name, color } = req.body;

    if (name && name.length > 50) {
      return res.status(400).json({ error: 'Label name must be 50 characters or fewer' });
    }
    if (color && color.length > 7) {
      return res.status(400).json({ error: 'Label color must be 7 characters or fewer' });
    }
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return res.status(400).json({ error: 'Label color must be a valid hex color (e.g. #ff0000)' });
    }

    const result = await pool.query(
      'INSERT INTO board_labels (board_id, name, color) VALUES ($1, $2, $3) RETURNING *',
      [boardId, name, color || '#6b7280']
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create label error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update label
router.put('/labels/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { name, color } = req.body;

    if (name && name.length > 50) {
      return res.status(400).json({ error: 'Label name must be 50 characters or fewer' });
    }
    if (color && color.length > 7) {
      return res.status(400).json({ error: 'Label color must be 7 characters or fewer' });
    }
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return res.status(400).json({ error: 'Label color must be a valid hex color (e.g. #ff0000)' });
    }

    const result = await pool.query(
      'UPDATE board_labels SET name = $1, color = $2 WHERE id = $3 RETURNING *',
      [name, color, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Label not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update label error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete label
router.delete('/labels/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM board_labels WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Label not found' });
    }
    res.json({ message: 'Label deleted' });
  } catch (error) {
    console.error('Delete label error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add label to card
router.post('/cards/:cardId/labels', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { cardId } = req.params;
    const { label_id } = req.body;
    await pool.query(
      'INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [cardId, label_id]
    );
    res.status(201).json({ message: 'Label added' });
  } catch (error) {
    console.error('Add card label error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove label from card
router.delete('/cards/:cardId/labels/:labelId', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { cardId, labelId } = req.params;
    await pool.query(
      'DELETE FROM card_labels WHERE card_id = $1 AND label_id = $2',
      [cardId, labelId]
    );
    res.json({ message: 'Label removed' });
  } catch (error) {
    console.error('Remove card label error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
