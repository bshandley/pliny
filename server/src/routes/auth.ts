import { Router } from 'express';
import bcrypt from 'bcryptjs';
import * as OTPAuth from 'otpauth';
import pool from '../db';
import { authenticate, requireAdmin, generateToken, signTicket, verifyTicket } from '../middleware/auth';
import { AuthRequest } from '../types';
import { decrypt } from '../utils/crypto';

const router = Router();

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await pool.query(
      'SELECT id, username, password_hash, role FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // SSO-only users cannot log in with password
    if (!user.password_hash) {
      return res.status(401).json({ error: 'Please use SSO to log in' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if 2FA is enabled
    const totpResult = await pool.query(
      'SELECT enabled FROM user_totp WHERE user_id = $1 AND enabled = true',
      [user.id]
    );

    if (totpResult.rows.length > 0) {
      // Issue a short-lived 2FA ticket instead of a real JWT
      const ticket = signTicket({ id: user.id, purpose: '2fa' }, '5m');
      return res.json({ requires_2fa: true, ticket });
    }

    const token = generateToken({
      id: user.id,
      username: user.username,
      role: user.role
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify 2FA code (after login returns requires_2fa)
router.post('/verify-2fa', async (req, res) => {
  try {
    const { ticket, code } = req.body;

    if (!ticket || !code) {
      return res.status(400).json({ error: 'Ticket and code are required' });
    }

    // Verify the ticket JWT
    let decoded: { id: string; purpose: string };
    try {
      decoded = verifyTicket(ticket);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired ticket' });
    }

    if (decoded.purpose !== '2fa') {
      return res.status(401).json({ error: 'Invalid ticket' });
    }

    // Load user's TOTP secret
    const totpResult = await pool.query(
      'SELECT secret_encrypted, backup_codes FROM user_totp WHERE user_id = $1 AND enabled = true',
      [decoded.id]
    );

    if (totpResult.rows.length === 0) {
      return res.status(400).json({ error: '2FA is not enabled for this user' });
    }

    const { secret_encrypted, backup_codes } = totpResult.rows[0];

    // Try TOTP validation first
    const secretBase32 = decrypt(secret_encrypted);
    const totp = new OTPAuth.TOTP({
      issuer: 'Plank',
      label: '',
      secret: OTPAuth.Secret.fromBase32(secretBase32),
      algorithm: 'SHA1',
      digits: 6,
      period: 30
    });

    const delta = totp.validate({ token: code, window: 1 });

    if (delta === null) {
      // TOTP failed — try backup codes only if input doesn't look like a TOTP code
      // (TOTP = 6 digits, backup codes = 8 hex chars — skip expensive bcrypt for obvious TOTP attempts)
      let backupCodeMatch = false;
      const codes: string[] = backup_codes || [];
      const isTotpFormat = /^\d{6}$/.test(code);

      for (let i = 0; i < codes.length && !isTotpFormat; i++) {
        const match = await bcrypt.compare(code, codes[i]);
        if (match) {
          backupCodeMatch = true;
          // Remove the used backup code
          codes.splice(i, 1);
          await pool.query(
            'UPDATE user_totp SET backup_codes = $1 WHERE user_id = $2',
            [codes, decoded.id]
          );
          break;
        }
      }

      if (!backupCodeMatch) {
        return res.status(401).json({ error: 'Invalid code' });
      }
    }

    // Load full user data and issue real JWT
    const userResult = await pool.query(
      'SELECT id, username, role FROM users WHERE id = $1',
      [decoded.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const token = generateToken({
      id: user.id,
      username: user.username,
      role: user.role
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Verify 2FA error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user (restore session)
router.get('/me', authenticate, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, role, email, display_name, avatar_url, created_at FROM users WHERE id = $1',
      [req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      email: user.email || undefined,
      display_name: user.display_name || undefined,
      avatar_url: user.avatar_url || undefined,
      created_at: user.created_at
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Register (ADMIN users can create new users)
router.post('/register', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (username.length > 255) {
      return res.status(400).json({ error: 'Username must be 255 characters or fewer' });
    }

    if (!['READ', 'COLLABORATOR', 'ADMIN'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at',
      [username, hash, role]
    );

    const user = result.rows[0];

    res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        created_at: user.created_at
      }
    });
  } catch (error: any) {
    if (error.code === '23505') { // Unique violation
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
