import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// GET /boards/:boardId/custom-fields — list field definitions
router.get('/boards/:boardId/custom-fields', authenticate, async (req: AuthRequest, res) => {
  try {
    const { boardId } = req.params;
    const result = await pool.query(
      'SELECT * FROM board_custom_fields WHERE board_id = $1 ORDER BY position',
      [boardId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get custom fields error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /boards/:boardId/custom-fields — create field definition (admin only)
router.post('/boards/:boardId/custom-fields', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { boardId } = req.params;
    const { name, field_type, options, show_on_card } = req.body;

    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    if (name.length > 100) return res.status(400).json({ error: 'Name must be 100 characters or less' });
    if (!['text', 'number', 'date', 'dropdown', 'checkbox'].includes(field_type)) {
      return res.status(400).json({ error: 'Invalid field type' });
    }
    if (field_type === 'dropdown' && (!Array.isArray(options) || options.length === 0)) {
      return res.status(400).json({ error: 'Dropdown fields require at least one option' });
    }

    // Get next position
    const posResult = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM board_custom_fields WHERE board_id = $1',
      [boardId]
    );
    const position = posResult.rows[0].next_pos;

    const result = await pool.query(
      `INSERT INTO board_custom_fields (board_id, name, field_type, options, position, show_on_card)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [boardId, name.trim(), field_type, field_type === 'dropdown' ? JSON.stringify(options) : null, position, show_on_card || false]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create custom field error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /custom-fields/:fieldId — update field definition (admin only)
router.put('/custom-fields/:fieldId', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { fieldId } = req.params;
    const { name, options, position, show_on_card } = req.body;

    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'Name is required' });
      if (name.length > 100) return res.status(400).json({ error: 'Name must be 100 characters or less' });
      updates.push(`name = $${paramCount++}`);
      values.push(name.trim());
    }
    if (options !== undefined) {
      updates.push(`options = $${paramCount++}`);
      values.push(JSON.stringify(options));
    }
    if (position !== undefined) {
      updates.push(`position = $${paramCount++}`);
      values.push(position);
    }
    if (show_on_card !== undefined) {
      updates.push(`show_on_card = $${paramCount++}`);
      values.push(show_on_card);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(fieldId);
    const result = await pool.query(
      `UPDATE board_custom_fields SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Field not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update custom field error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /custom-fields/:fieldId — delete field + all values (admin only)
router.delete('/custom-fields/:fieldId', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { fieldId } = req.params;
    const result = await pool.query('DELETE FROM board_custom_fields WHERE id = $1 RETURNING id', [fieldId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Field not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete custom field error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /cards/:cardId/custom-fields — get field values for a card
router.get('/cards/:cardId/custom-fields', authenticate, async (req: AuthRequest, res) => {
  try {
    const { cardId } = req.params;
    const result = await pool.query(
      `SELECT v.*, f.name, f.field_type, f.options
       FROM card_custom_field_values v
       JOIN board_custom_fields f ON v.field_id = f.id
       WHERE v.card_id = $1
       ORDER BY f.position`,
      [cardId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get card custom fields error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /cards/:cardId/custom-fields — bulk set field values
router.put('/cards/:cardId/custom-fields', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { cardId } = req.params;
    const fields = req.body; // { fieldId: value, fieldId: value, ... }

    for (const [fieldId, value] of Object.entries(fields)) {
      if (value === null || value === '') {
        await pool.query('DELETE FROM card_custom_field_values WHERE card_id = $1 AND field_id = $2', [cardId, fieldId]);
      } else {
        await pool.query(
          `INSERT INTO card_custom_field_values (card_id, field_id, value)
           VALUES ($1, $2, $3)
           ON CONFLICT (card_id, field_id)
           DO UPDATE SET value = $3, updated_at = CURRENT_TIMESTAMP`,
          [cardId, fieldId, String(value)]
        );
      }
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Set card custom fields error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
