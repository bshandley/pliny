import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Get all boards (filtered by permission)
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;

    if (user.role === 'ADMIN') {
      // Admin sees all boards
      const result = await pool.query(
        'SELECT * FROM boards ORDER BY created_at DESC'
      );
      res.json(result.rows);
    } else {
      // READ users only see boards they're members of
      const result = await pool.query(
        `SELECT b.* FROM boards b
         INNER JOIN board_members bm ON b.id = bm.board_id
         WHERE bm.user_id = $1
         ORDER BY b.created_at DESC`,
        [user.id]
      );
      res.json(result.rows);
    }
  } catch (error) {
    console.error('Get boards error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single board with columns and cards
router.get('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    // Check access: admin can access all, READ must be a member
    if (user.role !== 'ADMIN') {
      const memberCheck = await pool.query(
        'SELECT 1 FROM board_members WHERE board_id = $1 AND user_id = $2',
        [id, user.id]
      );
      if (memberCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Board not found' });
      }
    }

    const boardResult = await pool.query(
      'SELECT * FROM boards WHERE id = $1',
      [id]
    );

    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const columnsResult = await pool.query(
      'SELECT * FROM columns WHERE board_id = $1 ORDER BY position',
      [id]
    );

    const cardsResult = await pool.query(
      `SELECT c.* FROM cards c
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1
       ORDER BY c.position`,
      [id]
    );

    const board = boardResult.rows[0];
    const columns = columnsResult.rows;
    const cards = cardsResult.rows;

    res.json({
      ...board,
      columns: columns.map(col => ({
        ...col,
        cards: cards.filter(card => card.column_id === col.id)
      }))
    });
  } catch (error) {
    console.error('Get board error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create board
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { name, description } = req.body;

    const result = await pool.query(
      'INSERT INTO boards (name, description, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name, description, req.user!.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create board error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update board
router.put('/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const result = await pool.query(
      'UPDATE boards SET name = $1, description = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
      [name, description, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update board error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete board
router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM boards WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    res.json({ message: 'Board deleted' });
  } catch (error) {
    console.error('Delete board error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get board members (admin only)
router.get('/:id/members', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT u.id, u.username, u.role, bm.added_at
       FROM board_members bm
       INNER JOIN users u ON bm.user_id = u.id
       WHERE bm.board_id = $1
       ORDER BY bm.added_at DESC`,
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get board members error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add board member (admin only)
router.post('/:id/members', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    // Verify board exists
    const boardCheck = await pool.query('SELECT id FROM boards WHERE id = $1', [id]);
    if (boardCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    // Verify user exists
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await pool.query(
      'INSERT INTO board_members (board_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, user_id]
    );

    res.status(201).json({ message: 'Member added' });
  } catch (error) {
    console.error('Add board member error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove board member (admin only)
router.delete('/:id/members/:userId', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id, userId } = req.params;

    const result = await pool.query(
      'DELETE FROM board_members WHERE board_id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    res.json({ message: 'Member removed' });
  } catch (error) {
    console.error('Remove board member error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
