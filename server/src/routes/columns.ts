import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Create column
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { board_id, name, position } = req.body;

    if (name && name.length > 255) {
      return res.status(400).json({ error: 'Column name must be 255 characters or fewer' });
    }

    const result = await pool.query(
      'INSERT INTO columns (board_id, name, position) VALUES ($1, $2, $3) RETURNING *',
      [board_id, name, position]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create column error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update column
router.put('/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { name, position } = req.body;

    if (name !== undefined && name.length > 255) {
      return res.status(400).json({ error: 'Column name must be 255 characters or fewer' });
    }

    const result = await pool.query(
      'UPDATE columns SET name = COALESCE($1, name), position = COALESCE($2, position), updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
      [name, position, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Column not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update column error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete column
router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM columns WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Column not found' });
    }

    res.json({ message: 'Column deleted' });
  } catch (error) {
    console.error('Delete column error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
