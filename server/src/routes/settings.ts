import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { encrypt, decrypt } from '../utils/crypto';
import { invalidateOidcCache } from './oidc';

const router = Router();

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

function getCallbackUrl(callbackBaseUrl: string | null): string {
  const base = callbackBaseUrl || CLIENT_URL;
  return `${base.replace(/\/+$/, '')}/api/auth/oidc/callback`;
}

// Get OIDC settings (admin only)
router.get('/oidc', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'SELECT enabled, issuer_url, client_id, client_secret, button_label, claim_email, claim_name, claim_avatar, callback_base_url FROM oidc_config WHERE id = 1'
    );

    if (result.rows.length === 0) {
      return res.json({
        enabled: false,
        issuer_url: '',
        client_id: '',
        client_secret_masked: '',
        button_label: 'Login with SSO',
        claim_email: 'email',
        claim_name: 'name',
        claim_avatar: 'picture',
        callback_base_url: CLIENT_URL,
        callback_url: getCallbackUrl(null)
      });
    }

    const row = result.rows[0];
    let clientSecretMasked = '';
    if (row.client_secret) {
      try {
        const decrypted = decrypt(row.client_secret);
        const last4 = decrypted.slice(-4);
        clientSecretMasked = `\u2022\u2022\u2022\u2022${last4}`;
      } catch {
        clientSecretMasked = '\u2022\u2022\u2022\u2022****';
      }
    }

    res.json({
      enabled: row.enabled,
      issuer_url: row.issuer_url || '',
      client_id: row.client_id || '',
      client_secret_masked: clientSecretMasked,
      button_label: row.button_label || 'Login with SSO',
      claim_email: row.claim_email || 'email',
      claim_name: row.claim_name || 'name',
      claim_avatar: row.claim_avatar || 'picture',
      callback_base_url: row.callback_base_url || CLIENT_URL,
      callback_url: getCallbackUrl(row.callback_base_url)
    });
  } catch (error) {
    console.error('Get OIDC settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update OIDC settings (admin only)
router.put('/oidc', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { enabled, issuer_url, client_id, client_secret, button_label, claim_email, claim_name, claim_avatar, callback_base_url } = req.body;

    // Validate input lengths
    if (issuer_url !== undefined && typeof issuer_url === 'string' && issuer_url.length > 500) {
      return res.status(400).json({ error: 'Issuer URL must be 500 characters or fewer' });
    }
    if (client_id !== undefined && typeof client_id === 'string' && client_id.length > 255) {
      return res.status(400).json({ error: 'Client ID must be 255 characters or fewer' });
    }
    if (client_secret !== undefined && typeof client_secret === 'string' && client_secret.length > 500) {
      return res.status(400).json({ error: 'Client secret must be 500 characters or fewer' });
    }
    if (button_label !== undefined && typeof button_label === 'string' && button_label.length > 100) {
      return res.status(400).json({ error: 'Button label must be 100 characters or fewer' });
    }
    if (callback_base_url !== undefined && typeof callback_base_url === 'string' && callback_base_url.length > 500) {
      return res.status(400).json({ error: 'Callback base URL must be 500 characters or fewer' });
    }
    if (callback_base_url !== undefined && typeof callback_base_url === 'string' && callback_base_url !== '') {
      try {
        const parsed = new URL(callback_base_url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return res.status(400).json({ error: 'Callback base URL must use http or https' });
        }
      } catch {
        return res.status(400).json({ error: 'Callback base URL must be a valid URL' });
      }
    }
    for (const [field, val] of [['claim_email', claim_email], ['claim_name', claim_name], ['claim_avatar', claim_avatar]] as const) {
      if (val !== undefined && typeof val === 'string' && val.length > 100) {
        return res.status(400).json({ error: `${field} must be 100 characters or fewer` });
      }
    }

    // Build dynamic UPDATE query
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 0;

    if (enabled !== undefined) {
      paramCount++;
      updates.push(`enabled = $${paramCount}`);
      values.push(enabled);
    }

    if (issuer_url !== undefined) {
      paramCount++;
      updates.push(`issuer_url = $${paramCount}`);
      values.push(issuer_url);
    }

    if (client_id !== undefined) {
      paramCount++;
      updates.push(`client_id = $${paramCount}`);
      values.push(client_id);
    }

    if (client_secret !== undefined) {
      paramCount++;
      updates.push(`client_secret = $${paramCount}`);
      values.push(client_secret ? encrypt(client_secret) : null);
    }

    if (button_label !== undefined) {
      paramCount++;
      updates.push(`button_label = $${paramCount}`);
      values.push(button_label);
    }

    if (claim_email !== undefined) {
      paramCount++;
      updates.push(`claim_email = $${paramCount}`);
      values.push(claim_email || 'email');
    }

    if (claim_name !== undefined) {
      paramCount++;
      updates.push(`claim_name = $${paramCount}`);
      values.push(claim_name || 'name');
    }

    if (claim_avatar !== undefined) {
      paramCount++;
      updates.push(`claim_avatar = $${paramCount}`);
      values.push(claim_avatar || 'picture');
    }

    if (callback_base_url !== undefined) {
      paramCount++;
      updates.push(`callback_base_url = $${paramCount}`);
      // Strip trailing slash for consistency
      values.push(callback_base_url ? callback_base_url.replace(/\/+$/, '') : null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    await pool.query(
      `UPDATE oidc_config SET ${updates.join(', ')} WHERE id = 1`,
      values
    );

    // Invalidate the cached OIDC client config so new settings take effect
    invalidateOidcCache();

    // Return the updated settings
    const result = await pool.query(
      'SELECT enabled, issuer_url, client_id, client_secret, button_label, claim_email, claim_name, claim_avatar, callback_base_url FROM oidc_config WHERE id = 1'
    );

    const row = result.rows[0];
    let clientSecretMasked = '';
    if (row.client_secret) {
      try {
        const decrypted = decrypt(row.client_secret);
        const last4 = decrypted.slice(-4);
        clientSecretMasked = `\u2022\u2022\u2022\u2022${last4}`;
      } catch {
        clientSecretMasked = '\u2022\u2022\u2022\u2022****';
      }
    }

    res.json({
      enabled: row.enabled,
      issuer_url: row.issuer_url || '',
      client_id: row.client_id || '',
      client_secret_masked: clientSecretMasked,
      button_label: row.button_label || 'Login with SSO',
      claim_email: row.claim_email || 'email',
      claim_name: row.claim_name || 'name',
      claim_avatar: row.claim_avatar || 'picture',
      callback_base_url: row.callback_base_url || CLIENT_URL,
      callback_url: getCallbackUrl(row.callback_base_url)
    });
  } catch (error) {
    console.error('Update OIDC settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
