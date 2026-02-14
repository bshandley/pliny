# SSO Login & Optional TOTP 2FA Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add OIDC-based SSO login (via PocketID) and optional TOTP two-factor authentication for password logins.

**Architecture:** Server-side OIDC Authorization Code flow using `openid-client`. Backend handles redirect to PocketID, receives callback, exchanges code for tokens, finds/creates user, issues Plank JWT. TOTP 2FA intercepts password login with a short-lived ticket before issuing the real JWT.

**Tech Stack:** openid-client (OIDC), otpauth (TOTP), qrcode (QR generation), AES-256-GCM (secret encryption), PostgreSQL (config/secret storage)

---

### Task 1: Install Server Dependencies

**Files:**
- Modify: `server/package.json`

**Step 1: Install packages**

Run: `cd /home/bradley/cork/server && npm install openid-client otpauth qrcode`

**Step 2: Install type definitions**

Run: `cd /home/bradley/cork/server && npm install -D @types/qrcode`

Note: `openid-client` and `otpauth` ship their own types.

**Step 3: Verify**

Run: `cd /home/bradley/cork/server && npx tsc --noEmit --skipLibCheck 2>&1 | head -5`
Expected: No new errors (existing codebase should still compile)

**Step 4: Commit**

```bash
cd /home/bradley/cork && git add server/package.json server/package-lock.json
git commit -m "chore: add openid-client, otpauth, qrcode dependencies"
```

---

### Task 2: Database Migration 008

**Files:**
- Create: `server/src/migrations/008-sso-totp.sql`
- Modify: `server/src/migrations/run.ts` (add new migration to runner)

**Step 1: Create migration file**

Create `server/src/migrations/008-sso-totp.sql`:

```sql
-- Single-row OIDC configuration (admin-managed)
CREATE TABLE IF NOT EXISTS oidc_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT false,
  issuer_url VARCHAR(500),
  client_id VARCHAR(255),
  client_secret VARCHAR(500),
  button_label VARCHAR(100) DEFAULT 'Login with SSO',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default row if not exists
INSERT INTO oidc_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Per-user TOTP secrets
CREATE TABLE IF NOT EXISTS user_totp (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted VARCHAR(500) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  backup_codes TEXT[],
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Maps OIDC subject to Plank user
CREATE TABLE IF NOT EXISTS user_oidc (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  oidc_subject VARCHAR(255) NOT NULL,
  oidc_issuer VARCHAR(500) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(oidc_subject, oidc_issuer)
);

-- Allow SSO-only users (no password)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
```

**Step 2: Add migration to runner**

In `server/src/migrations/run.ts`, after the `007-collaborator-role.sql` block, add:

```typescript
    // Add SSO and TOTP support
    const ssoTotp = fs.readFileSync(
      path.join(__dirname, '008-sso-totp.sql'),
      'utf-8'
    );
    await pool.query(ssoTotp);
```

**Step 3: Verify migration runs locally**

Run: `cd /home/bradley/cork/server && npm run migrate`
Expected: "Migrations completed successfully"

**Step 4: Commit**

```bash
cd /home/bradley/cork && git add server/src/migrations/008-sso-totp.sql server/src/migrations/run.ts
git commit -m "feat: add migration 008 for OIDC config, user_totp, user_oidc tables"
```

---

### Task 3: Encryption Utility

**Files:**
- Create: `server/src/utils/crypto.ts`

**Step 1: Create encryption utility**

Create `server/src/utils/crypto.ts`:

```typescript
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.TOTP_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!key) throw new Error('No encryption key available');
  // Derive a 32-byte key from the secret using SHA-256
  return crypto.createHash('sha256').update(key).digest();
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv + tag + ciphertext)
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(encoded: string): string {
  const key = getEncryptionKey();
  const data = Buffer.from(encoded, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}
```

**Step 2: Verify it compiles**

Run: `cd /home/bradley/cork/server && npx tsc --noEmit --skipLibCheck 2>&1 | head -5`
Expected: No errors

**Step 3: Commit**

```bash
cd /home/bradley/cork && git add server/src/utils/crypto.ts
git commit -m "feat: add AES-256-GCM encryption utility for TOTP and OIDC secrets"
```

---

### Task 4: OIDC Settings Backend (Admin CRUD)

**Files:**
- Create: `server/src/routes/settings.ts`
- Modify: `server/src/index.ts` (mount route)

**Step 1: Create settings routes**

Create `server/src/routes/settings.ts`:

```typescript
import { Router } from 'express';
import pool from '../db';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { encrypt, decrypt } from '../utils/crypto';

const router = Router();

// GET /api/settings/oidc — Admin only, returns OIDC config (secret masked)
router.get('/oidc', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query('SELECT * FROM oidc_config WHERE id = 1');
    const config = result.rows[0];
    if (!config) {
      return res.json({ enabled: false, issuer_url: '', client_id: '', client_secret: '', button_label: 'Login with SSO' });
    }
    // Mask the client secret
    let maskedSecret = '';
    if (config.client_secret) {
      try {
        const plain = decrypt(config.client_secret);
        maskedSecret = plain.length > 4 ? '••••' + plain.slice(-4) : '••••';
      } catch {
        maskedSecret = '••••';
      }
    }
    res.json({
      enabled: config.enabled,
      issuer_url: config.issuer_url || '',
      client_id: config.client_id || '',
      client_secret_masked: maskedSecret,
      button_label: config.button_label || 'Login with SSO',
    });
  } catch (error) {
    console.error('Get OIDC config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/settings/oidc — Admin only, update OIDC config
router.put('/oidc', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { enabled, issuer_url, client_id, client_secret, button_label } = req.body;

    if (issuer_url !== undefined && typeof issuer_url === 'string' && issuer_url.length > 500) {
      return res.status(400).json({ error: 'Issuer URL must be 500 characters or fewer' });
    }
    if (client_id !== undefined && typeof client_id === 'string' && client_id.length > 255) {
      return res.status(400).json({ error: 'Client ID must be 255 characters or fewer' });
    }
    if (button_label !== undefined && typeof button_label === 'string' && button_label.length > 100) {
      return res.status(400).json({ error: 'Button label must be 100 characters or fewer' });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 0;

    if (enabled !== undefined) {
      paramCount++;
      updates.push(`enabled = $${paramCount}`);
      values.push(Boolean(enabled));
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
    if (client_secret !== undefined && client_secret !== '') {
      paramCount++;
      updates.push(`client_secret = $${paramCount}`);
      values.push(encrypt(client_secret));
    }
    if (button_label !== undefined) {
      paramCount++;
      updates.push(`button_label = $${paramCount}`);
      values.push(button_label);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    await pool.query(
      `UPDATE oidc_config SET ${updates.join(', ')} WHERE id = 1`,
      values
    );

    res.json({ message: 'OIDC settings updated' });
  } catch (error) {
    console.error('Update OIDC config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
```

