import { Router, Response } from 'express';
import crypto from 'crypto';
import pool from '../db';
import { authenticate, requireAdmin, requireBoardRole } from '../middleware/auth';
import { AuthRequest } from '../types';
import { redeliverWebhook, WebhookEvent } from '../services/webhookService';

const router = Router();

// Block webhooks to private/internal IPs to prevent SSRF
function isPrivateUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname;

    // Block obvious private hostnames
    if (hostname === 'localhost' || hostname === 'metadata.google.internal') return true;

    // IPv6 loopback
    if (hostname === '::1' || hostname === '[::1]') return true;

    // Check IPv4 patterns
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number);
      if (a === 127) return true;                    // 127.0.0.0/8 loopback
      if (a === 10) return true;                     // 10.0.0.0/8 private
      if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
      if (a === 192 && b === 168) return true;       // 192.168.0.0/16 private
      if (a === 169 && b === 254) return true;       // 169.254.0.0/16 link-local / cloud metadata
      if (a === 0) return true;                      // 0.0.0.0/8
    }

    // Block common Docker internal hostnames
    if (['db', 'redis', 'server', 'client', 'postgres', 'mysql'].includes(hostname)) return true;

    return false;
  } catch {
    return true; // If we can't parse it, block it
  }
}

const VALID_EVENTS: WebhookEvent[] = [
  'card.created',
  'card.updated',
  'card.moved',
  'card.archived',
  'card.deleted',
  'comment.created',
  'board.created',
  'board.updated',
];

// List global webhooks (ADMIN only)
router.get('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT w.*, u.username as created_by_username,
        (SELECT json_build_object(
          'id', wd.id,
          'status_code', wd.status_code,
          'error', wd.error,
          'created_at', wd.created_at
        ) FROM webhook_deliveries wd
         WHERE wd.webhook_id = w.id
         ORDER BY wd.created_at DESC LIMIT 1) as last_delivery
       FROM webhooks w
       JOIN users u ON w.created_by = u.id
       WHERE w.board_id IS NULL
       ORDER BY w.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing webhooks:', err);
    res.status(500).json({ error: 'Failed to list webhooks' });
  }
});

