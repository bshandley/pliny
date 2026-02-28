import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin, requireMember, requireBoardRole } from '../middleware/auth';
import { AuthRequest } from '../types';
import { triggerWebhook } from '../services/webhookService';

const router = Router();

// Get all boards (filtered by permission)
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;

    if (user.role === 'ADMIN') {
      // Admin sees all boards — left join to get personal star status
      const result = await pool.query(
        `SELECT b.*, COALESCE(bm.is_starred, false) AS is_starred
         FROM boards b
         LEFT JOIN board_members bm ON b.id = bm.board_id AND bm.user_id = $1
         ORDER BY b.created_at DESC`,
        [user.id]
      );
      res.json(result.rows);
    } else {
      // Non-admin users only see boards they're members of
      const result = await pool.query(
        `SELECT b.*, bm.is_starred FROM boards b
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

// Get all publicly shared boards (admin only)
router.get('/admin/shared', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, public_token, created_at, updated_at
       FROM boards WHERE public_token IS NOT NULL
       ORDER BY updated_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get shared boards error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Star a board for the current user
router.post('/:id/star', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const result = await pool.query(
      `UPDATE board_members SET is_starred = true
       WHERE board_id = $1 AND user_id = $2
       RETURNING is_starred`,
      [id, user.id]
    );

    if (result.rows.length === 0) {
      // Admin may not have a board_members row — insert one
      if (user.role === 'ADMIN') {
        await pool.query(
          `INSERT INTO board_members (board_id, user_id, role, is_starred)
           VALUES ($1, $2, 'ADMIN', true)
           ON CONFLICT (board_id, user_id) DO UPDATE SET is_starred = true`,
          [id, user.id]
        );
        return res.json({ starred: true });
      }
      return res.status(404).json({ error: 'Board not found' });
    }

    res.json({ starred: true });
  } catch (error) {
    console.error('Star board error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Unstar a board for the current user
router.delete('/:id/star', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    await pool.query(
      `UPDATE board_members SET is_starred = false
       WHERE board_id = $1 AND user_id = $2`,
      [id, user.id]
    );

    res.json({ starred: false });
  } catch (error) {
    console.error('Unstar board error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single board with columns and cards
router.get('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    // Determine user's board role
    let currentUserRole: string = 'VIEWER';
    if (user.role === 'ADMIN') {
      currentUserRole = 'ADMIN';
    } else {
      const memberCheck = await pool.query(
        'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
        [id, user.id]
      );
      if (memberCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Board not found' });
      }
      currentUserRole = memberCheck.rows[0].role;
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
      `SELECT c.*,
              (SELECT COUNT(*) FROM cards sub WHERE sub.parent_id = c.id)::int as subtask_count,
              (SELECT COUNT(*) FROM cards sub
               JOIN columns subcol ON sub.column_id = subcol.id
               WHERE sub.parent_id = c.id
               AND subcol.position = (SELECT MAX(position) FROM columns WHERE board_id = $1))::int as subtask_done_count
       FROM cards c
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1
       ORDER BY c.position`,
      [id]
    );

    // Fetch assignees for all cards (unified: linked users + unlinked names)
    const assigneesResult = await pool.query(
      `SELECT ca.card_id, ca.id, ca.user_id, ca.display_name, u.username
       FROM card_assignees ca
       LEFT JOIN users u ON ca.user_id = u.id
       INNER JOIN cards c ON ca.card_id = c.id
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1`,
      [id]
    );

    // Fetch labels for all cards
    const cardLabelsResult = await pool.query(
      `SELECT cl.card_id, bl.id, bl.name, bl.color
       FROM card_labels cl
       INNER JOIN board_labels bl ON cl.label_id = bl.id
       INNER JOIN cards c ON cl.card_id = c.id
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1`,
      [id]
    );

    // Fetch checklist counts for all cards (including overdue count)
    const checklistResult = await pool.query(
      `SELECT ci.card_id,
              COUNT(*)::int as total,
              COUNT(*) FILTER (WHERE ci.checked)::int as checked,
              COUNT(*) FILTER (WHERE ci.due_date < CURRENT_DATE AND ci.checked = false)::int as overdue
       FROM card_checklist_items ci
       INNER JOIN cards c ON ci.card_id = c.id
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1
       GROUP BY ci.card_id`,
      [id]
    );

    // Fetch checklist items with due dates (for calendar subtask chips)
    const datedChecklistResult = await pool.query(
      `SELECT ci.id, ci.card_id, ci.text, ci.checked, ci.due_date, ci.assignee_name, ci.priority
       FROM card_checklist_items ci
       INNER JOIN cards c ON ci.card_id = c.id
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1 AND ci.due_date IS NOT NULL
       ORDER BY ci.due_date, ci.position`,
      [id]
    );

    // Fetch custom field definitions for this board
    const customFieldsResult = await pool.query(
      'SELECT * FROM board_custom_fields WHERE board_id = $1 ORDER BY position',
      [id]
    );

    // Fetch custom field values for all cards in this board
    const customFieldValuesResult = await pool.query(
      `SELECT v.card_id, v.field_id, v.value, f.name, f.field_type
       FROM card_custom_field_values v
       JOIN board_custom_fields f ON v.field_id = f.id
       WHERE f.board_id = $1`,
      [id]
    );

    // Group assignees by card_id
    const assigneesByCard: Record<string, { id: string; user_id: string | null; username: string | null; display_name: string | null }[]> = {};
    assigneesResult.rows.forEach((row: any) => {
      if (!assigneesByCard[row.card_id]) {
        assigneesByCard[row.card_id] = [];
      }
      assigneesByCard[row.card_id].push({
        id: row.id,
        user_id: row.user_id,
        username: row.username,
        display_name: row.display_name,
      });
    });

    // Group labels by card_id
    const labelsByCard: Record<string, { id: string; name: string; color: string }[]> = {};
    cardLabelsResult.rows.forEach(row => {
      if (!labelsByCard[row.card_id]) {
        labelsByCard[row.card_id] = [];
      }
      labelsByCard[row.card_id].push({ id: row.id, name: row.name, color: row.color });
    });

    // Group checklist counts by card_id
    const checklistByCard: Record<string, { total: number; checked: number; overdue: number }> = {};
    checklistResult.rows.forEach(row => {
      checklistByCard[row.card_id] = { total: row.total, checked: row.checked, overdue: row.overdue };
    });

    // Group dated checklist items by card_id
    const datedChecklistByCard: Record<string, any[]> = {};
    datedChecklistResult.rows.forEach((row: any) => {
      if (!datedChecklistByCard[row.card_id]) datedChecklistByCard[row.card_id] = [];
      datedChecklistByCard[row.card_id].push(row);
    });

    // Group custom field values by card_id
    const customFieldValuesByCard: Record<string, Record<string, { value: string; field_type: string; name: string }>> = {};
    customFieldValuesResult.rows.forEach((row: any) => {
      if (!customFieldValuesByCard[row.card_id]) customFieldValuesByCard[row.card_id] = {};
      customFieldValuesByCard[row.card_id][row.field_id] = {
        value: row.value,
        field_type: row.field_type,
        name: row.name,
      };
    });

    const board = boardResult.rows[0];
    const columns = columnsResult.rows;
    const cards = cardsResult.rows.map(card => ({
      ...card,
      assignees: assigneesByCard[card.id] || [],
      labels: labelsByCard[card.id] || [],
      checklist: checklistByCard[card.id] || null,
      custom_field_values: customFieldValuesByCard[card.id] || {},
      dated_checklist_items: datedChecklistByCard[card.id] || [],
    }));

    res.json({
      ...board,
      currentUserRole,
      custom_fields: customFieldsResult.rows,
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

// Export full board as JSON
router.get('/:id/export', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    // Check access: admin can access all, others must be a member
    if (user.role !== 'ADMIN') {
      const memberCheck = await pool.query(
        'SELECT 1 FROM board_members WHERE board_id = $1 AND user_id = $2',
        [id, user.id]
      );
      if (memberCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Board not found' });
      }
    }

    // Board
    const boardResult = await pool.query('SELECT id, name, created_at FROM boards WHERE id = $1', [id]);
    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }
    const board = boardResult.rows[0];

    // Labels
    const labelsResult = await pool.query(
      'SELECT id, name, color FROM board_labels WHERE board_id = $1 ORDER BY name',
      [id]
    );

    // Members
    const membersResult = await pool.query(
      `SELECT u.id, u.username, u.role, bm.added_at
       FROM board_members bm JOIN users u ON bm.user_id = u.id
       WHERE bm.board_id = $1 ORDER BY u.username`,
      [id]
    );

    // Columns
    const columnsResult = await pool.query(
      'SELECT id, name, position FROM columns WHERE board_id = $1 ORDER BY position',
      [id]
    );

    // All cards (including archived)
    const cardsResult = await pool.query(
      `SELECT c.id, c.column_id, c.title, c.description, c.position, c.archived,
              c.start_date, c.due_date, c.created_at, c.updated_at, c.parent_id
       FROM cards c JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1 ORDER BY c.position`,
      [id]
    );

    const cardIds = cardsResult.rows.map((c: any) => c.id);

    // Comments
    const commentsResult = cardIds.length > 0 ? await pool.query(
      `SELECT cc.id, cc.card_id, cc.text AS body, u.username AS author, cc.created_at
       FROM card_comments cc JOIN users u ON cc.user_id = u.id
       WHERE cc.card_id = ANY($1) ORDER BY cc.created_at`,
      [cardIds]
    ) : { rows: [] };

    // Checklist items
    const checklistResult = cardIds.length > 0 ? await pool.query(
      `SELECT id, card_id, text, checked, position, due_date, assignee_name, priority
       FROM card_checklist_items WHERE card_id = ANY($1) ORDER BY position`,
      [cardIds]
    ) : { rows: [] };

    // Card labels
    const cardLabelsResult = cardIds.length > 0 ? await pool.query(
      `SELECT cl.card_id, bl.id, bl.name, bl.color
       FROM card_labels cl JOIN board_labels bl ON cl.label_id = bl.id
       WHERE cl.card_id = ANY($1)`,
      [cardIds]
    ) : { rows: [] };

    // Card assignees
    const assigneesResult = cardIds.length > 0 ? await pool.query(
      `SELECT ca.card_id, ca.id, ca.user_id, ca.display_name, u.username
       FROM card_assignees ca LEFT JOIN users u ON ca.user_id = u.id
       WHERE ca.card_id = ANY($1)`,
      [cardIds]
    ) : { rows: [] };

    // Custom field values
    const cfvResult = cardIds.length > 0 ? await pool.query(
      `SELECT v.card_id, v.field_id, v.value, f.name, f.field_type
       FROM card_custom_field_values v JOIN board_custom_fields f ON v.field_id = f.id
       WHERE v.card_id = ANY($1)`,
      [cardIds]
    ) : { rows: [] };

    // Group by card_id
    const commentsByCard: Record<string, any[]> = {};
    commentsResult.rows.forEach((r: any) => {
      (commentsByCard[r.card_id] ||= []).push({ id: r.id, body: r.body, author: r.author, created_at: r.created_at });
    });
    const checklistByCard: Record<string, any[]> = {};
    checklistResult.rows.forEach((r: any) => {
      (checklistByCard[r.card_id] ||= []).push(r);
    });
    const labelsByCard: Record<string, any[]> = {};
    cardLabelsResult.rows.forEach((r: any) => {
      (labelsByCard[r.card_id] ||= []).push({ id: r.id, name: r.name, color: r.color });
    });
    const assigneesByCard: Record<string, any[]> = {};
    assigneesResult.rows.forEach((r: any) => {
      (assigneesByCard[r.card_id] ||= []).push({ id: r.id, user_id: r.user_id, username: r.username, display_name: r.display_name });
    });
    const cfvByCard: Record<string, any[]> = {};
    cfvResult.rows.forEach((r: any) => {
      (cfvByCard[r.card_id] ||= []).push({ field_id: r.field_id, name: r.name, field_type: r.field_type, value: r.value });
    });

    // Build card map by column
    const cardsByColumn: Record<string, any[]> = {};
    cardsResult.rows.forEach((card: any) => {
      const enriched = {
        id: card.id,
        title: card.title,
        description: card.description || '',
        position: card.position,
        archived: card.archived,
        start_date: card.start_date || null,
        due_date: card.due_date || null,
        parent_id: card.parent_id || null,
        created_at: card.created_at,
        updated_at: card.updated_at,
        labels: labelsByCard[card.id] || [],
        assignees: assigneesByCard[card.id] || [],
        checklist_items: checklistByCard[card.id] || [],
        custom_field_values: cfvByCard[card.id] || [],
        comments: commentsByCard[card.id] || [],
      };
      (cardsByColumn[card.column_id] ||= []).push(enriched);
    });

    const exportData = {
      export_version: 1,
      exported_at: new Date().toISOString(),
      board: {
        id: board.id,
        name: board.name,
        created_at: board.created_at,
        labels: labelsResult.rows,
        members: membersResult.rows,
        columns: columnsResult.rows.map((col: any) => ({
          id: col.id,
          name: col.name,
          position: col.position,
          cards: cardsByColumn[col.id] || [],
        })),
      },
    };

    res.json(exportData);
  } catch (error) {
    console.error('Export board error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create board
router.post('/', authenticate, requireMember, async (req: AuthRequest, res) => {
  try {
    const { name, description } = req.body;

    if (name && name.length > 255) {
      return res.status(400).json({ error: 'Board name must be 255 characters or fewer' });
    }
    if (description && description.length > 10000) {
      return res.status(400).json({ error: 'Board description must be 10000 characters or fewer' });
    }

    const result = await pool.query(
      'INSERT INTO boards (name, description, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name, description, req.user!.id]
    );

    // Add creator as board ADMIN
    await pool.query(
      'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)',
      [result.rows[0].id, req.user!.id, 'ADMIN']
    );

    // Trigger webhook for board.created
    triggerWebhook('board.created', {
      board: result.rows[0],
      user: { id: req.user!.id, username: req.user!.username },
    });

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create board error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update board
router.put('/:id', authenticate, requireBoardRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { name, description, archived } = req.body;

    if (name !== undefined && name.length > 255) {
      return res.status(400).json({ error: 'Board name must be 255 characters or fewer' });
    }
    if (description !== undefined && description.length > 10000) {
      return res.status(400).json({ error: 'Board description must be 10000 characters or fewer' });
    }

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description); }
    if (archived !== undefined) { fields.push(`archived = $${idx++}`); values.push(archived); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const result = await pool.query(
      `UPDATE boards SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    // Trigger webhook for board.updated
    triggerWebhook('board.updated', {
      board: result.rows[0],
      changes: { name: name !== undefined, description: description !== undefined, archived: archived !== undefined },
      user: { id: req.user!.id, username: req.user!.username },
    }, parseInt(id));

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update board error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete board
router.delete('/:id', authenticate, requireBoardRole('ADMIN'), async (req: AuthRequest, res) => {
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

// Get board members
router.get('/:id/members', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT u.id, u.username, u.role as global_role, bm.role as board_role, bm.added_at
       FROM board_members bm
       INNER JOIN users u ON bm.user_id = u.id
       WHERE bm.board_id = $1
       ORDER BY u.username`,
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get board members error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add board member (admin only)
router.post('/:id/members', authenticate, requireBoardRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { user_id, role } = req.body;
    const memberRole = role || 'EDITOR';

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    if (!['ADMIN', 'EDITOR', 'VIEWER'].includes(memberRole)) {
      return res.status(400).json({ error: 'Invalid role. Must be ADMIN, EDITOR, or VIEWER' });
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
      'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [id, user_id, memberRole]
    );

    res.status(201).json({ message: 'Member added' });
  } catch (error) {
    console.error('Add board member error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Generate public link for board (admin only)
router.post('/:id/public-link', authenticate, requireBoardRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE boards SET public_token = gen_random_uuid(), updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING public_token`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const token = result.rows[0].public_token;
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    res.json({ token, publicUrl: `${clientUrl}/public/${token}` });
  } catch (error) {
    console.error('Generate public link error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Revoke public link for board (admin only)
router.delete('/:id/public-link', authenticate, requireBoardRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE boards SET public_token = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    res.json({ message: 'Public link revoked' });
  } catch (error) {
    console.error('Revoke public link error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove board member (admin only)
router.delete('/:id/members/:userId', authenticate, requireBoardRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const { id, userId } = req.params;

    // Check if removing the last ADMIN
    const targetMember = await pool.query(
      'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
      [id, userId]
    );
    if (targetMember.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    if (targetMember.rows[0].role === 'ADMIN') {
      const adminCount = await pool.query(
        'SELECT COUNT(*) FROM board_members WHERE board_id = $1 AND role = $2',
        [id, 'ADMIN']
      );
      if (parseInt(adminCount.rows[0].count) <= 1) {
        return res.status(400).json({
          error: 'Cannot remove the last board admin. Transfer admin to another member first.'
        });
      }
    }

    await pool.query(
      'DELETE FROM board_members WHERE board_id = $1 AND user_id = $2',
      [id, userId]
    );

    res.json({ message: 'Member removed' });
  } catch (error) {
    console.error('Remove board member error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change board member role (board admin only)
router.put('/:id/members/:userId/role', authenticate, requireBoardRole('ADMIN'), async (req: AuthRequest, res) => {
  try {
    const { id, userId } = req.params;
    const { role } = req.body;

    if (!role || !['ADMIN', 'EDITOR', 'VIEWER'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be ADMIN, EDITOR, or VIEWER' });
    }

    // Check if demoting the last ADMIN
    const currentRole = await pool.query(
      'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
      [id, userId]
    );
    if (currentRole.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    if (currentRole.rows[0].role === 'ADMIN' && role !== 'ADMIN') {
      const adminCount = await pool.query(
        'SELECT COUNT(*) FROM board_members WHERE board_id = $1 AND role = $2',
        [id, 'ADMIN']
      );
      if (parseInt(adminCount.rows[0].count) <= 1) {
        return res.status(400).json({
          error: 'Cannot demote the last board admin. Promote another member first.'
        });
      }
    }

    await pool.query(
      'UPDATE board_members SET role = $1 WHERE board_id = $2 AND user_id = $3',
      [role, id, userId]
    );

    res.json({ message: 'Role updated' });
  } catch (error) {
    console.error('Change member role error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