**Step 2: Mount in index.ts**

In `server/src/index.ts`, add import and route mount:

After the existing import block (line 17), add:
```typescript
import settingsRoutes from './routes/settings';
```

After the notifications route mount (line 46), add:
```typescript
app.use('/api/settings', settingsRoutes);
```

**Step 3: Verify compilation**

Run: `cd /home/bradley/cork/server && npx tsc --noEmit --skipLibCheck 2>&1 | head -5`
Expected: No errors

**Step 4: Commit**

```bash
cd /home/bradley/cork && git add server/src/routes/settings.ts server/src/index.ts
git commit -m "feat: add OIDC settings CRUD endpoints (admin only)"
```

---

### Task 5: OIDC Login Flow Backend

**Files:**
- Create: `server/src/routes/oidc.ts`
- Modify: `server/src/index.ts` (mount route)

**Step 1: Create OIDC routes**

Create `server/src/routes/oidc.ts`:

```typescript
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import * as client from 'openid-client';
import pool from '../db';
import { generateToken } from '../middleware/auth';
import { decrypt } from '../utils/crypto';

const router = Router();

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// Cache the OIDC config to avoid DB hit on every request
let oidcConfigCache: { config: client.Configuration; timestamp: number } | null = null;
const CACHE_TTL = 60_000; // 1 minute

async function getOidcClientConfig(): Promise<client.Configuration | null> {
  // Check cache
  if (oidcConfigCache && Date.now() - oidcConfigCache.timestamp < CACHE_TTL) {
    return oidcConfigCache.config;
  }

  const result = await pool.query('SELECT * FROM oidc_config WHERE id = 1');
  const row = result.rows[0];
  if (!row || !row.enabled || !row.issuer_url || !row.client_id || !row.client_secret) {
    return null;
  }

  const clientSecret = decrypt(row.client_secret);
  const serverUrl = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;
  const redirectUri = `${serverUrl}/api/auth/oidc/callback`;

  const config = await client.discovery(
    new URL(row.issuer_url),
    row.client_id,
    clientSecret,
    undefined,
    { execute: [client.allowInsecureRequests] }
  );

  oidcConfigCache = { config, timestamp: Date.now() };
  return config;
}

// Invalidate cache when settings change (called from settings route)
export function invalidateOidcCache() {
  oidcConfigCache = null;
}

// GET /api/auth/oidc/config — Public, returns whether SSO is enabled + button label
router.get('/config', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT enabled, button_label FROM oidc_config WHERE id = 1'
    );
    const config = result.rows[0];
    res.json({
      enabled: config?.enabled || false,
      button_label: config?.button_label || 'Login with SSO',
    });
  } catch (error) {
    console.error('Get OIDC public config error:', error);
    res.json({ enabled: false, button_label: 'Login with SSO' });
  }
});

// GET /api/auth/oidc/login — Redirects browser to PocketID
router.get('/login', async (req: Request, res: Response) => {
  try {
    const config = await getOidcClientConfig();
    if (!config) {
      return res.status(400).json({ error: 'SSO is not configured' });
    }

    const state = crypto.randomBytes(32).toString('hex');
    const nonce = crypto.randomBytes(32).toString('hex');
    const serverUrl = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;
    const redirectUri = `${serverUrl}/api/auth/oidc/callback`;

    // Store state and nonce in a short-lived cookie
    const cookieValue = JSON.stringify({ state, nonce });
    res.cookie('oidc_state', cookieValue, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000, // 5 minutes
      secure: process.env.NODE_ENV === 'production' && !serverUrl.startsWith('http://'),
    });

    const authUrl = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      state,
      nonce,
    });

    res.redirect(authUrl.href);
  } catch (error) {
    console.error('OIDC login error:', error);
    res.redirect(`${CLIENT_URL}/?sso_error=configuration_error`);
  }
});

// GET /api/auth/oidc/callback — Handles PocketID redirect
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const config = await getOidcClientConfig();
    if (!config) {
      return res.redirect(`${CLIENT_URL}/?sso_error=not_configured`);
    }

    // Parse state cookie
    const cookieHeader = req.headers.cookie || '';
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map(c => {
        const [key, ...val] = c.trim().split('=');
        return [key, decodeURIComponent(val.join('='))];
      })
    );

    let storedState: string;
    let storedNonce: string;
    try {
      const parsed = JSON.parse(cookies['oidc_state'] || '{}');
      storedState = parsed.state;
      storedNonce = parsed.nonce;
    } catch {
      return res.redirect(`${CLIENT_URL}/?sso_error=invalid_state`);
    }

    // Clear the state cookie
    res.clearCookie('oidc_state');

    // Verify state
    if (!storedState || req.query.state !== storedState) {
      return res.redirect(`${CLIENT_URL}/?sso_error=state_mismatch`);
    }

    if (req.query.error) {
      console.error('OIDC callback error:', req.query.error, req.query.error_description);
      return res.redirect(`${CLIENT_URL}/?sso_error=${encodeURIComponent(req.query.error as string)}`);
    }

    // Exchange code for tokens
    const serverUrl = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;
    const redirectUri = `${serverUrl}/api/auth/oidc/callback`;
    const currentUrl = new URL(`${serverUrl}${req.originalUrl}`);

    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      expectedState: storedState,
      expectedNonce: storedNonce,
      idTokenExpected: true,
    });

    const claims = tokens.claims();
    if (!claims) {
      return res.redirect(`${CLIENT_URL}/?sso_error=no_claims`);
    }

    const sub = claims.sub;
    const preferredUsername = (claims.preferred_username || claims.email || sub) as string;

    if (!sub) {
      return res.redirect(`${CLIENT_URL}/?sso_error=no_subject`);
    }

    // Look up existing OIDC link
    const oidcResult = await pool.query(
      'SELECT user_id FROM user_oidc WHERE oidc_subject = $1 AND oidc_issuer = $2',
      [sub, config.serverMetadata().issuer]
    );

    let userId: string;
    let username: string;
    let role: 'READ' | 'COLLABORATOR' | 'ADMIN';

    if (oidcResult.rows.length > 0) {
      // Existing linked user
      userId = oidcResult.rows[0].user_id;
      const userResult = await pool.query(
        'SELECT id, username, role FROM users WHERE id = $1',
        [userId]
      );
      if (userResult.rows.length === 0) {
        return res.redirect(`${CLIENT_URL}/?sso_error=user_not_found`);
      }
      username = userResult.rows[0].username;
      role = userResult.rows[0].role;
    } else {
      // Auto-create new user with READ role
      // Deduplicate username if taken
      let baseUsername = preferredUsername.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 250);
      let finalUsername = baseUsername;
      let attempt = 0;

      while (true) {
        const existing = await pool.query(
          'SELECT id FROM users WHERE username = $1',
          [finalUsername]
        );
        if (existing.rows.length === 0) break;
        attempt++;
        finalUsername = `${baseUsername}_${attempt}`;
      }

      const newUser = await pool.query(
        'INSERT INTO users (username, password_hash, role) VALUES ($1, NULL, $2) RETURNING id, username, role',
        [finalUsername, 'READ']
      );
      userId = newUser.rows[0].id;
      username = newUser.rows[0].username;
      role = newUser.rows[0].role;

      // Create OIDC link
      await pool.query(
        'INSERT INTO user_oidc (user_id, oidc_subject, oidc_issuer) VALUES ($1, $2, $3)',
        [userId, sub, config.serverMetadata().issuer]
      );
    }

    // Issue Plank JWT
    const token = generateToken({ id: userId, username, role });
    res.redirect(`${CLIENT_URL}/?token=${encodeURIComponent(token)}`);
  } catch (error) {
    console.error('OIDC callback error:', error);
    res.redirect(`${CLIENT_URL}/?sso_error=callback_failed`);
  }
});

export default router;
```

