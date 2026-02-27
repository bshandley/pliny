import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '../db';
import { authLimiter, forgotPasswordLimiter } from '../middleware/rateLimiter';
import { queueEmail } from '../services/emailService';

const router = Router();

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// Request password reset
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Look up user by email (case-insensitive)
    const userResult = await pool.query(
      'SELECT id, username FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    // Always return 200 to not leak whether email exists
    if (userResult.rows.length === 0) {
      return res.json({ message: 'If that email is registered, you will receive a reset link shortly.' });
    }

    const user = userResult.rows[0];

    // Generate token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Delete any existing unused tokens for this user
    await pool.query(
      'DELETE FROM password_reset_tokens WHERE user_id = $1 AND used = FALSE',
      [user.id]
    );

    // Insert new token with 15 minute expiry
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '15 minutes')`,
      [user.id, tokenHash]
    );

    // Build reset URL and queue email
    const resetUrl = `${CLIENT_URL}/reset-password?token=${token}`;

    await queueEmail(
      email,
      'Reset your Pliny password',
      `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1a1a2e; margin-bottom: 16px;">Reset your Pliny password</h2>
          <p style="color: #555; line-height: 1.5;">
            Click the link below to reset your password. This link expires in 15 minutes.
          </p>
          <p style="margin: 24px 0;">
            <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 6px;">
              Reset Password
            </a>
          </p>
          <p style="color: #888; font-size: 14px;">
            If you didn't request this, you can safely ignore this email.
          </p>
        </div>
      `
    );

    res.json({ message: 'If that email is registered, you will receive a reset link shortly.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset password with token
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Hash the token
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Look up token
    const tokenResult = await pool.query(
      `SELECT user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND used = FALSE AND expires_at > NOW()`,
      [tokenHash]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const { user_id } = tokenResult.rows[0];

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 10);

    // Update user password
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, user_id]
    );

    // Mark token as used
    await pool.query(
      'UPDATE password_reset_tokens SET used = TRUE WHERE token_hash = $1',
      [tokenHash]
    );

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
