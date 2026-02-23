import { Router, Request, Response } from 'express';
import pool from '../db';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /boards/:boardId/analytics?days=30
router.get('/boards/:boardId/analytics', authenticate, async (req: Request, res: Response) => {
  const { boardId } = req.params;
  const days = parseInt(req.query.days as string) || 30;

  // Compute date range
  const end = new Date();
  const start = days > 0 ? new Date(end.getTime() - days * 24 * 60 * 60 * 1000) : null;

  // Find the "last column" (highest position) for this board — get both id and name
  const lastColResult = await pool.query(
    'SELECT id, name FROM columns WHERE board_id = $1 ORDER BY position DESC LIMIT 1',
    [boardId]
  );
  const lastColumnId = lastColResult.rows[0]?.id || '';
  const lastColumnName = lastColResult.rows[0]?.name || '';

  // Summary: total, completed, overdue cards
  const summaryResult = await pool.query(
    `SELECT
       COUNT(*)::int as total_cards,
       COUNT(*) FILTER (WHERE c.column_id = $2)::int as completed_cards,
       COUNT(*) FILTER (WHERE c.due_date < CURRENT_DATE AND c.column_id != $2)::int as overdue_cards
     FROM cards c
     INNER JOIN columns col ON c.column_id = col.id
     WHERE col.board_id = $1 AND c.archived = false`,
    [boardId, lastColumnId]
  );

  // Cards by column
  const byColumnResult = await pool.query(
    `SELECT col.id as column_id, col.name as column_name, col.position,
            COUNT(c.id)::int as count
     FROM columns col
     LEFT JOIN cards c ON c.column_id = col.id AND c.archived = false
     WHERE col.board_id = $1
     GROUP BY col.id, col.name, col.position
     ORDER BY col.position`,
    [boardId]
  );

  // Cards by assignee
  const byAssigneeResult = await pool.query(
    `SELECT
       COALESCE(ca.assignee_name, 'Unassigned') as assignee,
       COUNT(DISTINCT c.id)::int as total,
       COUNT(DISTINCT c.id) FILTER (WHERE c.column_id = $2)::int as completed
     FROM cards c
     INNER JOIN columns col ON c.column_id = col.id
     LEFT JOIN card_assignees ca ON ca.card_id = c.id
     WHERE col.board_id = $1 AND c.archived = false
     GROUP BY ca.assignee_name
     ORDER BY total DESC`,
    [boardId, lastColumnId]
  );

  // Cards by label
  const byLabelResult = await pool.query(
    `SELECT bl.id as label_id, bl.name as label_name, bl.color as label_color,
            COUNT(cl.card_id)::int as count
     FROM board_labels bl
     LEFT JOIN card_labels cl ON cl.label_id = bl.id
     LEFT JOIN cards c ON c.id = cl.card_id AND c.archived = false
     WHERE bl.board_id = $1
     GROUP BY bl.id, bl.name, bl.color
     ORDER BY count DESC`,
    [boardId]
  );

  // Cards created/completed over time
  // Activity for column moves uses action='moved' and detail->>'to_column' stores the column NAME
  const overTimeParams: any[] = [boardId];
  let overTimeDateFilter = '';
  if (start) {
    overTimeParams.push(start.toISOString());
    overTimeDateFilter = `AND c.created_at >= $2`;
  }
  overTimeParams.push(lastColumnName);
  const lastColParamIdx = overTimeParams.length;

  const overTimeResult = await pool.query(
    `WITH date_range AS (
       SELECT generate_series(
         ${start ? '$2::timestamp' : `(SELECT COALESCE(MIN(created_at), CURRENT_TIMESTAMP) FROM cards c INNER JOIN columns col ON c.column_id = col.id WHERE col.board_id = $1)`},
         CURRENT_TIMESTAMP,
         '1 day'::interval
       )::date as d
     ),
     created AS (
       SELECT c.created_at::date as d, COUNT(*)::int as count
       FROM cards c
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1 ${overTimeDateFilter}
       GROUP BY c.created_at::date
     ),
     completed AS (
       SELECT ca.created_at::date as d, COUNT(*)::int as count
       FROM card_activity ca
       INNER JOIN cards c ON ca.card_id = c.id
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1
         AND ca.action = 'moved'
         AND ca.detail->>'to_column' = $${lastColParamIdx}
         ${start ? `AND ca.created_at >= $2` : ''}
       GROUP BY ca.created_at::date
     )
     SELECT dr.d as date,
            COALESCE(cr.count, 0) as created,
            COALESCE(co.count, 0) as completed
     FROM date_range dr
     LEFT JOIN created cr ON cr.d = dr.d
     LEFT JOIN completed co ON co.d = dr.d
     ORDER BY dr.d`,
    overTimeParams
  );

  // Average cycle time (for cards completed in period)
  const cycleTimeParams: any[] = [boardId, lastColumnName];
  let cycleTimeDateFilter = '';
  if (start) {
    cycleTimeParams.push(start.toISOString());
    cycleTimeDateFilter = `AND ca.created_at >= $3`;
  }

  const cycleTimeResult = await pool.query(
    `SELECT
       AVG(EXTRACT(EPOCH FROM (ca.created_at - c.created_at)) / 86400)::numeric(10,1) as avg_cycle_time_days
     FROM card_activity ca
     INNER JOIN cards c ON ca.card_id = c.id
     INNER JOIN columns col ON c.column_id = col.id
     WHERE col.board_id = $1
       AND ca.action = 'moved'
       AND ca.detail->>'to_column' = $2
       ${cycleTimeDateFilter}`,
    cycleTimeParams
  );

  // Cycle time distribution
  const cycleDistParams: any[] = [boardId, lastColumnName];
  let cycleDistDateFilter = '';
  if (start) {
    cycleDistParams.push(start.toISOString());
    cycleDistDateFilter = `AND ca.created_at >= $3`;
  }

  const cycleDistResult = await pool.query(
    `WITH completed_cards AS (
       SELECT c.id,
              EXTRACT(EPOCH FROM (ca.created_at - c.created_at)) / 86400 as cycle_days
       FROM card_activity ca
       INNER JOIN cards c ON ca.card_id = c.id
       INNER JOIN columns col ON c.column_id = col.id
       WHERE col.board_id = $1
         AND ca.action = 'moved'
         AND ca.detail->>'to_column' = $2
         ${cycleDistDateFilter}
     )
     SELECT
       CASE
         WHEN cycle_days < 1 THEN '< 1 day'
         WHEN cycle_days < 3 THEN '1-3 days'
         WHEN cycle_days < 7 THEN '3-7 days'
         WHEN cycle_days < 14 THEN '1-2 weeks'
         ELSE '> 2 weeks'
       END as range,
       COUNT(*)::int as count
     FROM completed_cards
     GROUP BY 1
     ORDER BY MIN(cycle_days)`,
    cycleDistParams
  );

  const summary = summaryResult.rows[0] || { total_cards: 0, completed_cards: 0, overdue_cards: 0 };

  res.json({
    period: {
      days,
      start: start ? start.toISOString().slice(0, 10) : null,
      end: end.toISOString().slice(0, 10),
    },
    summary: {
      ...summary,
      avg_cycle_time_days: parseFloat(cycleTimeResult.rows[0]?.avg_cycle_time_days) || 0,
    },
    cards_by_column: byColumnResult.rows,
    cards_by_assignee: byAssigneeResult.rows,
    cards_by_label: byLabelResult.rows,
    cards_over_time: overTimeResult.rows,
    cycle_time_distribution: cycleDistResult.rows,
  });
});

export default router;
