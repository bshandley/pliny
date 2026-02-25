/**
 * Public API v1 Routes
 *
 * These routes are intended for external API access via personal access tokens.
 * Internal frontend routes remain at /api/* without version prefix.
 */

import { Router, Response } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// ============ USERS ============

// GET /api/v1/users/me - Get current user
router.get('/users/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, username, role, email, display_name, avatar_url, created_at FROM users WHERE id = $1',
      [req.user!.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// GET /api/v1/users - List all users (ADMIN only)
router.get('/users', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, username, role, email, display_name, avatar_url, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing users:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// ============ BOARDS ============

// GET /api/v1/boards - List boards
router.get('/boards', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    let query: string;
    let params: any[];

    if (req.user!.role === 'ADMIN') {
      query = `SELECT id, name, description, created_by, created_at, updated_at, archived
               FROM boards
               ORDER BY updated_at DESC`;
      params = [];
    } else {
      query = `SELECT DISTINCT b.id, b.name, b.description, b.created_by, b.created_at, b.updated_at, b.archived
               FROM boards b
               LEFT JOIN board_members bm ON b.id = bm.board_id
               WHERE b.created_by = $1 OR bm.user_id = $1
               ORDER BY b.updated_at DESC`;
      params = [req.user!.id];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing boards:', err);
    res.status(500).json({ error: 'Failed to list boards' });
  }
});

// POST /api/v1/boards - Create board
router.post('/boards', authenticate, async (req: AuthRequest, res: Response) => {
  const { name, description } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Board name is required' });
  }
  if (name.length > 100) {
    return res.status(400).json({ error: 'Board name must be 100 characters or fewer' });
  }
  if (description && description.length > 500) {
    return res.status(400).json({ error: 'Description must be 500 characters or fewer' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO boards (name, description, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, created_by, created_at, updated_at`,
      [name.trim(), description?.trim() || null, req.user!.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating board:', err);
    res.status(500).json({ error: 'Failed to create board' });
  }
});

// GET /api/v1/boards/:id - Get board with columns and cards
router.get('/boards/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    // Check access
    const accessCheck = await pool.query(
      `SELECT b.* FROM boards b
       LEFT JOIN board_members bm ON b.id = bm.board_id AND bm.user_id = $1
       WHERE b.id = $2 AND (b.created_by = $1 OR bm.user_id IS NOT NULL OR $3 = 'ADMIN')`,
      [req.user!.id, id, req.user!.role]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const board = accessCheck.rows[0];

    // Get columns
    const columnsResult = await pool.query(
      'SELECT * FROM columns WHERE board_id = $1 ORDER BY position',
      [id]
    );

    // Get cards
    const cardsResult = await pool.query(
      `SELECT c.*,
        (SELECT json_agg(l.*) FROM labels l
         JOIN card_labels cl ON l.id = cl.label_id
         WHERE cl.card_id = c.id) as labels
       FROM cards c
       JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1
       ORDER BY c.position`,
      [id]
    );

    const columns = columnsResult.rows.map(col => ({
      ...col,
      cards: cardsResult.rows.filter(card => card.column_id === col.id),
    }));

    res.json({ ...board, columns });
  } catch (err) {
    console.error('Error fetching board:', err);
    res.status(500).json({ error: 'Failed to fetch board' });
  }
});

// PUT /api/v1/boards/:id - Update board
router.put('/boards/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { name, description, archived } = req.body;

  try {
    // Check ownership or admin
    const accessCheck = await pool.query(
      'SELECT * FROM boards WHERE id = $1 AND (created_by = $2 OR $3 = \'ADMIN\')',
      [id, req.user!.id, req.user!.role]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      if (name.length > 100) {
        return res.status(400).json({ error: 'Board name must be 100 characters or fewer' });
      }
      updates.push(`name = $${paramIndex++}`);
      values.push(name.trim());
    }
    if (description !== undefined) {
      if (description && description.length > 500) {
        return res.status(400).json({ error: 'Description must be 500 characters or fewer' });
      }
      updates.push(`description = $${paramIndex++}`);
      values.push(description?.trim() || null);
    }
    if (archived !== undefined) {
      updates.push(`archived = $${paramIndex++}`);
      values.push(archived);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const result = await pool.query(
      `UPDATE boards SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating board:', err);
    res.status(500).json({ error: 'Failed to update board' });
  }
});

// DELETE /api/v1/boards/:id - Delete board
router.delete('/boards/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM boards WHERE id = $1 AND (created_by = $2 OR $3 = \'ADMIN\') RETURNING id',
      [id, req.user!.id, req.user!.role]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    res.json({ message: 'Board deleted' });
  } catch (err) {
    console.error('Error deleting board:', err);
    res.status(500).json({ error: 'Failed to delete board' });
  }
});

// ============ COLUMNS ============

// GET /api/v1/boards/:id/columns - List columns
router.get('/boards/:id/columns', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'SELECT * FROM columns WHERE board_id = $1 ORDER BY position',
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing columns:', err);
    res.status(500).json({ error: 'Failed to list columns' });
  }
});

