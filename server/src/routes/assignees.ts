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

// Delete assignee (admin only) - also removes from all cards on this board
router.delete('/boards/:boardId/assignees/:assigneeId', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { boardId, assigneeId } = req.params;

    // Get the assignee name before deleting
    const assignee = await pool.query(
      'SELECT name FROM board_assignees WHERE id = $1',
      [assigneeId]
    );

    if (assignee.rows.length === 0) {
      return res.status(404).json({ error: 'Assignee not found' });
    }

    const assigneeName = assignee.rows[0].name;

    // Remove from all cards on this board
    await pool.query(
      `DELETE FROM card_assignees 
       WHERE assignee_name = $1 
       AND card_id IN (
         SELECT c.id FROM cards c
         JOIN columns col ON c.column_id = col.id
         WHERE col.board_id = $2
       )`,
      [assigneeName, boardId]
    );

    // Delete the board assignee
    await pool.query(
      'DELETE FROM board_assignees WHERE id = $1',
      [assigneeId]
    );

    res.json({ message: 'Assignee deleted', removedFromCards: true });
  } catch (error) {
    console.error('Delete assignee error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
