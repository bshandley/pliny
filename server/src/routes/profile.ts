import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Get current user's full profile
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const userResult = await pool.query(
      `SELECT id, username, role, email, display_name, avatar_url, created_at
       FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Check if TOTP is enabled
    const totpResult = await pool.query(
      'SELECT enabled FROM user_totp WHERE user_id = $1 AND enabled = true',
      [userId]
    );

    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      email: user.email || null,
      display_name: user.display_name || null,
      avatar_url: user.avatar_url || null,
      has_totp: totpResult.rows.length > 0,
      created_at: user.created_at,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update current user's profile
router.put('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { display_name, email, current_password, new_password } = req.body;

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Handle display_name update
    if (display_name !== undefined) {
      updates.push(`display_name = $${paramIndex++}`);
      values.push(display_name || null);
    }

    // Handle email update
    if (email !== undefined) {
      // Check if email is taken by another user
      if (email) {
        const emailCheck = await pool.query(
          'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2',
          [email, userId]
        );
        if (emailCheck.rows.length > 0) {
          return res.status(409).json({ error: 'Email already in use' });
        }
      }
      updates.push(`email = $${paramIndex++}`);
      values.push(email || null);
    }

    // Handle password change
    if (new_password) {
      if (!current_password) {
        return res.status(400).json({ error: 'Current password is required to change password' });
      }

      if (new_password.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
      }

      // Verify current password
      const userResult = await pool.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = userResult.rows[0];

      if (!user.password_hash) {
        return res.status(400).json({ error: 'Cannot change password for SSO-only accounts' });
      }

      const valid = await bcrypt.compare(current_password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      // Hash new password
      const passwordHash = await bcrypt.hash(new_password, 10);
      updates.push(`password_hash = $${paramIndex++}`);
      values.push(passwordHash);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    // Add userId as last parameter
    values.push(userId);

    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, username, role, email, display_name, avatar_url, created_at`,
      values
    );

    const updated = result.rows[0];

    res.json({
      id: updated.id,
      username: updated.username,
      role: updated.role,
      email: updated.email || null,
      display_name: updated.display_name || null,
      avatar_url: updated.avatar_url || null,
      created_at: updated.created_at,
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
