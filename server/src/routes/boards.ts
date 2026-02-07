import { Router } from 'express';
import pool from '../db';
import { authenticate, requireWrite } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Get all boards
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM boards ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get boards error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single board with columns and cards
router.get('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

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
router.post('/', authenticate, requireWrite, async (req: AuthRequest, res) => {
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
router.put('/:id', authenticate, requireWrite, async (req: AuthRequest, res) => {
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
router.delete('/:id', authenticate, requireWrite, async (req: AuthRequest, res) => {
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

export default router;
