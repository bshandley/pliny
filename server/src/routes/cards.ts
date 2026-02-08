import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Create card
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { column_id, title, description, assignee, position, due_date } = req.body;

    const result = await pool.query(
      'INSERT INTO cards (column_id, title, description, assignee, position, due_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [column_id, title, description, assignee, position, due_date || null]
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
    const { column_id, title, description, assignees, position, due_date } = req.body;

    // Build update query dynamically to handle optional fields correctly
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (column_id !== undefined) {
      updates.push(`column_id = $${paramCount++}`);
      values.push(column_id);
    }
    if (title !== undefined) {
      updates.push(`title = $${paramCount++}`);
      values.push(title);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description || null); // Empty string becomes null
    }
    if (position !== undefined) {
      updates.push(`position = $${paramCount++}`);
      values.push(position);
    }
    if (due_date !== undefined) {
      updates.push(`due_date = $${paramCount++}`);
      values.push(due_date || null); // Empty string or null clears the date
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const result = await pool.query(
      `UPDATE cards SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    // Update assignees if provided
    if (assignees !== undefined) {
      // Clear existing assignees
      await pool.query('DELETE FROM card_assignees WHERE card_id = $1', [id]);
      
      // Add new assignees
      if (Array.isArray(assignees) && assignees.length > 0) {
        const values = assignees.map((name, i) => `($1, $${i + 2})`).join(', ');
        const params = [id, ...assignees];
        await pool.query(
          `INSERT INTO card_assignees (card_id, assignee_name) VALUES ${values}`,
          params
        );
      }
    }

    // Fetch updated assignees
    const assigneesResult = await pool.query(
      'SELECT assignee_name FROM card_assignees WHERE card_id = $1',
      [id]
    );

    res.json({
      ...result.rows[0],
      assignees: assigneesResult.rows.map(r => r.assignee_name)
    });
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