**Step 2: Mount in index.ts**

In `server/src/index.ts`, add import:
```typescript
import oidcRoutes from './routes/oidc';
```

Add cookie-parser middleware (needed for OIDC state cookie). Install it first:

Run: `cd /home/bradley/cork/server && npm install cookie-parser && npm install -D @types/cookie-parser`

Then in `server/src/index.ts`, add import:
```typescript
import cookieParser from 'cookie-parser';
```

After `app.use(express.json());` (line 32), add:
```typescript
app.use(cookieParser());
```

After the settings route mount, add:
```typescript
app.use('/api/auth/oidc', oidcRoutes);
```

**Step 3: Add cache invalidation to settings route**

In `server/src/routes/settings.ts`, import the invalidation function:
```typescript
import { invalidateOidcCache } from './oidc';
```

At the end of the PUT `/oidc` handler, before `res.json(...)`, add:
```typescript
    invalidateOidcCache();
```

**Step 4: Add `SERVER_URL` to docker-compose.yml**

In `docker-compose.yml`, under `server.environment`, add:
```yaml
      SERVER_URL: http://10.0.0.102:3006
```

Update `.env.example` to mention it:
```
# Required for SSO callback URL
SERVER_URL=http://localhost:3006
```

**Step 5: Verify compilation**

Run: `cd /home/bradley/cork/server && npx tsc --noEmit --skipLibCheck 2>&1 | head -5`
Expected: No errors

**Step 6: Commit**

```bash
cd /home/bradley/cork && git add server/src/routes/oidc.ts server/src/routes/settings.ts server/src/index.ts server/package.json server/package-lock.json docker-compose.yml .env.example
git commit -m "feat: add OIDC login flow (redirect, callback, auto-provision)"
```

---

### Task 6: TOTP Backend Routes

**Files:**
- Create: `server/src/routes/totp.ts`
- Modify: `server/src/routes/auth.ts` (add 2FA check to login)
- Modify: `server/src/middleware/auth.ts` (reject 2FA tickets as session tokens)
- Modify: `server/src/index.ts` (mount route)

**Step 1: Create TOTP routes**

Create `server/src/routes/totp.ts`:

```typescript
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import pool from '../db';
import { authenticate, generateToken } from '../middleware/auth';
import { AuthRequest } from '../types';
import { encrypt, decrypt } from '../utils/crypto';

const router = Router();

function getJwtSecret(): string {
  return process.env.JWT_SECRET || '';
}

// POST /api/auth/verify-2fa — Verify TOTP code with ticket
router.post('/verify-2fa', async (req: Request, res: Response) => {
  try {
    const { ticket, code } = req.body;

    if (!ticket || !code) {
      return res.status(400).json({ error: 'Ticket and code are required' });
    }

    // Verify the ticket
    let decoded: { id: string; purpose: string };
    try {
      decoded = jwt.verify(ticket, getJwtSecret()) as any;
    } catch {
      return res.status(401).json({ error: 'Invalid or expired ticket' });
    }

    if (decoded.purpose !== '2fa') {
      return res.status(401).json({ error: 'Invalid ticket type' });
    }

    // Get user's TOTP secret
    const totpResult = await pool.query(
      'SELECT secret_encrypted, backup_codes FROM user_totp WHERE user_id = $1 AND enabled = true',
      [decoded.id]
    );

    if (totpResult.rows.length === 0) {
      return res.status(400).json({ error: '2FA is not enabled for this user' });
    }

    const { secret_encrypted, backup_codes } = totpResult.rows[0];
    const secret = decrypt(secret_encrypted);

    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });

    const codeStr = String(code).trim();

    // Try TOTP code first
    const delta = totp.validate({ token: codeStr, window: 1 });
    if (delta !== null) {
      // Valid TOTP code — issue real JWT
      const userResult = await pool.query(
        'SELECT id, username, role FROM users WHERE id = $1',
        [decoded.id]
      );
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      const user = userResult.rows[0];
      const token = generateToken({ id: user.id, username: user.username, role: user.role });
      return res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    }

    // Try backup codes
    if (backup_codes && backup_codes.length > 0) {
      for (let i = 0; i < backup_codes.length; i++) {
        const match = await bcrypt.compare(codeStr, backup_codes[i]);
        if (match) {
          // Remove used backup code
          const updated = [...backup_codes];
          updated.splice(i, 1);
          await pool.query(
            'UPDATE user_totp SET backup_codes = $1 WHERE user_id = $2',
            [updated, decoded.id]
          );

          const userResult = await pool.query(
            'SELECT id, username, role FROM users WHERE id = $1',
            [decoded.id]
          );
          const user = userResult.rows[0];
          const token = generateToken({ id: user.id, username: user.username, role: user.role });
          return res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
        }
      }
    }

    return res.status(401).json({ error: 'Invalid code' });
  } catch (error) {
    console.error('Verify 2FA error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/settings/totp/status — Check if 2FA is enabled for current user
router.get('/status', authenticate, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'SELECT enabled FROM user_totp WHERE user_id = $1',
      [req.user!.id]
    );
    res.json({ enabled: result.rows.length > 0 && result.rows[0].enabled });
  } catch (error) {
    console.error('TOTP status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/settings/totp/setup — Generate TOTP secret + QR code
router.post('/setup', authenticate, async (req: AuthRequest, res) => {
  try {
    // Check if user is SSO-only (no password)
    const userResult = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user!.id]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!userResult.rows[0].password_hash) {
      return res.status(400).json({ error: 'SSO users cannot enable TOTP 2FA' });
    }

    // Check if already enabled
    const existing = await pool.query(
      'SELECT enabled FROM user_totp WHERE user_id = $1',
      [req.user!.id]
    );
    if (existing.rows.length > 0 && existing.rows[0].enabled) {
      return res.status(400).json({ error: '2FA is already enabled. Disable it first.' });
    }

    // Generate secret
    const secret = new OTPAuth.Secret({ size: 20 });

    const totp = new OTPAuth.TOTP({
      issuer: 'Plank',
      label: req.user!.username,
      secret,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });

    const uri = totp.toString();
    const qrDataUrl = await QRCode.toDataURL(uri);

    // Generate backup codes
    const backupCodes: string[] = [];
    const hashedCodes: string[] = [];
    for (let i = 0; i < 8; i++) {
      const code = crypto.randomBytes(4).toString('hex'); // 8 hex chars
      backupCodes.push(code);
      hashedCodes.push(await bcrypt.hash(code, 10));
    }

    // Store (not yet enabled)
    const encryptedSecret = encrypt(secret.base32);
    await pool.query(
      `INSERT INTO user_totp (user_id, secret_encrypted, enabled, backup_codes)
       VALUES ($1, $2, false, $3)
       ON CONFLICT (user_id) DO UPDATE SET secret_encrypted = $2, enabled = false, backup_codes = $3`,
      [req.user!.id, encryptedSecret, hashedCodes]
    );

    res.json({
      qr_code: qrDataUrl,
      secret: secret.base32,
      backup_codes: backupCodes,
    });
  } catch (error) {
    console.error('TOTP setup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/settings/totp/enable — Verify code and enable 2FA
router.post('/enable', authenticate, async (req: AuthRequest, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Verification code is required' });
    }

    const result = await pool.query(
      'SELECT secret_encrypted FROM user_totp WHERE user_id = $1 AND enabled = false',
      [req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'No pending 2FA setup found' });
    }

    const secret = decrypt(result.rows[0].secret_encrypted);
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });

    const delta = totp.validate({ token: String(code).trim(), window: 1 });
    if (delta === null) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

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

// DELETE /api/settings/totp — Disable 2FA (requires password)
router.delete('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password is required to disable 2FA' });
    }

    // Verify password
    const userResult = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user!.id]
    );
    if (userResult.rows.length === 0 || !userResult.rows[0].password_hash) {
      return res.status(400).json({ error: 'Cannot verify password' });
    }

    const valid = await bcrypt.compare(password, userResult.rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    await pool.query('DELETE FROM user_totp WHERE user_id = $1', [req.user!.id]);

    res.json({ message: '2FA disabled successfully' });
  } catch (error) {
    console.error('TOTP disable error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
```

