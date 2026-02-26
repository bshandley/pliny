import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import pool from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { encrypt, decrypt } from '../utils/crypto';

const router = Router();

// Get 2FA status
router.get('/status', authenticate, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'SELECT enabled FROM user_totp WHERE user_id = $1',
      [req.user!.id]
    );
    const enabled = result.rows.length > 0 && result.rows[0].enabled === true;
    res.json({ enabled });
  } catch (error) {
    console.error('TOTP status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Setup 2FA (generate secret + QR code)
router.post('/setup', authenticate, async (req: AuthRequest, res) => {
  try {
    // Check user has a password (SSO-only users can't enable TOTP)
    const userResult = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user!.id]
    );
    if (userResult.rows.length === 0 || !userResult.rows[0].password_hash) {
      return res.status(400).json({ error: 'SSO-only users cannot enable 2FA' });
    }

    // Check if 2FA is already enabled
    const existingResult = await pool.query(
      'SELECT enabled FROM user_totp WHERE user_id = $1',
      [req.user!.id]
    );
    if (existingResult.rows.length > 0 && existingResult.rows[0].enabled === true) {
      return res.status(400).json({ error: '2FA is already enabled' });
    }

    // Generate TOTP secret
    const secret = new OTPAuth.Secret({ size: 20 });

    // Build TOTP URI
    const totp = new OTPAuth.TOTP({
      issuer: 'Pliny',
      label: req.user!.username,
      secret,
      algorithm: 'SHA1',
      digits: 6,
      period: 30
    });

    // Generate QR code
    const qrCode = await QRCode.toDataURL(totp.toString());

    // Generate 8 backup codes
    const backupCodes: string[] = [];
    const hashedBackupCodes: string[] = [];
    for (let i = 0; i < 8; i++) {
      const code = crypto.randomBytes(4).toString('hex');
      backupCodes.push(code);
      const hashed = await bcrypt.hash(code, 10);
      hashedBackupCodes.push(hashed);
    }

    // Store in user_totp (UPSERT)
    const encryptedSecret = encrypt(secret.base32);
    await pool.query(
      `INSERT INTO user_totp (user_id, secret_encrypted, enabled, backup_codes)
       VALUES ($1, $2, false, $3)
       ON CONFLICT (user_id) DO UPDATE
       SET secret_encrypted = $2, enabled = false, backup_codes = $3, created_at = CURRENT_TIMESTAMP`,
      [req.user!.id, encryptedSecret, hashedBackupCodes]
    );

    res.json({
      qr_code: qrCode,
      secret: secret.base32,
      backup_codes: backupCodes
    });
  } catch (error) {
    console.error('TOTP setup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Enable 2FA (verify code to confirm setup)
router.post('/enable', authenticate, async (req: AuthRequest, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

    // Load pending (enabled=false) secret
    const result = await pool.query(
      'SELECT secret_encrypted FROM user_totp WHERE user_id = $1 AND enabled = false',
      [req.user!.id]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'No pending 2FA setup found' });
    }

    // Decrypt and verify
    const secretBase32 = decrypt(result.rows[0].secret_encrypted);
    const totp = new OTPAuth.TOTP({
      issuer: 'Pliny',
      label: req.user!.username,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
      algorithm: 'SHA1',
      digits: 6,
      period: 30
    });

    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    // Enable 2FA
    await pool.query(
      'UPDATE user_totp SET enabled = true WHERE user_id = $1',
      [req.user!.id]
    );

    res.json({ message: '2FA enabled successfully' });
  } catch (error) {
    console.error('TOTP enable error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Disable 2FA
router.delete('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    // Verify password
    const userResult = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user!.id]
    );
    if (userResult.rows.length === 0 || !userResult.rows[0].password_hash) {
      return res.status(400).json({ error: 'Unable to verify password' });
    }

    const valid = await bcrypt.compare(password, userResult.rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Delete the TOTP row
    await pool.query(
      'DELETE FROM user_totp WHERE user_id = $1',
      [req.user!.id]
    );

    res.json({ message: '2FA disabled successfully' });
  } catch (error) {
    console.error('TOTP disable error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
