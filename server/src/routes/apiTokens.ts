import { Router, Response } from 'express';
import crypto from 'crypto';
import pool from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Generate a secure random token
function generateToken(): string {
  return 'pliny_' + crypto.randomBytes(32).toString('hex');
}

// Hash token for storage
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// List user's tokens
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, name, last_used_at, expires_at, created_at
       FROM api_tokens
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user!.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing API tokens:', err);
    res.status(500).json({ error: 'Failed to list tokens' });
  }
});

// Create new token
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  const { name, expires_in_days } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Token name is required' });
  }

  if (name.length > 100) {
    return res.status(400).json({ error: 'Token name must be 100 characters or fewer' });
  }

  try {
    const id = crypto.randomUUID();
    const token = generateToken();
    const tokenHash = hashToken(token);

    let expiresAt: Date | null = null;
    if (expires_in_days && typeof expires_in_days === 'number' && expires_in_days > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expires_in_days);
    }

    await pool.query(
      `INSERT INTO api_tokens (id, user_id, name, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, req.user!.id, name.trim(), tokenHash, expiresAt]
    );

    // Return the raw token once - it won't be shown again
    res.status(201).json({
      id,
      name: name.trim(),
      token, // Only shown once!
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error creating API token:', err);
    res.status(500).json({ error: 'Failed to create token' });
  }
});

// Revoke single token
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM api_tokens WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user!.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Token not found' });
    }

    res.json({ message: 'Token revoked' });
  } catch (err) {
    console.error('Error revoking API token:', err);
    res.status(500).json({ error: 'Failed to revoke token' });
  }
});

// Revoke all tokens
router.delete('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM api_tokens WHERE user_id = $1',
      [req.user!.id]
    );

    res.json({ message: `Revoked ${result.rowCount} token(s)` });
  } catch (err) {
    console.error('Error revoking all API tokens:', err);
    res.status(500).json({ error: 'Failed to revoke tokens' });
  }
});

export default router;
