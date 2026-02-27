import { Router } from 'express';
import { stringify } from 'csv-stringify/sync';
import { parse } from 'csv-parse/sync';
import multer from 'multer';
import crypto from 'crypto';
import pool from '../db';
import { authenticate, requireBoardRole } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Temporary storage for parsed CSV data, keyed by a random ID
const pendingImports = new Map<string, { rows: Record<string, string>[]; headers: string[]; boardId: string; userId: string; expiresAt: number }>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of pendingImports) {
    if (value.expiresAt < now) pendingImports.delete(key);
  }
}, 5 * 60 * 1000);

// GET /api/boards/:boardId/csv/export
router.get('/boards/:boardId/csv/export', authenticate, requireBoardRole('ADMIN'), async (req: AuthRequest, res) => {
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
      `SELECT ca.card_id, COALESCE(u.username, ca.display_name) as name
       FROM card_assignees ca
       LEFT JOIN users u ON ca.user_id = u.id
       INNER JOIN cards c ON ca.card_id = c.id
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1 AND c.archived = false`,
      [boardId]
    );
    const assigneesByCard = new Map<string, string[]>();
    for (const row of assigneesResult.rows) {
      const list = assigneesByCard.get(row.card_id) || [];
      list.push(row.name);
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
       INNER JOIN cards c ON v.card_id = c.id
       WHERE f.board_id = $1 AND c.archived = false`,
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
    const safeName = boardName.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').toLowerCase().replace(/^-+|-+$/g, '') || 'board';
    const date = new Date().toISOString().split('T')[0];
    const filename = `${safeName}-${date}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    console.error('CSV export error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards/:boardId/csv/import/preview
router.post('/boards/:boardId/csv/import/preview', authenticate, requireBoardRole('ADMIN'), upload.single('file'), async (req: AuthRequest, res) => {
  try {
    const { boardId } = req.params;

    // Verify board exists
    const boardResult = await pool.query('SELECT id FROM boards WHERE id = $1', [boardId]);
    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const csvContent = req.file.buffer.toString('utf-8');
    let records: Record<string, string>[];
    try {
      records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
    } catch (parseErr: any) {
      return res.status(400).json({ error: `Invalid CSV: ${parseErr.message}` });
    }

    if (records.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty (no data rows)' });
    }

    const headers = Object.keys(records[0]);

    // Auto-map headers to Pliny fields
    const fieldAliases: Record<string, string[]> = {
      title: ['title', 'name', 'card', 'card title', 'card name', 'task', 'task name'],
      description: ['description', 'desc', 'details', 'body', 'notes'],
      column: ['column', 'list', 'status', 'stage', 'column name'],
      assignees: ['assignees', 'assignee', 'assigned', 'assigned to', 'owner', 'owners'],
      labels: ['labels', 'label', 'tags', 'tag', 'category', 'categories'],
      due_date: ['due date', 'due_date', 'duedate', 'deadline', 'due'],
      start_date: ['start date', 'start_date', 'startdate', 'start'],
      position: ['position', 'order', 'sort', 'index'],
    };

    // Fetch board custom fields for mapping
    const customFieldsResult = await pool.query(
      'SELECT id, name, field_type FROM board_custom_fields WHERE board_id = $1 ORDER BY position',
      [boardId]
    );

    const suggestedMapping: Record<string, string> = {};
    for (const header of headers) {
      const lowerHeader = header.toLowerCase().trim();
      let matched = false;

      // Check built-in fields
      for (const [field, aliases] of Object.entries(fieldAliases)) {
        if (aliases.includes(lowerHeader)) {
          suggestedMapping[header] = field;
          matched = true;
          break;
        }
      }

      // Check custom fields
      if (!matched) {
        for (const cf of customFieldsResult.rows) {
          if (cf.name.toLowerCase() === lowerHeader) {
            suggestedMapping[header] = `custom:${cf.id}`;
            matched = true;
            break;
          }
        }
      }

      if (!matched) {
        suggestedMapping[header] = 'skip';
      }
    }

    // Store parsed data for the confirm step
    const importId = crypto.randomUUID();
    pendingImports.set(importId, {
      rows: records,
      headers,
      boardId,
      userId: req.user!.id,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minute expiry
    });

    res.json({
      importId,
      headers,
      suggestedMapping,
      sampleRows: records.slice(0, 5),
      rowCount: records.length,
      customFields: customFieldsResult.rows,
    });
  } catch (error) {
    console.error('CSV import preview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards/:boardId/csv/import/confirm
router.post('/boards/:boardId/csv/import/confirm', authenticate, requireBoardRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const { boardId } = req.params;
    const { importId, mapping } = req.body as { importId: string; mapping: Record<string, string> };

    if (!importId || !mapping) {
      return res.status(400).json({ error: 'importId and mapping are required' });
    }

    const pending = pendingImports.get(importId);
    if (!pending) {
      return res.status(400).json({ error: 'Import session expired or not found. Please re-upload the file.' });
    }
    if (pending.boardId !== boardId || pending.userId !== req.user!.id) {
      return res.status(403).json({ error: 'Import session mismatch' });
    }

    // Clean up the pending import
    pendingImports.delete(importId);

    // Verify title mapping exists
    const titleHeader = Object.entries(mapping).find(([_, field]) => field === 'title')?.[0];
    if (!titleHeader) {
      return res.status(400).json({ error: 'A column must be mapped to Title' });
    }

    // Fetch columns for the board
    const columnsResult = await pool.query(
      'SELECT id, name, position FROM columns WHERE board_id = $1 ORDER BY position',
      [boardId]
    );
    if (columnsResult.rows.length === 0) {
      return res.status(400).json({ error: 'Board has no columns' });
    }
    const columns = columnsResult.rows;
    const columnByName = new Map(columns.map((c: any) => [c.name.toLowerCase(), c.id]));
    const firstColumnId = columns[0].id;

    // Fetch existing labels
    const existingLabels = await pool.query(
      'SELECT id, name FROM board_labels WHERE board_id = $1',
      [boardId]
    );
    const labelByName = new Map(existingLabels.rows.map((l: any) => [l.name.toLowerCase(), l.id]));

    // Get max positions per column
    const positionsResult = await pool.query(
      `SELECT c.column_id, COALESCE(MAX(c.position), -1) as max_pos
       FROM cards c INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1 GROUP BY c.column_id`,
      [boardId]
    );
    const maxPositions = new Map(positionsResult.rows.map((r: any) => [r.column_id, r.max_pos]));

    const client = await pool.connect();
    const errors: { row: number; field: string; message: string }[] = [];
    let created = 0;

    try {
      await client.query('BEGIN');

      for (let i = 0; i < pending.rows.length; i++) {
        const row = pending.rows[i];
        const rowNum = i + 2; // +2 for 1-indexed + header row

        // Extract mapped values
        let title = '';
        let description = '';
        let columnName = '';
        let assigneesStr = '';
        let labelsStr = '';
        let dueDate: string | null = null;
        let startDate: string | null = null;
        let position: number | null = null;
        const customFieldValues: { fieldId: string; value: string }[] = [];

        for (const [header, field] of Object.entries(mapping)) {
          if (field === 'skip') continue;
          const value = (row[header] || '').trim();
          if (!value) continue;

          switch (field) {
            case 'title': title = value; break;
            case 'description': description = value; break;
            case 'column': columnName = value; break;
            case 'assignees': assigneesStr = value; break;
            case 'labels': labelsStr = value; break;
            case 'due_date': {
              const d = new Date(value);
              if (isNaN(d.getTime())) {
                errors.push({ row: rowNum, field: 'due_date', message: `Invalid date: "${value}"` });
              } else {
                dueDate = d.toISOString().split('T')[0];
              }
              break;
            }
            case 'start_date': {
              const d = new Date(value);
              if (isNaN(d.getTime())) {
                errors.push({ row: rowNum, field: 'start_date', message: `Invalid date: "${value}"` });
              } else {
                startDate = d.toISOString().split('T')[0];
              }
              break;
            }
            case 'position': {
              const p = parseInt(value, 10);
              if (!isNaN(p)) position = p;
              break;
            }
            default: {
              if (field.startsWith('custom:')) {
                customFieldValues.push({ fieldId: field.slice(7), value });
              }
            }
          }
        }

        // Skip rows with no title
        if (!title) {
          errors.push({ row: rowNum, field: 'title', message: 'Missing title, row skipped' });
          continue;
        }

        // Validate title length
        if (title.length > 255) {
          title = title.substring(0, 255);
          errors.push({ row: rowNum, field: 'title', message: 'Title truncated to 255 characters' });
        }

        // Validate description length
        if (description.length > 10000) {
          description = description.substring(0, 10000);
          errors.push({ row: rowNum, field: 'description', message: 'Description truncated to 10000 characters' });
        }

        // Resolve column
        const columnId = columnName ? (columnByName.get(columnName.toLowerCase()) || firstColumnId) : firstColumnId;
        if (columnName && !columnByName.has(columnName.toLowerCase())) {
          errors.push({ row: rowNum, field: 'column', message: `Column "${columnName}" not found, using "${columns[0].name}"` });
        }

        // Determine position
        if (position === null) {
          const maxPos = maxPositions.get(columnId) ?? -1;
          position = maxPos + 1;
          maxPositions.set(columnId, position);
        }

        // Insert card
        const cardResult = await client.query(
          `INSERT INTO cards (column_id, title, description, position, due_date, start_date)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [columnId, title, description, position, dueDate, startDate]
        );
        const cardId = cardResult.rows[0].id;

        // Handle assignees (comma-separated)
        if (assigneesStr) {
          const assigneeNames = assigneesStr.split(',').map(n => n.trim()).filter(Boolean);
          for (const name of assigneeNames) {
            const trimmed = name.trim();
            if (!trimmed) continue;
            const memberMatch = await client.query(
              `SELECT u.id FROM board_members bm
               JOIN users u ON bm.user_id = u.id
               WHERE bm.board_id = $1 AND LOWER(u.username) = LOWER($2)`,
              [boardId, trimmed]
            );
            if (memberMatch.rows.length > 0) {
              await client.query(
                'INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [cardId, memberMatch.rows[0].id]
              );
            } else {
              await client.query(
                'INSERT INTO card_assignees (card_id, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [cardId, trimmed]
              );
            }
          }
        }

        // Handle labels (comma-separated)
        if (labelsStr) {
          const labelNames = labelsStr.split(',').map(n => n.trim()).filter(Boolean);
          for (const labelName of labelNames) {
            let labelId = labelByName.get(labelName.toLowerCase());
            if (!labelId) {
              // Auto-create label with a default color
              const colors = ['#5746af', '#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];
              const color = colors[labelByName.size % colors.length];
              const newLabel = await client.query(
                'INSERT INTO board_labels (board_id, name, color) VALUES ($1, $2, $3) RETURNING id',
                [boardId, labelName, color]
              );
              labelId = newLabel.rows[0].id;
              labelByName.set(labelName.toLowerCase(), labelId);
            }
            await client.query(
              'INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [cardId, labelId]
            );
          }
        }

        // Handle custom field values
        for (const { fieldId, value } of customFieldValues) {
          await client.query(
            `INSERT INTO card_custom_field_values (card_id, field_id, value)
             VALUES ($1, $2, $3)
             ON CONFLICT (card_id, field_id) DO UPDATE SET value = $3, updated_at = NOW()`,
            [cardId, fieldId, value]
          );
        }

        created++;
      }

      await client.query('COMMIT');
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

    // Emit socket update so board refreshes
    const io = req.app.get('io');
    io.to(`board:${boardId}`).emit('board-updated');

    res.json({ created, errors });
  } catch (error) {
    console.error('CSV import confirm error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { pendingImports };
export default router;
