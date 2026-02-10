import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Get checklist items for a card
router.get('/cards/:cardId/checklist', authenticate, async (req: AuthRequest, res) => {
  try {
    const { cardId } = req.params;
    const result = await pool.query(
      'SELECT * FROM card_checklist_items WHERE card_id = $1 ORDER BY position, created_at',
      [cardId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get checklist error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add checklist item
router.post('/cards/:cardId/checklist', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { cardId } = req.params;
    const { text } = req.body;
    if (!text?.trim()) {
      return res.status(400).json({ error: 'Item text is required' });
    }
    if (text.length > 500) {
      return res.status(400).json({ error: 'Checklist item text must be 500 characters or fewer' });
    }
    // Get next position
    const posResult = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM card_checklist_items WHERE card_id = $1',
      [cardId]
    );
    const position = posResult.rows[0].next_pos;
    const result = await pool.query(
      'INSERT INTO card_checklist_items (card_id, text, position) VALUES ($1, $2, $3) RETURNING *',
      [cardId, text.trim(), position]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Add checklist item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Toggle checklist item
router.put('/checklist/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { checked, text } = req.body;

    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (checked !== undefined) {
      updates.push(`checked = $${paramCount++}`);
      values.push(checked);
    }
    if (text !== undefined) {
      if (text.length > 500) {
        return res.status(400).json({ error: 'Checklist item text must be 500 characters or fewer' });
      }
      updates.push(`text = $${paramCount++}`);
      values.push(text);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE card_checklist_items SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update checklist item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete checklist item
router.delete('/checklist/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM card_checklist_items WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.json({ message: 'Item deleted' });
  } catch (error) {
    console.error('Delete checklist item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
