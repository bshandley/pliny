import { Router } from 'express';
import pool from '../db';

const router = Router();

// Get public board by token (no auth required)
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Validate token format (must be UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(token)) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const boardResult = await pool.query(
      'SELECT id, name, description FROM boards WHERE public_token = $1',
      [token]
    );

    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const board = boardResult.rows[0];
    const boardId = board.id;

    const columnsResult = await pool.query(
      'SELECT id, name, position FROM columns WHERE board_id = $1 ORDER BY position',
      [boardId]
    );

    const cardsResult = await pool.query(
      `SELECT c.id, c.column_id, c.title, c.description, c.due_date, c.start_date, c.position
       FROM cards c
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1 AND c.archived = false
       ORDER BY c.position`,
      [boardId]
    );

    const cardIds = cardsResult.rows.map((c: any) => c.id);

    // Fetch assignees
    const assigneesResult = cardIds.length > 0 ? await pool.query(
      `SELECT ca.card_id, ca.display_name, u.username
       FROM card_assignees ca
       LEFT JOIN users u ON ca.user_id = u.id
       WHERE ca.card_id = ANY($1)`,
      [cardIds]
    ) : { rows: [] };

    // Fetch labels
    const labelsResult = cardIds.length > 0 ? await pool.query(
      `SELECT cl.card_id, bl.name, bl.color
       FROM card_labels cl
       INNER JOIN board_labels bl ON cl.label_id = bl.id
       WHERE cl.card_id = ANY($1)`,
      [cardIds]
    ) : { rows: [] };

    // Group by card
    const assigneesByCard: Record<string, { display_name: string | null; username: string | null }[]> = {};
    assigneesResult.rows.forEach((row: any) => {
      (assigneesByCard[row.card_id] ||= []).push({
        display_name: row.display_name,
        username: row.username,
      });
    });

    const labelsByCard: Record<string, { name: string; color: string }[]> = {};
    labelsResult.rows.forEach((row: any) => {
      (labelsByCard[row.card_id] ||= []).push({ name: row.name, color: row.color });
    });

    const cards = cardsResult.rows.map((card: any) => ({
      id: card.id,
      column_id: card.column_id,
      title: card.title,
      description: card.description || '',
      due_date: card.due_date || null,
      start_date: card.start_date || null,
      position: card.position,
      assignees: assigneesByCard[card.id] || [],
      labels: labelsByCard[card.id] || [],
    }));

    res.json({
      name: board.name,
      description: board.description || '',
      columns: columnsResult.rows.map((col: any) => ({
        id: col.id,
        name: col.name,
        position: col.position,
        cards: cards.filter((c: any) => c.column_id === col.id),
      })),
    });
  } catch (error) {
    console.error('Get public board error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