// POST /api/v1/boards/:id/columns - Create column
router.post('/boards/:id/columns', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { name, position } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Column name is required' });
  }
  if (name.length > 100) {
    return res.status(400).json({ error: 'Column name must be 100 characters or fewer' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO columns (board_id, name, position)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, name.trim(), position ?? 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating column:', err);
    res.status(500).json({ error: 'Failed to create column' });
  }
});

// ============ CARDS ============

// GET /api/v1/boards/:id/cards - List all cards in a board
router.get('/boards/:id/cards', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT c.*, col.name as column_name
       FROM cards c
       JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1
       ORDER BY col.position, c.position`,
      [id]
    );

    // Fetch assignees for all cards in this board
    const assigneesResult = await pool.query(
      `SELECT ca.id, ca.card_id, ca.user_id, u.username, ca.display_name
       FROM card_assignees ca
       LEFT JOIN users u ON ca.user_id = u.id
       INNER JOIN cards c ON ca.card_id = c.id
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1`,
      [id]
    );
    const assigneesByCard = new Map<string, any[]>();
    for (const row of assigneesResult.rows) {
      const list = assigneesByCard.get(row.card_id) || [];
      list.push({ id: row.id, user_id: row.user_id, username: row.username, display_name: row.display_name });
      assigneesByCard.set(row.card_id, list);
    }

    const cards = result.rows.map((card: any) => ({
      ...card,
      assignees: assigneesByCard.get(card.id) || [],
    }));

    res.json(cards);
  } catch (err) {
    console.error('Error listing cards:', err);
    res.status(500).json({ error: 'Failed to list cards' });
  }
});

// POST /api/v1/boards/:id/cards - Create card in board (uses first column by default)
router.post('/boards/:id/cards', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { title, description, column_id, position, due_date, start_date } = req.body;

  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'Card title is required' });
  }
  if (title.length > 255) {
    return res.status(400).json({ error: 'Card title must be 255 characters or fewer' });
  }

  try {
    let targetColumnId = column_id;

    if (!targetColumnId) {
      // Get first column
      const colResult = await pool.query(
        'SELECT id FROM columns WHERE board_id = $1 ORDER BY position LIMIT 1',
        [id]
      );
      if (colResult.rows.length === 0) {
        return res.status(400).json({ error: 'Board has no columns' });
      }
      targetColumnId = colResult.rows[0].id;
    }

    const result = await pool.query(
      `INSERT INTO cards (column_id, title, description, position, due_date, start_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [targetColumnId, title.trim(), description?.trim() || null, position ?? 0, due_date || null, start_date || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating card:', err);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

// GET /api/v1/cards/:id - Get card
router.get('/cards/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT c.*, col.board_id, col.name as column_name
       FROM cards c
       JOIN columns col ON c.column_id = col.id
       WHERE c.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    // Fetch assignees for this card
    const assigneesResult = await pool.query(
      `SELECT ca.id, ca.card_id, ca.user_id, u.username, ca.display_name
       FROM card_assignees ca
       LEFT JOIN users u ON ca.user_id = u.id
       WHERE ca.card_id = $1`,
      [id]
    );
    const assignees = assigneesResult.rows.map((row: any) => ({
      id: row.id, user_id: row.user_id, username: row.username, display_name: row.display_name,
    }));

    res.json({ ...result.rows[0], assignees });
  } catch (err) {
    console.error('Error fetching card:', err);
    res.status(500).json({ error: 'Failed to fetch card' });
  }
});

// PUT /api/v1/cards/:id - Update card
router.put('/cards/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { title, description, column_id, position, due_date, start_date, archived } = req.body;

  try {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (title !== undefined) {
      if (title.length > 255) {
        return res.status(400).json({ error: 'Card title must be 255 characters or fewer' });
      }
      updates.push(`title = $${paramIndex++}`);
      values.push(title.trim());
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description?.trim() || null);
    }
    if (column_id !== undefined) {
      updates.push(`column_id = $${paramIndex++}`);
      values.push(column_id);
    }
    if (position !== undefined) {
      updates.push(`position = $${paramIndex++}`);
      values.push(position);
    }
    if (due_date !== undefined) {
      updates.push(`due_date = $${paramIndex++}`);
      values.push(due_date || null);
    }
    if (start_date !== undefined) {
      updates.push(`start_date = $${paramIndex++}`);
      values.push(start_date || null);
    }
    if (archived !== undefined) {
      updates.push(`archived = $${paramIndex++}`);
      values.push(archived);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const result = await pool.query(
      `UPDATE cards SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating card:', err);
    res.status(500).json({ error: 'Failed to update card' });
  }
});

// DELETE /api/v1/cards/:id - Delete card
router.delete('/cards/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM cards WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    res.json({ message: 'Card deleted' });
  } catch (err) {
    console.error('Error deleting card:', err);
    res.status(500).json({ error: 'Failed to delete card' });
  }
});

// POST /api/v1/cards/:id/move - Move card to column/position
router.post('/cards/:id/move', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { column_id, position } = req.body;

  if (!column_id) {
    return res.status(400).json({ error: 'column_id is required' });
  }

  try {
    const result = await pool.query(
      `UPDATE cards
       SET column_id = $1, position = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [column_id, position ?? 0, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error moving card:', err);
    res.status(500).json({ error: 'Failed to move card' });
  }
});

// ============ COMMENTS ============

// GET /api/v1/cards/:id/comments - List comments
router.get('/cards/:id/comments', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT c.*, u.username
       FROM card_comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.card_id = $1
       ORDER BY c.created_at ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing comments:', err);
    res.status(500).json({ error: 'Failed to list comments' });
  }
});