**Step 2: Modify login route to check for 2FA**

In `server/src/routes/auth.ts`, after the password verification succeeds (after line 28: `if (!valid) { ... }`), add the 2FA check before issuing the token:

Replace the token generation block (lines 30-43) with:

```typescript
    // Check if user has 2FA enabled
    const totpResult = await pool.query(
      'SELECT enabled FROM user_totp WHERE user_id = $1 AND enabled = true',
      [user.id]
    );

    if (totpResult.rows.length > 0) {
      // Issue a short-lived 2FA ticket instead of a full token
      const ticket = jwt.sign(
        { id: user.id, purpose: '2fa' },
        process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex'),
        { expiresIn: '5m' }
      );
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
```

Also add import at the top of `auth.ts`:
```typescript
import jwt from 'jsonwebtoken';
```

**Step 3: Reject SSO-only users from password login**

In `server/src/routes/auth.ts`, after fetching the user (after line 19), add:

```typescript
    if (!user.password_hash) {
      return res.status(401).json({ error: 'Please use SSO to log in' });
    }
```

**Step 4: Reject 2FA tickets in authenticate middleware**

In `server/src/middleware/auth.ts`, after decoding the token (line 29-33), add a check:

```typescript
    if ((decoded as any).purpose) {
      return res.status(401).json({ error: 'Invalid token' });
    }
```

**Step 5: Mount TOTP routes in index.ts**

In `server/src/index.ts`, add import:
```typescript
import totpRoutes from './routes/totp';
```

Mount the routes (the verify-2fa endpoint is public, TOTP management requires auth):
```typescript
app.use('/api/auth', totpRoutes); // mounts POST /api/auth/verify-2fa
app.use('/api/settings/totp', totpRoutes); // mounts GET /status, POST /setup, POST /enable, DELETE /
```

Note: The router handles both mount points because Express merges them. The `/verify-2fa` path only matches under `/api/auth`, and `/status`, `/setup`, `/enable` paths only match under `/api/settings/totp`. This works because the route paths are unique.

Actually, cleaner approach: split into two routers or mount verify-2fa separately. Let's keep it simple — put verify-2fa in the auth routes file instead:

Move the `POST /verify-2fa` handler into `server/src/routes/auth.ts` and keep the rest in `server/src/routes/totp.ts`. Then mount only:
```typescript
app.use('/api/settings/totp', totpRoutes);
```

**Step 6: Verify compilation**

Run: `cd /home/bradley/cork/server && npx tsc --noEmit --skipLibCheck 2>&1 | head -5`
Expected: No errors

**Step 7: Commit**

```bash
cd /home/bradley/cork && git add server/src/routes/totp.ts server/src/routes/auth.ts server/src/middleware/auth.ts server/src/index.ts
git commit -m "feat: add TOTP 2FA backend (setup, enable, disable, verify)"
```

---

### Task 7: Frontend Types and API Client Updates

**Files:**
- Modify: `client/src/types.ts`
- Modify: `client/src/api.ts`

**Step 1: Add frontend types**

In `client/src/types.ts`, add at the end:

```typescript
export interface OidcPublicConfig {
  enabled: boolean;
  button_label: string;
}

export interface OidcAdminConfig {
  enabled: boolean;
  issuer_url: string;
  client_id: string;
  client_secret_masked: string;
  button_label: string;
}

export interface TotpSetupResponse {
  qr_code: string;
  secret: string;
  backup_codes: string[];
}

export interface LoginResponse {
  token?: string;
  user?: User;
  requires_2fa?: boolean;
  ticket?: string;
}
```

**Step 2: Add API methods**

In `client/src/api.ts`, add these methods to the `ApiClient` class before the closing brace:

```typescript
  // SSO
  async getOidcPublicConfig(): Promise<{ enabled: boolean; button_label: string }> {
    // This is a public endpoint, no auth needed
    const response = await fetch(`${API_URL}/auth/oidc/config`);
    return response.json();
  }

  // SSO Admin Settings
  async getOidcSettings() {
    return this.fetch('/settings/oidc');
  }

  async updateOidcSettings(settings: {
    enabled?: boolean;
    issuer_url?: string;
    client_id?: string;
    client_secret?: string;
    button_label?: string;
  }) {
    return this.fetch('/settings/oidc', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // TOTP 2FA
  async getTotpStatus(): Promise<{ enabled: boolean }> {
    return this.fetch('/settings/totp/status');
  }

  async setupTotp(): Promise<{ qr_code: string; secret: string; backup_codes: string[] }> {
    return this.fetch('/settings/totp/setup', { method: 'POST' });
  }

  async enableTotp(code: string): Promise<{ message: string }> {
    return this.fetch('/settings/totp/enable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  async disableTotp(password: string): Promise<{ message: string }> {
    return this.fetch('/settings/totp', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    });
  }

  async verify2fa(ticket: string, code: string) {
    const data = await this.fetch('/auth/verify-2fa', {
      method: 'POST',
      body: JSON.stringify({ ticket, code }),
    });
    this.setToken(data.token);
    return data.user;
  }
```

**Step 3: Modify login method to handle 2FA response**

Replace the existing `login` method in `client/src/api.ts`:

```typescript
  async login(username: string, password: string): Promise<any> {
    const data = await this.fetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    if (data.requires_2fa) {
      return { requires_2fa: true, ticket: data.ticket };
    }

    this.setToken(data.token);
    return { user: data.user };
  }
```

**Step 4: Verify compilation**

Run: `cd /home/bradley/cork/client && npx tsc --noEmit 2>&1 | head -20`
Expected: May have errors from Login.tsx / App.tsx due to login return type change. Those will be fixed in subsequent tasks.

**Step 5: Commit**

```bash
cd /home/bradley/cork && git add client/src/types.ts client/src/api.ts
git commit -m "feat: add SSO and TOTP API client methods and types"
```

---

### Task 8: Login Page — SSO Button, 2FA Challenge, Token Pickup

**Files:**
- Modify: `client/src/components/Login.tsx`
- Modify: `client/src/App.tsx`

**Step 1: Rewrite Login.tsx to support SSO + 2FA**

