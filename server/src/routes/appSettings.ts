import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { encrypt } from '../utils/crypto';
import { refreshTransporter, sendTestEmail } from '../services/emailService';

const router = Router();

const ALLOWED_KEYS = [
  'registration_enabled',
  'smtp_host',
  'smtp_port',
  'smtp_username',
  'smtp_password',
  'smtp_from_address',
  'smtp_tls',
];

const ENCRYPTED_KEYS = ['smtp_password'];

const MASKED_VALUE = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';

// GET / — Get all app settings (admin only)
router.get('/', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM app_settings');

    const settings: Record<string, any> = {};
    result.rows.forEach((row: any) => {
      if (ENCRYPTED_KEYS.includes(row.key)) {
        // Mask encrypted values — never return the actual encrypted value
        settings[row.key] = row.value ? MASKED_VALUE : '';
      } else {
        settings[row.key] = row.value;
      }
    });

    res.json(settings);
  } catch (error) {
    console.error('Get app settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /:key — Update a setting (admin only)
router.put('/:key', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (!ALLOWED_KEYS.includes(key)) {
      return res.status(400).json({ error: `Unknown setting: ${key}` });
    }

    if (value === undefined || value === null) {
      return res.status(400).json({ error: 'Value is required' });
    }

    // For encrypted keys, skip update if the masked placeholder is sent back
    if (ENCRYPTED_KEYS.includes(key) && value === MASKED_VALUE) {
      return res.json({ key, value: MASKED_VALUE });
    }

    let storedValue = value;
    if (ENCRYPTED_KEYS.includes(key) && value) {
      storedValue = encrypt(value);
    }

    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = CURRENT_TIMESTAMP`,
      [key, JSON.stringify(storedValue)]
    );

    // Refresh SMTP transporter when any smtp_* setting changes
    if (key.startsWith('smtp_')) {
      await refreshTransporter();
    }

    // Return masked value for encrypted keys
    const returnValue = ENCRYPTED_KEYS.includes(key) ? MASKED_VALUE : value;
    res.json({ key, value: returnValue });
  } catch (error) {
    console.error('Update app setting error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /smtp-test — Send a test email (admin only)
router.post('/smtp-test', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { to } = req.body;
    if (!to) {
      return res.status(400).json({ error: 'Recipient email address is required' });
    }

    const result = await sendTestEmail(to);
    if (result.success) {
      res.json({ message: 'Test email sent successfully' });
    } else {
      res.status(400).json({ error: result.error || 'Failed to send test email' });
    }
  } catch (error: any) {
    console.error('SMTP test error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /smtp-status — Check if SMTP is configured (any authenticated user)
router.get('/smtp-status', authenticate, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'smtp_host'`
    );
    const configured = result.rows.length > 0 && !!result.rows[0].value;
    res.json({ configured });
  } catch (error) {
    console.error('SMTP status check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