// POST /api/v1/cards/:id/comments - Add comment
router.post('/cards/:id/comments', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { text } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Comment text is required' });
  }
  if (text.length > 5000) {
    return res.status(400).json({ error: 'Comment must be 5000 characters or fewer' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO card_comments (card_id, user_id, text)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, req.user!.id, text.trim()]
    );

    // Get username for response
    const userResult = await pool.query(
      'SELECT username FROM users WHERE id = $1',
      [req.user!.id]
    );

    res.status(201).json({
      ...result.rows[0],
      username: userResult.rows[0]?.username,
    });
  } catch (err) {
    console.error('Error creating comment:', err);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

// ============ CHECKLISTS ============

// GET /api/v1/cards/:id/checklists - List checklist items
router.get('/cards/:id/checklists', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM card_checklist_items
       WHERE card_id = $1
       ORDER BY position`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing checklists:', err);
    res.status(500).json({ error: 'Failed to list checklists' });
  }
});

// POST /api/v1/cards/:id/checklists - Add checklist item
router.post('/cards/:id/checklists', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { text, position, assignee_name, assignee_user_id, due_date, priority } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Checklist item text is required' });
  }
  if (text.length > 500) {
    return res.status(400).json({ error: 'Checklist item must be 500 characters or fewer' });
  }
  if (priority && !['low', 'medium', 'high'].includes(priority)) {
    return res.status(400).json({ error: 'Invalid priority value' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO card_checklist_items (card_id, text, position, assignee_name, assignee_user_id, due_date, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, text.trim(), position ?? 0, assignee_name || null, assignee_user_id || null, due_date || null, priority || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating checklist item:', err);
    res.status(500).json({ error: 'Failed to create checklist item' });
  }
});

export default router;
