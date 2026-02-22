import { Router } from 'express';
import { stringify } from 'csv-stringify/sync';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// GET /api/boards/:boardId/csv/export
router.get('/boards/:boardId/csv/export', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { boardId } = req.params;

    // Verify board exists
    const boardResult = await pool.query('SELECT name FROM boards WHERE id = $1', [boardId]);
    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }
    const boardName = boardResult.rows[0].name;

    // Fetch columns
    const columnsResult = await pool.query(
      'SELECT id, name FROM columns WHERE board_id = $1 ORDER BY position',
      [boardId]
    );
    const columnMap = new Map(columnsResult.rows.map((c: any) => [c.id, c.name]));

    // Fetch non-archived cards ordered by column position, then card position
    const cardsResult = await pool.query(
      `SELECT c.id, c.title, c.description, c.column_id, c.position, c.due_date, c.start_date, c.created_at
       FROM cards c
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1 AND c.archived = false
       ORDER BY col.position, c.position`,
      [boardId]
    );

    // Fetch assignees for all cards
    const assigneesResult = await pool.query(
      `SELECT ca.card_id, ca.assignee_name
       FROM card_assignees ca
       INNER JOIN cards c ON ca.card_id = c.id
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1 AND c.archived = false`,
      [boardId]
    );
    const assigneesByCard = new Map<string, string[]>();
    for (const row of assigneesResult.rows) {
      const list = assigneesByCard.get(row.card_id) || [];
      list.push(row.assignee_name);
      assigneesByCard.set(row.card_id, list);
    }

    // Fetch labels for all cards
    const labelsResult = await pool.query(
      `SELECT cl.card_id, bl.name
       FROM card_labels cl
       INNER JOIN board_labels bl ON cl.label_id = bl.id
       INNER JOIN cards c ON cl.card_id = c.id
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1 AND c.archived = false`,
      [boardId]
    );
    const labelsByCard = new Map<string, string[]>();
    for (const row of labelsResult.rows) {
      const list = labelsByCard.get(row.card_id) || [];
      list.push(row.name);
      labelsByCard.set(row.card_id, list);
    }

    // Fetch custom field definitions
    const customFieldsResult = await pool.query(
      'SELECT id, name FROM board_custom_fields WHERE board_id = $1 ORDER BY position',
      [boardId]
    );
    const customFields = customFieldsResult.rows;

    // Fetch custom field values
    const cfValuesResult = await pool.query(
      `SELECT v.card_id, v.field_id, v.value
       FROM card_custom_field_values v
       JOIN board_custom_fields f ON v.field_id = f.id
       WHERE f.board_id = $1`,
      [boardId]
    );
    const cfValuesByCard = new Map<string, Map<string, string>>();
    for (const row of cfValuesResult.rows) {
      if (!cfValuesByCard.has(row.card_id)) {
        cfValuesByCard.set(row.card_id, new Map());
      }
      cfValuesByCard.get(row.card_id)!.set(row.field_id, row.value);
    }

    // Build CSV header
    const baseHeaders = ['Title', 'Description', 'Column', 'Position', 'Assignees', 'Labels', 'Due Date', 'Start Date', 'Created At'];
    const headers = [...baseHeaders, ...customFields.map((f: any) => f.name)];

    // Build CSV rows
    const rows = cardsResult.rows.map((card: any) => {
      const baseRow = [
        card.title || '',
        card.description || '',
        columnMap.get(card.column_id) || '',
        String(card.position),
        (assigneesByCard.get(card.id) || []).join(', '),
        (labelsByCard.get(card.id) || []).join(', '),
        card.due_date ? new Date(card.due_date).toISOString().split('T')[0] : '',
        card.start_date ? new Date(card.start_date).toISOString().split('T')[0] : '',
        card.created_at ? new Date(card.created_at).toISOString() : '',
      ];

      const cfValues = cfValuesByCard.get(card.id);
      const cfRow = customFields.map((f: any) => cfValues?.get(f.id) || '');

      return [...baseRow, ...cfRow];
    });

    // Generate CSV
    const csv = stringify([headers, ...rows]);

    // Sanitize board name for filename
    const safeName = boardName.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').toLowerCase();
    const date = new Date().toISOString().split('T')[0];
    const filename = `${safeName}-${date}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    console.error('CSV export error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
