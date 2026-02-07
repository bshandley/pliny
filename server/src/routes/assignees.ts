import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Get assignees for a board
router.get('/boards/:boardId/assignees', authenticate, async (req: AuthRequest, res) => {
  try {
    const { boardId } = req.params;

    const result = await pool.query(
      'SELECT id, name, created_at FROM board_assignees WHERE board_id = $1 ORDER BY name',
      [boardId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get assignees error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add assignee to board (admin only)
router.post('/boards/:boardId/assignees', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { boardId } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const result = await pool.query(
      'INSERT INTO board_assignees (board_id, name) VALUES ($1, $2) RETURNING id, name, created_at',
      [boardId, name.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Add assignee error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete assignee (admin only)
router.delete('/boards/:boardId/assignees/:assigneeId', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { assigneeId } = req.params;

    const result = await pool.query(
      'DELETE FROM board_assignees WHERE id = $1 RETURNING *',
      [assigneeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assignee not found' });
    }

    res.json({ message: 'Assignee deleted' });
  } catch (error) {
    console.error('Delete assignee error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
