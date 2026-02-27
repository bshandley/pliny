import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin, requireBoardRole } from '../middleware/auth';
import { AuthRequest } from '../types';
import { logActivity } from './activity';
import { notifyCardMembers, createNotification } from '../services/notificationHelper';
import { triggerWebhook } from '../services/webhookService';

const router = Router();

// Create card
router.post('/', authenticate, requireBoardRole('COLLABORATOR'), async (req: AuthRequest, res) => {
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
router.put('/:id', authenticate, requireBoardRole('COLLABORATOR'), async (req: AuthRequest, res) => {
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
    let oldAssignees: { user_id: string | null; display_name: string | null }[] = [];
    if (assignees !== undefined) {
      const oldAssigneesResult = await pool.query('SELECT user_id, display_name FROM card_assignees WHERE card_id = $1', [id]);
      oldAssignees = oldAssigneesResult.rows;
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
        // Get board members for auto-linking
        const boardResult = await pool.query(
          'SELECT col.board_id FROM columns col JOIN cards c ON c.column_id = col.id WHERE c.id = $1',
          [id]
        );
        const thisBoardId = boardResult.rows[0]?.board_id;
        let boardMemberMap: Record<string, string> = {};
        if (thisBoardId) {
          const bmResult = await pool.query(
            'SELECT u.id, u.username FROM board_members bm JOIN users u ON bm.user_id = u.id WHERE bm.board_id = $1',
            [thisBoardId]
          );
          bmResult.rows.forEach((r: any) => { boardMemberMap[r.username.toLowerCase()] = r.id; });
        }

        for (const assignee of assignees) {
          if (assignee.user_id) {
            await pool.query(
              'INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [id, assignee.user_id]
            );
          } else if (assignee.display_name) {
            const matchedUserId = boardMemberMap[assignee.display_name.toLowerCase()];
            if (matchedUserId) {
              await pool.query(
                'INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [id, matchedUserId]
              );
            } else {
              await pool.query(
                'INSERT INTO card_assignees (card_id, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [id, assignee.display_name]
              );
            }
          }
        }
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
      `SELECT ca.id, ca.user_id, ca.display_name, u.username
       FROM card_assignees ca
       LEFT JOIN users u ON ca.user_id = u.id
       WHERE ca.card_id = $1`,
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
      const keyFn = (a: any) => a.user_id || a.display_name || '';
      const nameFn = (a: any) => a.username || a.display_name || '';
      const oldKeys = new Set(oldAssignees.map(keyFn));
      const newAssigneeRows = assigneesResult.rows;
      const newKeys = new Set(newAssigneeRows.map(keyFn));
      const addedNames = newAssigneeRows.filter((a: any) => !oldKeys.has(keyFn(a))).map(nameFn);
      const removedNames = oldAssignees.filter(a => !newKeys.has(keyFn(a))).map(a => a.display_name || '');
      if (addedNames.length > 0 || removedNames.length > 0) {
        logActivity(id, req.user!.id, 'assignees_changed', { added: addedNames, removed: removedNames });
      }

      // Notify newly added linked assignees
      const oldLinkedIds = new Set(oldAssignees.filter(a => a.user_id).map(a => a.user_id));
      const newLinkedIds = newAssigneeRows.filter((a: any) => a.user_id).map((a: any) => a.user_id);
      const addedLinkedIds = newLinkedIds.filter((uid: string) => !oldLinkedIds.has(uid));
      if (addedLinkedIds.length > 0) {
        const io = req.app.get('io');
        const userSockets: Map<string, string[]> = req.app.get('userSockets');
        const cardInfo = await pool.query(
          `SELECT c.title, col.board_id, b.name as board_name
           FROM cards c JOIN columns col ON c.column_id = col.id
           JOIN boards b ON col.board_id = b.id WHERE c.id = $1`, [id]
        );
        if (cardInfo.rows.length > 0) {
          const { title: cardTitle, board_id: bId, board_name } = cardInfo.rows[0];
          for (const userId of addedLinkedIds) {
            await createNotification({
              userId, type: 'assigned_card', cardId: id, boardId: bId,
              actorId: req.user!.id, actorUsername: req.user!.username,
              detail: { card_title: cardTitle, board_name }, io, userSockets,
            });
          }
        }
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
      assignees: assigneesResult.rows,
      labels: labelsResult.rows
    });
  } catch (error) {
    console.error('Update card error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete card
router.delete('/:id', authenticate, requireBoardRole('COLLABORATOR'), async (req: AuthRequest, res) => {
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
