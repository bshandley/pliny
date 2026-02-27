import { Router } from 'express';
import pool from '../db';
import { authenticate, requireBoardRole } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// GET /api/cards/:id/relations
router.get('/cards/:id/relations', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // blocks: this card blocks others (source = this card, type = blocks)
    const blocksResult = await pool.query(
      `SELECT cr.id, c.id AS card_id, c.title, col.name AS column_name, b.name AS board_name
       FROM card_relations cr
       JOIN cards c ON cr.target_card_id = c.id
       JOIN columns col ON c.column_id = col.id
       JOIN boards b ON col.board_id = b.id
       WHERE cr.source_card_id = $1 AND cr.relation_type = 'blocks'
       ORDER BY c.title`,
      [id]
    );

    // blocked_by: other cards block this one (target = this card, type = blocks)
    const blockedByResult = await pool.query(
      `SELECT cr.id, c.id AS card_id, c.title, col.name AS column_name, b.name AS board_name
       FROM card_relations cr
       JOIN cards c ON cr.source_card_id = c.id
       JOIN columns col ON c.column_id = col.id
       JOIN boards b ON col.board_id = b.id
       WHERE cr.target_card_id = $1 AND cr.relation_type = 'blocks'
       ORDER BY c.title`,
      [id]
    );

    // relates_to: either direction
    const relatesToResult = await pool.query(
      `SELECT cr.id,
              CASE WHEN cr.source_card_id = $1 THEN cr.target_card_id ELSE cr.source_card_id END AS card_id,
              c.title, col.name AS column_name, b.name AS board_name
       FROM card_relations cr
       JOIN cards c ON c.id = CASE WHEN cr.source_card_id = $1 THEN cr.target_card_id ELSE cr.source_card_id END
       JOIN columns col ON c.column_id = col.id
       JOIN boards b ON col.board_id = b.id
       WHERE cr.relation_type = 'relates_to'
         AND (cr.source_card_id = $1 OR cr.target_card_id = $1)
       ORDER BY c.title`,
      [id]
    );

    res.json({
      blocks: blocksResult.rows,
      blocked_by: blockedByResult.rows,
      relates_to: relatesToResult.rows,
    });
  } catch (error) {
    console.error('Get card relations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cards/:cardId/relations
router.post('/cards/:cardId/relations', authenticate, requireBoardRole('COLLABORATOR'), async (req: AuthRequest, res) => {
  try {
    const id = req.params.cardId;
    const { target_card_id, relation_type } = req.body;

    if (!target_card_id || !relation_type) {
      return res.status(400).json({ error: 'target_card_id and relation_type are required' });
    }

    if (!['blocks', 'blocked_by', 'relates_to'].includes(relation_type)) {
      return res.status(400).json({ error: 'Invalid relation_type' });
    }

    if (id === target_card_id) {
      return res.status(400).json({ error: 'Cannot create a relation to the same card' });
    }

    // Validate both cards exist
    const cardsCheck = await pool.query(
      'SELECT id FROM cards WHERE id = ANY($1)',
      [[id, target_card_id]]
    );
    if (cardsCheck.rows.length < 2) {
      return res.status(400).json({ error: 'One or both cards do not exist' });
    }

    let sourceId: string;
    let targetId: string;
    let dbType: string;

    if (relation_type === 'blocked_by') {
      // Flip: store as target blocks this card
      sourceId = target_card_id;
      targetId = id;
      dbType = 'blocks';
    } else if (relation_type === 'blocks') {
      sourceId = id;
      targetId = target_card_id;
      dbType = 'blocks';
    } else {
      // relates_to
      sourceId = id;
      targetId = target_card_id;
      dbType = 'relates_to';
    }

    const result = await pool.query(
      `INSERT INTO card_relations (source_card_id, target_card_id, relation_type)
       VALUES ($1, $2, $3) RETURNING *`,
      [sourceId, targetId, dbType]
    );

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Relation already exists' });
    }
    console.error('Create card relation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/cards/:cardId/relations/:targetId
router.delete('/cards/:cardId/relations/:targetId', authenticate, requireBoardRole('COLLABORATOR'), async (req: AuthRequest, res) => {
  try {
    const id = req.params.cardId;
    const { targetId } = req.params;

    const result = await pool.query(
      `DELETE FROM card_relations
       WHERE (source_card_id = $1 AND target_card_id = $2)
          OR (source_card_id = $2 AND target_card_id = $1)
       RETURNING *`,
      [id, targetId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Relation not found' });
    }

    res.json({ message: 'Relation deleted' });
  } catch (error) {
    console.error('Delete card relation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
