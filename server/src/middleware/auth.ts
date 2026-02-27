import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import pool from '../db';
import { AuthRequest } from '../types';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET must be set (>=16 chars) in production');
    process.exit(1);
  }
  // Generate a random secret for development (changes each restart)
  const devSecret = crypto.randomBytes(32).toString('hex');
  console.warn('WARNING: No JWT_SECRET set — using random dev secret (sessions lost on restart)');
  return devSecret;
}

const JWT_SECRET = getJwtSecret();

// Hash API token for lookup
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Check if token is an API token (starts with pliny_)
function isApiToken(token: string): boolean {
  return token.startsWith('pliny_');
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  // Handle API tokens (personal access tokens)
  if (isApiToken(token)) {
    try {
      const tokenHash = hashToken(token);
      const result = await pool.query(
        `SELECT t.id as token_id, t.expires_at, u.id, u.username, u.role
         FROM api_tokens t
         JOIN users u ON t.user_id = u.id
         WHERE t.token_hash = $1`,
        [tokenHash]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid API token' });
      }

      const row = result.rows[0];

      // Check expiration
      if (row.expires_at && new Date(row.expires_at) < new Date()) {
        return res.status(401).json({ error: 'API token has expired' });
      }

      // Update last_used_at (fire and forget)
      pool.query(
        'UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
        [row.token_id]
      ).catch(() => {});

      req.user = {
        id: row.id.toString(),
        username: row.username,
        role: row.role,
      };
      (req as any).apiTokenId = row.token_id;
      return next();
    } catch (err) {
      console.error('API token auth error:', err);
      return res.status(401).json({ error: 'Invalid API token' });
    }
  }

  // Handle JWT session tokens
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: string;
      username: string;
      role: 'READ' | 'COLLABORATOR' | 'ADMIN';
    };

    // Reject 2FA tickets used as session tokens
    if ((decoded as any).purpose) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin permission required' });
  }
  next();
};

export type BoardRole = 'READ' | 'COLLABORATOR' | 'ADMIN';
const ROLE_RANK: Record<BoardRole, number> = { READ: 0, COLLABORATOR: 1, ADMIN: 2 };

async function resolveBoardId(req: AuthRequest): Promise<string | null> {
  // Direct board routes: /boards/:id/... or /boards/:boardId/...
  if (req.params.id && req.baseUrl.includes('/boards')) return req.params.id;
  if (req.params.boardId) return req.params.boardId;

  // Card-scoped routes (comments, checklists, labels with :cardId)
  if (req.params.cardId) {
    const result = await pool.query(
      `SELECT col.board_id FROM cards c
       JOIN columns col ON c.column_id = col.id
       WHERE c.id = $1`,
      [req.params.cardId]
    );
    if (result.rows.length > 0) return result.rows[0].board_id;
  }

  // Card POST: column_id in body -> board
  if (req.body?.column_id) {
    const result = await pool.query(
      'SELECT board_id FROM columns WHERE id = $1',
      [req.body.column_id]
    );
    if (result.rows.length > 0) return result.rows[0].board_id;
  }

  // Column POST: board_id in body
  if (req.body?.board_id) return req.body.board_id;

  // For bare :id params, use baseUrl to determine entity type
  if (req.params.id) {
    const base = req.baseUrl + req.path;

    // Comment routes: /comments/:id -> card -> column -> board
    if (base.includes('/comments/')) {
      const result = await pool.query(
        `SELECT col.board_id FROM card_comments cc
         JOIN cards c ON cc.card_id = c.id
         JOIN columns col ON c.column_id = col.id
         WHERE cc.id = $1`,
        [req.params.id]
      );
      if (result.rows.length > 0) return result.rows[0].board_id;
    }

    // Checklist routes: /checklist/:id -> card -> column -> board
    if (base.includes('/checklist/')) {
      const result = await pool.query(
        `SELECT col.board_id FROM card_checklist_items ci
         JOIN cards c ON ci.card_id = c.id
         JOIN columns col ON c.column_id = col.id
         WHERE ci.id = $1`,
        [req.params.id]
      );
      if (result.rows.length > 0) return result.rows[0].board_id;
    }

    // Label routes: /labels/:id -> board_labels
    if (base.includes('/labels/')) {
      const result = await pool.query(
        'SELECT board_id FROM board_labels WHERE id = $1',
        [req.params.id]
      );
      if (result.rows.length > 0) return result.rows[0].board_id;
    }

    // Card routes: card :id -> column -> board
    if (req.baseUrl.includes('/cards')) {
      const result = await pool.query(
        `SELECT col.board_id FROM cards c
         JOIN columns col ON c.column_id = col.id
         WHERE c.id = $1`,
        [req.params.id]
      );
      if (result.rows.length > 0) return result.rows[0].board_id;
    }

    // Column routes: column :id -> board
    if (req.baseUrl.includes('/columns')) {
      const result = await pool.query(
        'SELECT board_id FROM columns WHERE id = $1',
        [req.params.id]
      );
      if (result.rows.length > 0) return result.rows[0].board_id;
    }

    // Custom field routes: /custom-fields/:id -> board
    if (base.includes('/custom-fields/')) {
      const result = await pool.query(
        'SELECT board_id FROM board_custom_fields WHERE id = $1',
        [req.params.id]
      );
      if (result.rows.length > 0) return result.rows[0].board_id;
    }
  }

  return null;
}

export function requireBoardRole(minimumRole: BoardRole) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    // Global ADMIN always has full access
    if (req.user?.role === 'ADMIN') {
      req.boardRole = 'ADMIN';
      return next();
    }

    const boardId = await resolveBoardId(req);
    if (!boardId) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const result = await pool.query(
      'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
      [boardId, req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Not a board member' });
    }

    const userBoardRole = result.rows[0].role as BoardRole;
    if (ROLE_RANK[userBoardRole] < ROLE_RANK[minimumRole]) {
      return res.status(403).json({ error: 'Insufficient board permissions' });
    }

    req.boardRole = userBoardRole;
    next();
  };
}

export const generateToken = (user: { id: string; username: string; role: 'READ' | 'COLLABORATOR' | 'ADMIN' }) => {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
};

export const signTicket = (payload: object, expiresIn: jwt.SignOptions['expiresIn'] = '5m') => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

export const verifyTicket = (ticket: string): any => {
  return jwt.verify(ticket, JWT_SECRET);
};
