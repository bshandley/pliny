import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Create card
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { column_id, title, description, assignee, position } = req.body;

    const result = await pool.query(
      'INSERT INTO cards (column_id, title, description, assignee, position) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [column_id, title, description, assignee, position]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create card error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update card
router.put('/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { column_id, title, description, assignee, position } = req.body;

    const result = await pool.query(
      `UPDATE cards SET
        column_id = COALESCE($1, column_id),
        title = COALESCE($2, title),
        description = COALESCE($3, description),
        assignee = COALESCE($4, assignee),
        position = COALESCE($5, position),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6 RETURNING *`,
      [column_id, title, description, assignee, position, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update card error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete card
router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM cards WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    res.json({ message: 'Card deleted' });
  } catch (error) {
    console.error('Delete card error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
