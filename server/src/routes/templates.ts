import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin, requireMember } from '../middleware/auth';
import { AuthRequest } from '../types';
import { TemplateData } from '../templates/builtins';

const router = Router();

/**
 * Snapshot a board's structure into a TemplateData object.
 * Strips all IDs, dates, assignees — just structure.
 */
async function snapshotBoard(boardId: string): Promise<TemplateData> {
  // Fetch columns
  const colsResult = await pool.query(
    'SELECT id, name, position FROM columns WHERE board_id = $1 ORDER BY position',
    [boardId]
  );

  // Fetch non-archived cards for all columns
  const cardsResult = await pool.query(
    `SELECT c.id, c.column_id, c.title, c.description, c.position
     FROM cards c
     INNER JOIN columns col ON c.column_id = col.id
     WHERE col.board_id = $1 AND c.archived = false
     ORDER BY c.position`,
    [boardId]
  );

  // Fetch checklist items for all cards in this board
  const checklistResult = await pool.query(
    `SELECT ci.card_id, ci.text, ci.position
     FROM card_checklist_items ci
     INNER JOIN cards c ON ci.card_id = c.id
     INNER JOIN columns col ON c.column_id = col.id
     WHERE col.board_id = $1 AND c.archived = false
     ORDER BY ci.position`,
    [boardId]
  );

  // Fetch board labels
  const labelsResult = await pool.query(
    'SELECT name, color FROM board_labels WHERE board_id = $1',
    [boardId]
  );

  // Fetch custom fields
  const customFieldsResult = await pool.query(
    'SELECT name, field_type, options, position, show_on_card FROM board_custom_fields WHERE board_id = $1 ORDER BY position',
    [boardId]
  );

  // Group checklist items by card_id
  const checklistByCard: Record<string, { text: string; position: number }[]> = {};
  checklistResult.rows.forEach((row: any) => {
    if (!checklistByCard[row.card_id]) checklistByCard[row.card_id] = [];
    checklistByCard[row.card_id].push({ text: row.text, position: row.position });
  });

  // Group cards by column_id
  const cardsByColumn: Record<string, any[]> = {};
  cardsResult.rows.forEach((row: any) => {
    if (!cardsByColumn[row.column_id]) cardsByColumn[row.column_id] = [];
    cardsByColumn[row.column_id].push(row);
  });

  // Build template data
  const columns = colsResult.rows.map((col: any) => {
    const cards = (cardsByColumn[col.id] || []).map((card: any) => {
      const item: any = {
        title: card.title,
        description: card.description || '',
        position: card.position,
      };
      const checklist = checklistByCard[card.id];
      if (checklist && checklist.length > 0) {
        item.checklist_items = checklist;
      }
      return item;
    });
    return { name: col.name, position: col.position, cards };
  });

  return {
    columns,
    labels: labelsResult.rows.map((r: any) => ({ name: r.name, color: r.color })),
    custom_fields: customFieldsResult.rows.map((r: any) => ({
      name: r.name,
      field_type: r.field_type,
      options: r.options || undefined,
      position: r.position,
      show_on_card: r.show_on_card,
    })),
  };
}

// GET / — List all templates (admin only)
router.get('/', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM board_templates ORDER BY is_builtin DESC, created_at'
    );

    const templates = result.rows.map((row: any) => {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      const columnCount = data.columns ? data.columns.length : 0;
      const cardCount = data.columns
        ? data.columns.reduce((sum: number, col: any) => sum + (col.cards ? col.cards.length : 0), 0)
        : 0;
      return { ...row, column_count: columnCount, card_count: cardCount };
    });

    res.json(templates);
  } catch (error) {
    console.error('List templates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — Create template from a board (admin only)
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { board_id, name, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Template name is required' });
    }
    if (name.length > 255) {
      return res.status(400).json({ error: 'Template name must be 255 characters or fewer' });
    }
    if (description && description.length > 10000) {
      return res.status(400).json({ error: 'Description must be 10000 characters or fewer' });
    }

    // Verify the board exists
    const boardCheck = await pool.query('SELECT id FROM boards WHERE id = $1', [board_id]);
    if (boardCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const data = await snapshotBoard(board_id);

    const result = await pool.query(
      `INSERT INTO board_templates (name, description, is_builtin, data, created_by)
       VALUES ($1, $2, false, $3, $4)
       RETURNING *`,
      [name.trim(), description || null, JSON.stringify(data), req.user!.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/use — Create a new board from a template (collaborator or admin)
router.post('/:id/use', authenticate, requireMember, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Board name is required' });
    }
    if (name.length > 255) {
      return res.status(400).json({ error: 'Board name must be 255 characters or fewer' });
    }

    // Fetch template
    const tplResult = await pool.query('SELECT * FROM board_templates WHERE id = $1', [id]);
    if (tplResult.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const template = tplResult.rows[0];
    const data: TemplateData = typeof template.data === 'string'
      ? JSON.parse(template.data)
      : template.data;

    // Use a transaction so partial failures don't leave orphaned data
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create board
      const boardResult = await client.query(
        'INSERT INTO boards (name, description, created_by) VALUES ($1, $2, $3) RETURNING *',
        [name.trim(), description || null, req.user!.id]
      );
      const board = boardResult.rows[0];

      // Add creator as board ADMIN
      await client.query(
        'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)',
        [board.id, req.user!.id, 'ADMIN']
      );

      // Create labels
      for (const label of (data.labels || [])) {
        await client.query(
          'INSERT INTO board_labels (board_id, name, color) VALUES ($1, $2, $3)',
          [board.id, label.name, label.color]
        );
      }

      // Create custom fields
      for (const field of (data.custom_fields || [])) {
        await client.query(
          `INSERT INTO board_custom_fields (board_id, name, field_type, options, position, show_on_card)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [board.id, field.name, field.field_type, field.options ? JSON.stringify(field.options) : null, field.position, field.show_on_card]
        );
      }

      // Create columns and cards
      for (const col of (data.columns || [])) {
        const colResult = await client.query(
          'INSERT INTO columns (board_id, name, position) VALUES ($1, $2, $3) RETURNING id',
          [board.id, col.name, col.position]
        );
        const columnId = colResult.rows[0].id;

        for (const card of (col.cards || [])) {
          const cardResult = await client.query(
            'INSERT INTO cards (column_id, title, description, position) VALUES ($1, $2, $3, $4) RETURNING id',
            [columnId, card.title, card.description || '', card.position]
          );
          const cardId = cardResult.rows[0].id;

          for (const item of (card.checklist_items || [])) {
            await client.query(
              'INSERT INTO card_checklist_items (card_id, text, position) VALUES ($1, $2, $3)',
              [cardId, item.text, item.position]
            );
          }
        }
      }

      await client.query('COMMIT');
      res.status(201).json(board);
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Use template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id — Delete user-created template (admin only)
router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Check if template exists
    const tplResult = await pool.query('SELECT id, is_builtin FROM board_templates WHERE id = $1', [id]);
    if (tplResult.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    if (tplResult.rows[0].is_builtin) {
      return res.status(403).json({ error: 'Cannot delete built-in templates' });
    }

    await pool.query('DELETE FROM board_templates WHERE id = $1', [id]);

    res.json({ message: 'Template deleted' });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
