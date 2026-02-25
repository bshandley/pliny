import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { logActivity } from './activity';
import { notifyCardMembers } from '../services/notificationHelper';
import { triggerWebhook } from '../services/webhookService';

const router = Router();

// Create card
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { column_id, title, description, position, due_date } = req.body;

    if (title && title.length > 255) {
      return res.status(400).json({ error: 'Card title must be 255 characters or fewer' });
    }
    if (description && description.length > 10000) {
      return res.status(400).json({ error: 'Card description must be 10000 characters or fewer' });
    }

    const result = await pool.query(
      'INSERT INTO cards (column_id, title, description, position, due_date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [column_id, title, description, position, due_date || null]
    );

    logActivity(result.rows[0].id, req.user!.id, 'created');

    // Get board_id for webhook
    const colResult = await pool.query('SELECT board_id FROM columns WHERE id = $1', [column_id]);
    const boardId = colResult.rows[0]?.board_id;

    // Trigger webhook
    triggerWebhook('card.created', {
      card: result.rows[0],
      board_id: boardId,
      user: { id: req.user!.id, username: req.user!.username },
    }, boardId);

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
    const { column_id, title, description, assignees, position, due_date, start_date } = req.body;

    if (title !== undefined && title.length > 255) {
      return res.status(400).json({ error: 'Card title must be 255 characters or fewer' });
    }
    if (description !== undefined && description.length > 10000) {
      return res.status(400).json({ error: 'Card description must be 10000 characters or fewer' });
    }

    // Fetch old state for activity logging
    const oldCard = await pool.query('SELECT * FROM cards WHERE id = $1', [id]);
    if (oldCard.rows.length === 0) return res.status(404).json({ error: 'Card not found' });
    const old = oldCard.rows[0];

    // Fetch old assignees before they get deleted
    let oldAssignees: string[] = [];
    if (assignees !== undefined) {
      const oldAssigneesResult = await pool.query('SELECT assignee_name FROM card_assignees WHERE card_id = $1', [id]);
      oldAssignees = oldAssigneesResult.rows.map((r: any) => r.assignee_name);
    }

    // Fetch old labels before they get deleted
    let oldLabels: string[] = [];
    if (req.body.labels !== undefined) {
      const oldLabelsResult = await pool.query('SELECT label_id FROM card_labels WHERE card_id = $1', [id]);
      oldLabels = oldLabelsResult.rows.map((r: any) => r.label_id);
    }

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
    if (start_date !== undefined) {
      updates.push(`start_date = $${paramCount++}`);
      values.push(start_date || null);
    }
    if (req.body.archived !== undefined) {
      updates.push(`archived = $${paramCount++}`);
      values.push(req.body.archived);
    }
    if (req.body.labels !== undefined) {
      // Labels handled after the main update
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
      await pool.query('DELETE FROM card_assignees WHERE card_id = $1', [id]);
      if (Array.isArray(assignees) && assignees.length > 0) {
        const vals = assignees.map((_name: string, i: number) => `($1, $${i + 2})`).join(', ');
        await pool.query(
          `INSERT INTO card_assignees (card_id, assignee_name) VALUES ${vals}`,
          [id, ...assignees]
        );
      }
    }

    // Update labels if provided
    if (req.body.labels !== undefined) {
      await pool.query('DELETE FROM card_labels WHERE card_id = $1', [id]);
      const labels = req.body.labels;
      if (Array.isArray(labels) && labels.length > 0) {
        const vals = labels.map((_id: string, i: number) => `($1, $${i + 2})`).join(', ');
        await pool.query(
          `INSERT INTO card_labels (card_id, label_id) VALUES ${vals}`,
          [id, ...labels]
        );
      }
    }

    // Fetch updated assignees and labels
    const assigneesResult = await pool.query(
      'SELECT assignee_name FROM card_assignees WHERE card_id = $1',
      [id]
    );
    const labelsResult = await pool.query(
      `SELECT bl.id, bl.name, bl.color FROM card_labels cl
       JOIN board_labels bl ON cl.label_id = bl.id
       WHERE cl.card_id = $1`,
      [id]
    );

    // Log activity for each change
    if (column_id !== undefined && column_id !== old.column_id) {
      const cols = await pool.query('SELECT id, name FROM columns WHERE id = ANY($1)', [[old.column_id, column_id]]);
      const colMap: Record<string, string> = {};
      cols.rows.forEach((c: any) => { colMap[c.id] = c.name; });
      logActivity(id, req.user!.id, 'moved', {
        from_column: colMap[old.column_id] || old.column_id,
        to_column: colMap[column_id] || column_id
      });

      // Check if moved to last (rightmost) column = "done"
      const lastCol = await pool.query(
        'SELECT id FROM columns WHERE board_id = (SELECT board_id FROM columns WHERE id = $1) ORDER BY position DESC LIMIT 1',
        [column_id]
      );
      if (lastCol.rows.length > 0 && lastCol.rows[0].id === column_id) {
        const io = req.app.get('io');
        const userSockets: Map<string, string[]> = req.app.get('userSockets');
        notifyCardMembers(id, 'card_completed', req.user!.id, req.user!.username, {}, io, userSockets);
      }
    }

    if (title !== undefined && title !== old.title) {
      logActivity(id, req.user!.id, 'title_changed', { from: old.title, to: title });
    }

    if (description !== undefined && (description || null) !== (old.description || null)) {
      logActivity(id, req.user!.id, 'description_changed');
      const io = req.app.get('io');
      const userSockets: Map<string, string[]> = req.app.get('userSockets');
      notifyCardMembers(id, 'description_changed', req.user!.id, req.user!.username, {}, io, userSockets);
    }

    if (due_date !== undefined) {
      const oldDue = old.due_date ? old.due_date.toISOString().split('T')[0] : null;
      const newDue = due_date || null;
      if (oldDue !== newDue) {
        logActivity(id, req.user!.id, 'due_date_changed', { from: oldDue, to: newDue });
      }
    }

    if (start_date !== undefined) {
      const oldStart = old.start_date ? old.start_date.toISOString().split('T')[0] : null;
      const newStart = start_date || null;
      if (oldStart !== newStart) {
        logActivity(id, req.user!.id, 'start_date_changed', { from: oldStart, to: newStart });
      }
    }

    if (req.body.archived !== undefined && req.body.archived !== old.archived) {
      logActivity(id, req.user!.id, req.body.archived ? 'archived' : 'unarchived');
    }

    if (assignees !== undefined) {
      const oldSet = new Set(oldAssignees);
      const newSet = new Set(assignees as string[]);
      const added = (assignees as string[]).filter((a: string) => !oldSet.has(a));
      const removed = oldAssignees.filter((a: string) => !newSet.has(a));
      if (added.length > 0 || removed.length > 0) {
        logActivity(id, req.user!.id, 'assignees_changed', { added, removed });
      }
    }

    if (req.body.labels !== undefined) {
      const labels = req.body.labels;
      const oldSet = new Set(oldLabels);
      const newSet = new Set(labels as string[]);
      const added = (labels as string[]).filter((l: string) => !oldSet.has(l));
      const removed = oldLabels.filter((l: string) => !newSet.has(l));
      if (added.length > 0 || removed.length > 0) {
        logActivity(id, req.user!.id, 'labels_changed', { added, removed });
      }
    }

    // Get board_id for webhooks
    const colResult = await pool.query('SELECT board_id FROM columns WHERE id = $1', [result.rows[0].column_id]);
    const boardId = colResult.rows[0]?.board_id;

    // Trigger webhooks for specific events
    if (column_id !== undefined && column_id !== old.column_id) {
      triggerWebhook('card.moved', {
        card: result.rows[0],
        board_id: boardId,
        from_column_id: old.column_id,
        to_column_id: column_id,
        user: { id: req.user!.id, username: req.user!.username },
      }, boardId);
    }

    if (req.body.archived !== undefined && req.body.archived !== old.archived && req.body.archived) {
      triggerWebhook('card.archived', {
        card: result.rows[0],
        board_id: boardId,
        user: { id: req.user!.id, username: req.user!.username },
      }, boardId);
    }

    // Generic card.updated for other changes
    if (title !== undefined || description !== undefined || due_date !== undefined || start_date !== undefined) {
      triggerWebhook('card.updated', {
        card: result.rows[0],
        board_id: boardId,
        changes: {
          title: title !== undefined && title !== old.title,
          description: description !== undefined && (description || null) !== (old.description || null),
          due_date: due_date !== undefined,
          start_date: start_date !== undefined,
        },
        user: { id: req.user!.id, username: req.user!.username },
      }, boardId);
    }

    res.json({
      ...result.rows[0],
      assignees: assigneesResult.rows.map(r => r.assignee_name),
      labels: labelsResult.rows
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

    // Get board_id for webhook
    const colResult = await pool.query('SELECT board_id FROM columns WHERE id = $1', [result.rows[0].column_id]);
    const boardId = colResult.rows[0]?.board_id;

    // Trigger webhook
    triggerWebhook('card.deleted', {
      card_id: id,
      card: result.rows[0],
      board_id: boardId,
      user: { id: req.user!.id, username: req.user!.username },
    }, boardId);

    res.json({ message: 'Card deleted' });
  } catch (error) {
    console.error('Delete card error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