Replace the full contents of `client/src/components/Login.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import PlankLogo from './PlankLogo';

interface LoginProps {
  onLogin: (username: string, password: string) => Promise<void>;
  onSsoLogin: (token: string) => Promise<void>;
  ssoError?: string | null;
}

export default function Login({ onLogin, onSsoLogin, ssoError }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 2FA state
  const [awaiting2fa, setAwaiting2fa] = useState(false);
  const [ticket, setTicket] = useState('');
  const [totpCode, setTotpCode] = useState('');

  // SSO config
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoButtonLabel, setSsoButtonLabel] = useState('Login with SSO');

  const totpInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getOidcPublicConfig().then(config => {
      setSsoEnabled(config.enabled);
      setSsoButtonLabel(config.button_label);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (ssoError) {
      setError(ssoError === 'state_mismatch' ? 'SSO session expired. Please try again.' :
               ssoError === 'not_configured' ? 'SSO is not configured.' :
               `SSO login failed: ${ssoError}`);
    }
  }, [ssoError]);

  useEffect(() => {
    if (awaiting2fa && totpInputRef.current) {
      totpInputRef.current.focus();
    }
  }, [awaiting2fa]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await onLogin(username, password);
    } catch (err: any) {
      if (err.requires_2fa) {
        setTicket(err.ticket);
        setAwaiting2fa(true);
      } else {
        setError(err.message || 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const user = await api.verify2fa(ticket, totpCode);
      // Trigger the SSO login handler which just sets user state
      await onSsoLogin(api.getToken()!);
    } catch (err: any) {
      setError(err.message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  const handleSsoLogin = () => {
    window.location.href = '/api/auth/oidc/login';
  };

  if (awaiting2fa) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-logo">
            <PlankLogo size={48} />
            <h1>Plank</h1>
          </div>
          <p className="login-subtitle">Enter the 6-digit code from your authenticator app</p>
          <form onSubmit={handleVerify2fa}>
            <div className="form-group">
              <label htmlFor="totp-code">Verification code</label>
              <input
                ref={totpInputRef}
                type="text"
                id="totp-code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
              />
              <span className="form-hint">Or enter a backup code</span>
            </div>
            {error && <div className="error">{error}</div>}
            <button type="submit" disabled={loading || totpCode.length < 6}>
              {loading ? 'Verifying...' : 'Verify'}
            </button>
            <button
              type="button"
              className="btn-link login-back-link"
              onClick={() => { setAwaiting2fa(false); setTotpCode(''); setError(''); }}
            >
              Back to login
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">
          <PlankLogo size={48} />
          <h1>Plank</h1>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        {ssoEnabled && (
          <>
            <div className="login-divider">
              <span>or</span>
            </div>
            <button
              type="button"
              className="btn-sso"
              onClick={handleSsoLogin}
              disabled={loading}
            >
              {ssoButtonLabel}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Update App.tsx to handle SSO token pickup and new Login props**

In `client/src/App.tsx`:

1. Add a token pickup effect. In the session restoration `useEffect` (around line 121), add SSO token pickup at the beginning:

```typescript
  useEffect(() => {
    // Check for SSO token in URL
    const params = new URLSearchParams(window.location.search);
    const ssoToken = params.get('token');
    const ssoError = params.get('sso_error');

    if (ssoToken) {
      // Clean URL
      window.history.replaceState(null, '', window.location.pathname);
      api.setToken(ssoToken);
      api.me()
        .then(async (userData) => {
          setUser(userData);
          await resolveUrlRoute(userData);
          setLoading(false);
        })
        .catch(() => {
          api.setToken(null);
          setLoading(false);
        });
      return;
    }

    if (ssoError) {
      setSsoError(ssoError);
      window.history.replaceState(null, '', window.location.pathname);
    }

    const token = api.getToken();
    if (token) {
      api.me()
        .then(async (userData) => {
          setUser(userData);
          await resolveUrlRoute(userData);
          setLoading(false);
        })
        .catch(() => {
          api.setToken(null);
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, [resolveUrlRoute]);
```

2. Add `ssoError` state near the other state declarations:
```typescript
const [ssoError, setSsoError] = useState<string | null>(null);
```

3. Update `handleLogin` to handle the 2FA case:

```typescript
  const handleLogin = async (username: string, password: string) => {
    const result = await api.login(username, password);
    if (result.requires_2fa) {
      // Throw with 2FA info so Login component can handle it
      const err: any = new Error('2FA required');
      err.requires_2fa = true;
      err.ticket = result.ticket;
      throw err;
    }
    setUser(result.user);
    await resolveUrlRoute(result.user);
  };
```

4. Add `handleSsoLogin` handler:
```typescript
  const handleSsoLogin = async (token: string) => {
    const userData = await api.me();
    setUser(userData);
    await resolveUrlRoute(userData);
  };
```

5. Update the Login render to pass new props:
```tsx
<Login onLogin={handleLogin} onSsoLogin={handleSsoLogin} ssoError={ssoError} />
```

**Step 3: Verify compilation**

Run: `cd /home/bradley/cork/client && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors (or only unrelated warnings)

**Step 4: Commit**

```bash
cd /home/bradley/cork && git add client/src/components/Login.tsx client/src/App.tsx
git commit -m "feat: add SSO button, 2FA challenge screen, and token pickup to login"
```

---

### Task 9: Profile Settings Page (2FA Management)

**Files:**
- Create: `client/src/components/ProfileSettings.tsx`
- Modify: `client/src/App.tsx` (add route + navigation)

**Step 1: Create ProfileSettings component**

Create `client/src/components/ProfileSettings.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { api } from '../api';
import { User } from '../types';
import AppBar from './AppBar';

interface ProfileSettingsProps {
  user: User;
  onBack: () => void;
}

export default function ProfileSettings({ user, onBack }: ProfileSettingsProps) {
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  // Setup flow state
  const [setupMode, setSetupMode] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verifyCode, setVerifyCode] = useState('');
  const [setupError, setSetupError] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [showBackupCodes, setShowBackupCodes] = useState(false);

  // Disable flow state
  const [disableMode, setDisableMode] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableError, setDisableError] = useState('');
  const [disableLoading, setDisableLoading] = useState(false);

  useEffect(() => {
    api.getTotpStatus()
      .then(data => setTotpEnabled(data.enabled))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleStartSetup = async () => {
    setSetupLoading(true);
    setSetupError('');
    try {
      const data = await api.setupTotp();
      setQrCode(data.qr_code);
      setSecretKey(data.secret);
      setBackupCodes(data.backup_codes);
      setSetupMode(true);
    } catch (err: any) {
      setSetupError(err.message || 'Failed to start setup');
    } finally {
      setSetupLoading(false);
    }
  };

  const handleVerifyAndEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupLoading(true);
    setSetupError('');
    try {
      await api.enableTotp(verifyCode);
      setTotpEnabled(true);
      setShowBackupCodes(true);
    } catch (err: any) {
      setSetupError(err.message || 'Invalid code');
    } finally {
      setSetupLoading(false);
    }
  };

  const handleFinishSetup = () => {
    setSetupMode(false);
    setShowBackupCodes(false);
    setQrCode('');
    setSecretKey('');
    setBackupCodes([]);
    setVerifyCode('');
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setDisableLoading(true);
    setDisableError('');
    try {
      await api.disableTotp(disablePassword);
      setTotpEnabled(false);
      setDisableMode(false);
      setDisablePassword('');
    } catch (err: any) {
      setDisableError(err.message || 'Failed to disable 2FA');
    } finally {
      setDisableLoading(false);
    }
  };

  return (
    <div className="profile-settings">
      <AppBar title="Profile" onBack={onBack} />

      <div className="profile-settings-content">
        <section className="profile-section">
          <h2>Account</h2>
          <div className="profile-field">
            <label>Username</label>
            <span>{user.username}</span>
          </div>
          <div className="profile-field">
            <label>Role</label>
            <span className={`role-badge role-${user.role.toLowerCase()}`}>{user.role}</span>
          </div>
          {user.created_at && (
            <div className="profile-field">
              <label>Member since</label>
              <span>{new Date(user.created_at).toLocaleDateString()}</span>
            </div>
          )}
        </section>

        <section className="profile-section">
          <h2>Two-Factor Authentication</h2>

          {loading ? (
            <p className="profile-loading">Loading...</p>
          ) : showBackupCodes ? (
            <div className="totp-backup-codes">
              <p className="totp-success">2FA has been enabled successfully!</p>
              <p className="totp-warning">Save these backup codes in a safe place. Each code can only be used once. You won't be able to see them again.</p>
              <div className="backup-codes-grid">
                {backupCodes.map((code, i) => (
                  <code key={i} className="backup-code">{code}</code>
                ))}
              </div>
              <button onClick={handleFinishSetup} className="btn-primary">
                I've saved my backup codes
              </button>
            </div>
          ) : setupMode ? (
            <div className="totp-setup">
              <p>Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.):</p>
              <div className="totp-qr">
                <img src={qrCode} alt="TOTP QR Code" />
              </div>
              <details className="totp-manual-entry">
                <summary>Can't scan? Enter manually</summary>
                <code className="totp-secret">{secretKey}</code>
              </details>
              <form onSubmit={handleVerifyAndEnable}>
                <div className="form-group">
                  <label htmlFor="verify-code">Enter the 6-digit code from your app to verify</label>
                  <input
                    type="text"
                    id="verify-code"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="one-time-code"
                    required
                  />
                </div>
                {setupError && <div className="error">{setupError}</div>}
                <div className="profile-actions">
                  <button type="submit" disabled={setupLoading || verifyCode.length < 6}>
                    {setupLoading ? 'Verifying...' : 'Enable 2FA'}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => { setSetupMode(false); setSetupError(''); }}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          ) : totpEnabled ? (
            <div className="totp-enabled">
              <p className="totp-status-badge enabled">2FA is enabled</p>
              {disableMode ? (
                <form onSubmit={handleDisable}>
                  <div className="form-group">
                    <label htmlFor="disable-password">Enter your password to disable 2FA</label>
                    <input
                      type="password"
                      id="disable-password"
                      value={disablePassword}
                      onChange={(e) => setDisablePassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  {disableError && <div className="error">{disableError}</div>}
                  <div className="profile-actions">
                    <button type="submit" className="btn-danger" disabled={disableLoading}>
                      {disableLoading ? 'Disabling...' : 'Disable 2FA'}
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => { setDisableMode(false); setDisablePassword(''); setDisableError(''); }}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button onClick={() => setDisableMode(true)} className="btn-secondary">
                  Disable 2FA
                </button>
              )}
            </div>
          ) : (
            <div className="totp-disabled">
              <p>Add an extra layer of security to your account by requiring a verification code when logging in with your password.</p>
              {setupError && <div className="error">{setupError}</div>}
              <button onClick={handleStartSetup} disabled={setupLoading}>
                {setupLoading ? 'Setting up...' : 'Set up 2FA'}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
```

**Step 2: Add profile route to App.tsx**

1. Add `'profile'` to the `Page` type:
```typescript
type Page = 'boards' | 'users' | 'board' | 'notifications' | 'profile';
```

2. Import ProfileSettings:
```typescript
import ProfileSettings from './components/ProfileSettings';
```

3. Add navigation handler:
```typescript
  const handleGoToProfile = () => {
    setPrevPage({ page, boardId: currentBoardId, viewMode: boardViewMode });
    navigateTo('profile');
    window.history.pushState({ page: 'profile' }, '', '/profile');
  };
```

4. Add `onGoToProfile` to the appBarContext:
```typescript
  const appBarContext = useMemo(() => ({
    user,
    notifications,
    unreadCount,
    onMarkRead: handleMarkNotificationRead,
    onMarkAllRead: handleMarkAllNotificationsRead,
    onNavigateToBoard: handleNavigateToBoard,
    onGoToNotifications: handleGoToNotifications,
    onGoToProfile: handleGoToProfile,
    theme,
    onToggleTheme: toggleTheme,
    onLogout: handleLogout,
  }), [user, notifications, unreadCount, theme]);
```

5. Add the profile page render in the main return, before the `BoardList` fallback:
```tsx
      ) : page === 'profile' ? (
        <ProfileSettings
          user={user!}
          onBack={handleBackFromNotifications}
        />
```

6. Handle `/profile` in URL resolution. In `resolveUrlRoute`, add before the board slug matching:
```typescript
    if (slug === 'profile') {
      setPage('profile');
      return;
    }
```

7. Handle popstate for profile:
In the popstate handler, add a case for `'profile'`:
```typescript
      } else if (slug === 'profile') {
        setPage('profile');
        setCurrentBoardId(null);
        setAdminSubRoute(null);
      }
```

**Step 3: Update AppBar context types**

Check `client/src/contexts/AppBarContext.ts` and add `onGoToProfile` to the context type.

**Step 4: Verify compilation**

Run: `cd /home/bradley/cork/client && npx tsc --noEmit 2>&1 | head -20`

**Step 5: Commit**

```bash
cd /home/bradley/cork && git add client/src/components/ProfileSettings.tsx client/src/App.tsx client/src/contexts/AppBarContext.ts
git commit -m "feat: add profile settings page with 2FA setup/disable"
```

---

### Task 10: Admin OIDC Settings Page

**Files:**
- Create: `client/src/components/OidcSettings.tsx`
- Modify: `client/src/components/UserManagement.tsx` (add settings sub-route)

**Step 1: Create OidcSettings component**

Create `client/src/components/OidcSettings.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { api } from '../api';

interface OidcSettingsProps {
  onBack: () => void;
}

export default function OidcSettings({ onBack }: OidcSettingsProps) {
  const [enabled, setEnabled] = useState(false);
  const [issuerUrl, setIssuerUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [clientSecretMasked, setClientSecretMasked] = useState('');
  const [buttonLabel, setButtonLabel] = useState('Login with SSO');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.getOidcSettings()
      .then(data => {
        setEnabled(data.enabled);
        setIssuerUrl(data.issuer_url);
        setClientId(data.client_id);
        setClientSecretMasked(data.client_secret_masked);
        setButtonLabel(data.button_label);
      })
      .catch(err => setError(err.message || 'Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const updates: any = {
        enabled,
        issuer_url: issuerUrl,
        client_id: clientId,
        button_label: buttonLabel,
      };
      // Only send client_secret if user entered a new one
      if (clientSecret) {
        updates.client_secret = clientSecret;
      }
      await api.updateOidcSettings(updates);
      setSuccess('Settings saved');
      if (clientSecret) {
        setClientSecretMasked(clientSecret.length > 4 ? '••••' + clientSecret.slice(-4) : '••••');
        setClientSecret('');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div><p>Loading...</p></div>;
  }

  return (
    <div className="oidc-settings-form">
      <form onSubmit={handleSave}>
        <div className="form-group">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enable SSO
          </label>
          <span className="form-hint">When enabled, a SSO login button appears on the login page</span>
        </div>

        <div className="form-group">
          <label htmlFor="issuer-url">Issuer URL</label>
          <input
            type="url"
            id="issuer-url"
            value={issuerUrl}
            onChange={(e) => setIssuerUrl(e.target.value)}
            placeholder="https://pocketid.example.com"
            maxLength={500}
          />
          <span className="form-hint">The OIDC provider's base URL (must support .well-known/openid-configuration)</span>
        </div>

        <div className="form-group">
          <label htmlFor="client-id">Client ID</label>
          <input
            type="text"
            id="client-id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="plank"
            maxLength={255}
          />
        </div>

        <div className="form-group">
          <label htmlFor="client-secret">Client Secret</label>
          <input
            type="password"
            id="client-secret"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={clientSecretMasked || 'Enter client secret'}
          />
          {clientSecretMasked && !clientSecret && (
            <span className="form-hint">Current: {clientSecretMasked} — leave blank to keep</span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="button-label">Button Label</label>
          <input
            type="text"
            id="button-label"
            value={buttonLabel}
            onChange={(e) => setButtonLabel(e.target.value)}
            placeholder="Login with SSO"
            maxLength={100}
          />
          <span className="form-hint">Text shown on the login page SSO button</span>
        </div>

        {error && <div className="error">{error}</div>}
        {success && <div className="success">{success}</div>}

        <div className="profile-actions">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

**Step 2: Add settings sub-route to UserManagement**

In `client/src/components/UserManagement.tsx`, the component already supports sub-routing via the `subRoute` prop. Add a case for `subRoute === 'settings'`:

When `subRoute === 'settings'`, render AppBar with title "SSO Settings" + back button, and render `<OidcSettings />`.

Also add a "Settings" button/link in the user list view header (next to the "New User" button).

Import OidcSettings:
```typescript
import OidcSettings from './OidcSettings';
```

Add the settings render case at the top of the component's return, alongside the existing `subRoute === 'new'` and edit cases. When `subRoute === 'settings'`:

```tsx
if (subRoute === 'settings') {
  return (
    <div className="user-management">
      <AppBar title="SSO Settings" onBack={() => onNavigate(null)}>
        <span></span>
      </AppBar>
      <div className="user-management-content">
        <OidcSettings onBack={() => onNavigate(null)} />
      </div>
    </div>
  );
}
```

Add a Settings button in the list view header:
```tsx
<button onClick={() => onNavigate('settings')} className="btn-secondary btn-sm">
  SSO Settings
</button>
```

**Step 3: Handle `/admin/settings` URL routing**

This should already work because `adminSubRoute` captures everything after `/admin/`. The URL `/admin/settings` will set `adminSubRoute = 'settings'` which triggers the settings view.

**Step 4: Verify compilation**

Run: `cd /home/bradley/cork/client && npx tsc --noEmit 2>&1 | head -20`

**Step 5: Commit**

```bash
cd /home/bradley/cork && git add client/src/components/OidcSettings.tsx client/src/components/UserManagement.tsx
git commit -m "feat: add admin OIDC settings page"
```

---

### Task 11: User Menu Updates

**Files:**
- Modify: `client/src/components/UserMenu.tsx`
- Modify: `client/src/contexts/AppBarContext.ts` (add onGoToProfile)

**Step 1: Update AppBarContext**

Add `onGoToProfile?: () => void` to the context interface and default value.

**Step 2: Add Profile link to UserMenu**

In `client/src/components/UserMenu.tsx`:

1. Import and use AppBarContext:
```typescript
import { useContext } from 'react';
import AppBarContext from '../contexts/AppBarContext';
```

2. Get `onGoToProfile` from context:
```typescript
const { onGoToProfile } = useContext(AppBarContext);
```

3. Add a Profile button between the theme toggle and logout:
```tsx
<button onClick={() => { onGoToProfile?.(); setOpen(false); }} className="user-menu-item">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
  Profile
</button>
```

**Step 3: Verify compilation**

Run: `cd /home/bradley/cork/client && npx tsc --noEmit 2>&1 | head -20`

**Step 4: Commit**

```bash
cd /home/bradley/cork && git add client/src/components/UserMenu.tsx client/src/contexts/AppBarContext.ts
git commit -m "feat: add Profile link to user menu"
```

---

### Task 12: CSS Styles

**Files:**
- Modify: `client/src/index.css`

**Step 1: Add login page SSO styles**

Add these styles to `client/src/index.css`:

```css
/* Login divider */
.login-divider {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin: 1.25rem 0;
  color: var(--text-secondary);
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.login-divider::before,
.login-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}

/* SSO button */
.btn-sso {
  width: 100%;
  padding: 0.625rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card-bg);
  color: var(--text);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s var(--ease), border-color 0.15s var(--ease);
}

.btn-sso:hover {
  background: var(--bg-raised);
  border-color: var(--primary);
}

.btn-sso:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Login subtitle (for 2FA screen) */
.login-subtitle {
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.9rem;
  margin-bottom: 1.5rem;
}

.login-back-link {
  display: block;
  width: 100%;
  text-align: center;
  margin-top: 1rem;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0.5rem;
}

.login-back-link:hover {
  color: var(--primary);
}

/* Profile settings */
.profile-settings-content {
  max-width: 600px;
  margin: 0 auto;
  padding: 1.5rem;
}

.profile-section {
  margin-bottom: 2rem;
}

.profile-section h2 {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border);
}

.profile-field {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 0;
}

.profile-field label {
  font-size: 0.85rem;
  color: var(--text-secondary);
  min-width: 100px;
}

.profile-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}

.profile-loading {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

/* TOTP setup */
.totp-qr {
  display: flex;
  justify-content: center;
  margin: 1.5rem 0;
}

.totp-qr img {
  border-radius: var(--radius);
  border: 1px solid var(--border);
}

.totp-manual-entry {
  margin-bottom: 1.5rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.totp-manual-entry summary {
  cursor: pointer;
  margin-bottom: 0.5rem;
}

.totp-secret {
  display: block;
  padding: 0.5rem 0.75rem;
  background: var(--bg);
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  word-break: break-all;
  user-select: all;
}

.totp-status-badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  font-weight: 500;
  margin-bottom: 1rem;
}

.totp-status-badge.enabled {
  background: var(--success-subtle, #f0fff4);
  color: var(--success);
}

.totp-success {
  color: var(--success);
  font-weight: 500;
  margin-bottom: 0.75rem;
}

.totp-warning {
  color: var(--text-secondary);
  font-size: 0.9rem;
  margin-bottom: 1rem;
}

.backup-codes-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.backup-code {
  padding: 0.5rem 0.75rem;
  background: var(--bg);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  text-align: center;
  font-family: monospace;
  user-select: all;
}

/* Toggle label for checkbox */
.toggle-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
  cursor: pointer;
}

.toggle-label input[type="checkbox"] {
  width: auto;
}

/* Danger button */
.btn-danger {
  background: var(--danger);
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: var(--radius);
  cursor: pointer;
  font-weight: 500;
}

.btn-danger:hover {
  opacity: 0.9;
}

.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Success message */
.success {
  color: var(--success);
  background: var(--success-subtle, #f0fff4);
  border-radius: var(--radius);
  padding: 0.625rem 0.875rem;
  margin-bottom: 1rem;
  font-size: 0.9rem;
}

/* OIDC settings form */
.oidc-settings-form {
  padding: 0 1rem;
}
```

**Step 2: Commit**

```bash
cd /home/bradley/cork && git add client/src/index.css
git commit -m "feat: add CSS for SSO login, 2FA setup, profile, and OIDC settings"
```

---

### Task 13: Environment & Docker Updates

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`

**Step 1: Update docker-compose.yml**

Add these environment variables under `server.environment`:

```yaml
      SERVER_URL: http://10.0.0.102:3006
      TOTP_ENCRYPTION_KEY: ${TOTP_ENCRYPTION_KEY:-}
```

**Step 2: Update .env.example**

```
# Required — docker-compose will fail without these
DB_PASSWORD=change-me-use-a-strong-password
JWT_SECRET=change-me-use-a-long-random-string-at-least-32-chars

# Optional
CLIENT_URL=http://localhost:5174

# SSO (configure via admin UI, but SERVER_URL is needed for callback)
SERVER_URL=http://localhost:3006

# Optional — defaults to JWT_SECRET if not set
TOTP_ENCRYPTION_KEY=optional-separate-key-for-totp-encryption
```

**Step 3: Commit**

```bash
cd /home/bradley/cork && git add docker-compose.yml .env.example
git commit -m "chore: add SSO and TOTP environment variables"
```

---

### Task 14: Manual Integration Testing

**No files changed — verification only.**

**Step 1: Start dev environment**

Run: `cd /home/bradley/cork/server && npm run migrate && npm run dev`
Run (separate terminal): `cd /home/bradley/cork/client && npm run dev`

**Step 2: Test password login still works**

1. Navigate to `http://localhost:5173`
2. Login with admin/admin123
3. Verify normal board access

**Step 3: Test OIDC config admin UI**

1. Navigate to `/admin/settings`
2. Fill in PocketID issuer URL, client ID, client secret
3. Enable SSO and save
4. Log out, verify SSO button appears on login page

**Step 4: Test SSO login flow**

1. Click SSO button on login page
2. Should redirect to PocketID
3. Authenticate with PocketID
4. Should redirect back with token and land on board list

**Step 5: Test 2FA setup**

1. Login with password, go to `/profile`
2. Click "Set up 2FA"
3. Scan QR code with authenticator app
4. Enter verification code, enable
5. Save backup codes
6. Log out, log in again with password
7. Should see TOTP challenge screen
8. Enter code from authenticator
9. Should complete login

**Step 6: Test 2FA disable**

1. Go to `/profile`
2. Click "Disable 2FA", enter password
3. Log out, log in again — should not ask for TOTP

**Step 7: Deploy**

Run: `ssh bradley@10.0.0.102 "cd /opt/stacks/plank && git pull && docker compose up -d --build"`
Run migration on server: `docker compose exec server npm run migrate`

**Step 8: Commit (squash if desired)**

```bash
cd /home/bradley/cork && git add -A
git commit -m "feat: SSO login via OIDC and optional TOTP 2FA"
```
