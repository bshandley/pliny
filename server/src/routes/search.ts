import { Router, Response } from 'express';
import pool from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// GET /api/search?q=<term>&limit=20
router.get('/search', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const q = (req.query.q as string || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 50);

    if (q.length < 2 || q.length > 200) {
      return res.json({ results: [], total: 0 });
    }

    // Build tsquery: split on whitespace, append :* for prefix matching, join with &
    const tsQueryString = q
      .split(/\s+/)
      .filter(w => w.length > 0)
      .map(w => w.replace(/[^a-zA-Z0-9]/g, '') + ':*')
      .filter(w => w.length > 2) // must have at least one real char before :*
      .join(' & ');

    if (!tsQueryString || !/^[a-zA-Z0-9]+:\*( & [a-zA-Z0-9]+:\*)*$/.test(tsQueryString)) {
      return res.json({ results: [], total: 0 });
    }

    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'ADMIN';

    // Build board access join — admins see all boards, others only their boards
    const boardAccessJoin = isAdmin
      ? ''
      : 'INNER JOIN board_members bm ON b.id = bm.board_id AND bm.user_id = $2';

    const params: (string | number)[] = isAdmin
      ? [tsQueryString, limit]
      : [tsQueryString, userId, limit];

    const limitParam = isAdmin ? '$2' : '$3';
    const tsParam = '$1';

    const sql = `
      WITH search_results AS (
        -- Cards: search title (weight A) and description (weight B)
        SELECT
          'card' as type,
          c.id as card_id,
          c.title as card_title,
          b.id as board_id,
          b.name as board_name,
          col.name as column_name,
          CASE
            WHEN to_tsvector('english', c.title) @@ to_tsquery('english', ${tsParam})
            THEN LEFT(c.title, 120)
            ELSE LEFT(COALESCE(c.description, ''), 120)
          END as match_text,
          ts_rank(
            setweight(to_tsvector('english', c.title), 'A') ||
            setweight(to_tsvector('english', COALESCE(c.description, '')), 'B'),
            to_tsquery('english', ${tsParam})
          ) as rank
        FROM cards c
        INNER JOIN columns col ON c.column_id = col.id
        INNER JOIN boards b ON col.board_id = b.id
        ${boardAccessJoin}
        WHERE c.archived = false
          AND to_tsvector('english', coalesce(c.title,'') || ' ' || coalesce(c.description,''))
            @@ to_tsquery('english', ${tsParam})

        UNION ALL

        -- Comments: search text
        SELECT
          'comment' as type,
          c.id as card_id,
          c.title as card_title,
          b.id as board_id,
          b.name as board_name,
          col.name as column_name,
          LEFT(cc.text, 120) as match_text,
          ts_rank(
            to_tsvector('english', cc.text),
            to_tsquery('english', ${tsParam})
          ) as rank
        FROM card_comments cc
        INNER JOIN cards c ON cc.card_id = c.id
        INNER JOIN columns col ON c.column_id = col.id
        INNER JOIN boards b ON col.board_id = b.id
        ${boardAccessJoin}
        WHERE c.archived = false
          AND to_tsvector('english', cc.text) @@ to_tsquery('english', ${tsParam})

        UNION ALL

        -- Checklist items: search text
        SELECT
          'checklist_item' as type,
          c.id as card_id,
          c.title as card_title,
          b.id as board_id,
          b.name as board_name,
          col.name as column_name,
          LEFT(ci.text, 120) as match_text,
          ts_rank(
            to_tsvector('english', ci.text),
            to_tsquery('english', ${tsParam})
          ) as rank
        FROM card_checklist_items ci
        INNER JOIN cards c ON ci.card_id = c.id
        INNER JOIN columns col ON c.column_id = col.id
        INNER JOIN boards b ON col.board_id = b.id
        ${boardAccessJoin}
        WHERE c.archived = false
          AND to_tsvector('english', ci.text) @@ to_tsquery('english', ${tsParam})
      )
      SELECT *, COUNT(*) OVER() as total_count
      FROM search_results
      ORDER BY rank DESC
      LIMIT ${limitParam}
    `;

    const result = await pool.query(sql, params);

    const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    const results = result.rows.map(({ total_count, ...row }) => ({
      ...row,
      rank: parseFloat(row.rank),
    }));

    res.json({ results, total });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
