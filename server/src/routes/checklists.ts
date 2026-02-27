import { Router } from 'express';
import pool from '../db';
import { authenticate, requireBoardRole } from '../middleware/auth';
import { AuthRequest } from '../types';
import { createNotification } from '../services/notificationHelper';

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
router.post('/cards/:cardId/checklist', authenticate, requireBoardRole('COLLABORATOR'), async (req: AuthRequest, res) => {
  try {
    const { cardId } = req.params;
    const { text, assignee_name, due_date, priority } = req.body;
    if (!text?.trim()) {
      return res.status(400).json({ error: 'Item text is required' });
    }
    if (text.length > 500) {
      return res.status(400).json({ error: 'Checklist item text must be 500 characters or fewer' });
    }
    if (priority && !['low', 'medium', 'high'].includes(priority)) {
      return res.status(400).json({ error: 'Priority must be low, medium, or high' });
    }
    // Get next position
    const posResult = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM card_checklist_items WHERE card_id = $1',
      [cardId]
    );
    const position = posResult.rows[0].next_pos;
    const result = await pool.query(
      'INSERT INTO card_checklist_items (card_id, text, position, assignee_name, due_date, priority) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [cardId, text.trim(), position, assignee_name || null, due_date || null, priority || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Add checklist item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Toggle checklist item
router.put('/checklist/:id', authenticate, requireBoardRole('COLLABORATOR'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { checked, text, assignee_name, due_date, priority } = req.body;

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
    if (assignee_name !== undefined) {
      updates.push(`assignee_name = $${paramCount++}`);
      values.push(assignee_name || null);
    }
    if (due_date !== undefined) {
      updates.push(`due_date = $${paramCount++}`);
      values.push(due_date || null);
    }
    if (priority !== undefined) {
      if (priority && !['low', 'medium', 'high'].includes(priority)) {
        return res.status(400).json({ error: 'Priority must be low, medium, or high' });
      }
      updates.push(`priority = $${paramCount++}`);
      values.push(priority || null);
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

    // Notify assignee when assigned to a checklist item
    if (assignee_name !== undefined && assignee_name) {
      const assignee = await pool.query('SELECT id FROM users WHERE username = $1', [assignee_name]);
      if (assignee.rows.length > 0) {
        const item = result.rows[0];
        const cardInfo = await pool.query(
          `SELECT c.title, col.board_id, b.name as board_name
           FROM cards c JOIN columns col ON c.column_id = col.id
           JOIN boards b ON col.board_id = b.id
           WHERE c.id = $1`,
          [item.card_id]
        );
        if (cardInfo.rows.length > 0) {
          const { title, board_id, board_name } = cardInfo.rows[0];
          const io = req.app.get('io');
          const userSockets: Map<string, string[]> = req.app.get('userSockets');
          await createNotification({
            userId: assignee.rows[0].id,
            type: 'checklist_assigned',
            cardId: item.card_id,
            boardId: board_id,
            actorId: req.user!.id,
            actorUsername: req.user!.username,
            detail: { card_title: title, board_name },
            io,
            userSockets,
          });
        }
      }
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update checklist item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete checklist item
router.delete('/checklist/:id', authenticate, requireBoardRole('COLLABORATOR'), async (req: AuthRequest, res) => {
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
