import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

const ALLOWED_KEYS = ['registration_enabled'];

// GET / — Get all app settings (admin only)
router.get('/', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM app_settings');

    const settings: Record<string, any> = {};
    result.rows.forEach((row: any) => {
      settings[row.key] = row.value;
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

    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = CURRENT_TIMESTAMP`,
      [key, JSON.stringify(value)]
    );

    res.json({ key, value });
  } catch (error) {
    console.error('Update app setting error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