// List board webhooks (board admin only)
router.get('/board/:boardId', authenticate, requireBoardRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  const { boardId } = req.params;

  try {
    const result = await pool.query(
      `SELECT w.*, u.username as created_by_username,
        (SELECT json_build_object(
          'id', wd.id,
          'status_code', wd.status_code,
          'error', wd.error,
          'created_at', wd.created_at
        ) FROM webhook_deliveries wd
         WHERE wd.webhook_id = w.id
         ORDER BY wd.created_at DESC LIMIT 1) as last_delivery
       FROM webhooks w
       JOIN users u ON w.created_by = u.id
       WHERE w.board_id = $1
       ORDER BY w.created_at DESC`,
      [boardId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing board webhooks:', err);
    res.status(500).json({ error: 'Failed to list webhooks' });
  }
});

// Create webhook (global if no board_id, otherwise board-specific)
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  const { url, events, description, board_id } = req.body;

  // Global webhooks require global admin
  if (!board_id && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin permission required for global webhooks' });
  }

  // Board-scoped webhooks require board ADMIN role
  if (board_id) {
    const membership = await pool.query(
      'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
      [board_id, req.user!.id]
    );
    const isGlobalAdmin = req.user!.role === 'ADMIN';
    const isBoardAdmin = membership.rows[0]?.role === 'ADMIN';
    if (!isGlobalAdmin && !isBoardAdmin) {
      return res.status(403).json({ error: 'Board admin permission required' });
    }
  }

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    new URL(url); // Validate URL format
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  if (isPrivateUrl(url)) {
    return res.status(400).json({ error: 'Webhook URLs must not point to private or internal addresses' });
  }

  if (!events || !Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: 'At least one event is required' });
  }

  const invalidEvents = events.filter(e => !VALID_EVENTS.includes(e));
  if (invalidEvents.length > 0) {
    return res.status(400).json({ error: `Invalid events: ${invalidEvents.join(', ')}` });
  }

  if (description && description.length > 255) {
    return res.status(400).json({ error: 'Description must be 255 characters or fewer' });
  }

  try {
    const id = crypto.randomUUID();
    const secret = crypto.randomBytes(32).toString('hex');

    const result = await pool.query(
      `INSERT INTO webhooks (id, board_id, url, secret, events, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, board_id || null, url, secret, events, description?.trim() || null, req.user!.id]
    );

    // Return secret only on creation
    res.status(201).json({
      ...result.rows[0],
      secret, // Only shown once!
    });
  } catch (err) {
    console.error('Error creating webhook:', err);
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

// Update webhook
router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { url, events, description, enabled } = req.body;

  try {
    // Check ownership/admin/board admin
    const check = await pool.query(
      'SELECT * FROM webhooks WHERE id = $1',
      [id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const webhook = check.rows[0];
    const isOwner = webhook.created_by === req.user!.id;
    const isGlobalAdmin = req.user!.role === 'ADMIN';
    let isBoardAdmin = false;
    if (webhook.board_id) {
      const membership = await pool.query(
        'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
        [webhook.board_id, req.user!.id]
      );
      isBoardAdmin = membership.rows[0]?.role === 'ADMIN';
    }
    if (!isOwner && !isGlobalAdmin && !isBoardAdmin) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (url !== undefined) {
      try {
        new URL(url);
      } catch {
        return res.status(400).json({ error: 'Invalid URL format' });
      }
      if (isPrivateUrl(url)) {
        return res.status(400).json({ error: 'Webhook URLs must not point to private or internal addresses' });
      }
      updates.push(`url = $${paramIndex++}`);
      values.push(url);
    }

    if (events !== undefined) {
      if (!Array.isArray(events) || events.length === 0) {
        return res.status(400).json({ error: 'At least one event is required' });
      }
      const invalidEvents = events.filter(e => !VALID_EVENTS.includes(e));
      if (invalidEvents.length > 0) {
        return res.status(400).json({ error: `Invalid events: ${invalidEvents.join(', ')}` });
      }
      updates.push(`events = $${paramIndex++}`);
      values.push(events);
    }

    if (description !== undefined) {
      if (description && description.length > 255) {
        return res.status(400).json({ error: 'Description must be 255 characters or fewer' });
      }
      updates.push(`description = $${paramIndex++}`);
      values.push(description?.trim() || null);
    }

    if (enabled !== undefined) {
      updates.push(`enabled = $${paramIndex++}`);
      values.push(enabled);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const result = await pool.query(
      `UPDATE webhooks SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating webhook:', err);
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

// Delete webhook
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    // Check ownership/admin/board admin
    const check = await pool.query(
      'SELECT * FROM webhooks WHERE id = $1',
      [id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const webhook = check.rows[0];
    const isOwner = webhook.created_by === req.user!.id;
    const isGlobalAdmin = req.user!.role === 'ADMIN';
    let isBoardAdmin = false;
    if (webhook.board_id) {
      const membership = await pool.query(
        'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
        [webhook.board_id, req.user!.id]
      );
      isBoardAdmin = membership.rows[0]?.role === 'ADMIN';
    }
    if (!isOwner && !isGlobalAdmin && !isBoardAdmin) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    await pool.query('DELETE FROM webhooks WHERE id = $1', [id]);
    res.json({ message: 'Webhook deleted' });
  } catch (err) {
    console.error('Error deleting webhook:', err);
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

// Get webhook deliveries
router.get('/:id/deliveries', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

  try {
    // Check ownership/admin/board admin
    const check = await pool.query(
      'SELECT * FROM webhooks WHERE id = $1',
      [id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const webhook = check.rows[0];
    const isOwner = webhook.created_by === req.user!.id;
    const isGlobalAdmin = req.user!.role === 'ADMIN';
    let isBoardAdmin = false;
    if (webhook.board_id) {
      const membership = await pool.query(
        'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
        [webhook.board_id, req.user!.id]
      );
      isBoardAdmin = membership.rows[0]?.role === 'ADMIN';
    }
    if (!isOwner && !isGlobalAdmin && !isBoardAdmin) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const result = await pool.query(
      `SELECT * FROM webhook_deliveries
       WHERE webhook_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [id, limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing deliveries:', err);
    res.status(500).json({ error: 'Failed to list deliveries' });
  }
});

// Re-deliver a webhook
router.post('/deliveries/:id/redeliver', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    // Check that delivery exists and user has permission
    const check = await pool.query(
      `SELECT wd.*, w.created_by, w.board_id
       FROM webhook_deliveries wd
       JOIN webhooks w ON wd.webhook_id = w.id
       WHERE wd.id = $1`,
      [id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Delivery not found' });
    }

    const delivery = check.rows[0];
    const isOwner = delivery.created_by === req.user!.id;
    const isGlobalAdmin = req.user!.role === 'ADMIN';
    let isBoardAdmin = false;
    if (delivery.board_id) {
      const membership = await pool.query(
        'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
        [delivery.board_id, req.user!.id]
      );
      isBoardAdmin = membership.rows[0]?.role === 'ADMIN';
    }
    if (!isOwner && !isGlobalAdmin && !isBoardAdmin) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    await redeliverWebhook(id);
    res.json({ message: 'Redelivery initiated' });
  } catch (err: any) {
    console.error('Error redelivering webhook:', err);
    res.status(500).json({ error: err.message || 'Failed to redeliver' });
  }
});

// Regenerate webhook secret
router.post('/:id/regenerate-secret', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    const check = await pool.query(
      'SELECT * FROM webhooks WHERE id = $1',
      [id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const webhook = check.rows[0];
    const isOwner = webhook.created_by === req.user!.id;
    const isGlobalAdmin = req.user!.role === 'ADMIN';
    let isBoardAdmin = false;
    if (webhook.board_id) {
      const membership = await pool.query(
        'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
        [webhook.board_id, req.user!.id]
      );
      isBoardAdmin = membership.rows[0]?.role === 'ADMIN';
    }
    if (!isOwner && !isGlobalAdmin && !isBoardAdmin) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const newSecret = crypto.randomBytes(32).toString('hex');

    await pool.query(
      'UPDATE webhooks SET secret = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newSecret, id]
    );

    res.json({ secret: newSecret });
  } catch (err) {
    console.error('Error regenerating secret:', err);
    res.status(500).json({ error: 'Failed to regenerate secret' });
  }
});

export default router;
