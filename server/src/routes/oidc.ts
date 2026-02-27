import { Router, Request, Response } from 'express';
import * as client from 'openid-client';
import pool from '../db';
import { decrypt } from '../utils/crypto';
import { generateToken, signTicket } from '../middleware/auth';

const router = Router();

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const SERVER_URL = process.env.SERVER_URL || CLIENT_URL;

// --- OIDC client cache (1-minute TTL) ---
let cachedConfig: client.Configuration | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

export function invalidateOidcCache(): void {
  cachedConfig = null;
  cacheTimestamp = 0;
}

interface OidcClaimMapping {
  email: string;
  name: string;
  avatar: string;
}

let cachedClaimMapping: OidcClaimMapping = { email: 'email', name: 'name', avatar: 'picture' };
let cachedCallbackBaseUrl: string = CLIENT_URL;

function getClientRedirectUrl(): string {
  return cachedCallbackBaseUrl || CLIENT_URL;
}

async function getOidcConfig(): Promise<{
  config: client.Configuration;
  issuerUrl: string;
  claimMapping: OidcClaimMapping;
  callbackBaseUrl: string;
} | null> {
  // Return cached if still fresh
  if (cachedConfig && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    const meta = cachedConfig.serverMetadata();
    return { config: cachedConfig, issuerUrl: meta.issuer, claimMapping: cachedClaimMapping, callbackBaseUrl: cachedCallbackBaseUrl };
  }

  const result = await pool.query(
    'SELECT enabled, issuer_url, client_id, client_secret, claim_email, claim_name, claim_avatar, callback_base_url FROM oidc_config WHERE id = 1'
  );

  if (result.rows.length === 0 || !result.rows[0].enabled) {
    return null;
  }

  const row = result.rows[0];
  if (!row.issuer_url || !row.client_id) {
    return null;
  }

  let clientSecret: string | undefined;
  if (row.client_secret) {
    clientSecret = decrypt(row.client_secret);
  }

  const issuerUrl = new URL(row.issuer_url);

  // Build discovery options -- allow insecure (HTTP) for local/private networks
  const discoveryOptions: client.DiscoveryRequestOptions = {};
  if (issuerUrl.protocol === 'http:') {
    discoveryOptions.execute = [client.allowInsecureRequests];
  }

  const config = await client.discovery(
    issuerUrl,
    row.client_id,
    clientSecret,
    undefined,
    discoveryOptions
  );

  cachedConfig = config;
  cacheTimestamp = Date.now();
  cachedClaimMapping = {
    email: row.claim_email || 'email',
    name: row.claim_name || 'name',
    avatar: row.claim_avatar || 'picture',
  };
  cachedCallbackBaseUrl = row.callback_base_url || CLIENT_URL;

  return { config, issuerUrl: row.issuer_url, claimMapping: cachedClaimMapping, callbackBaseUrl: cachedCallbackBaseUrl };
}

// --- GET /config (Public) ---
router.get('/config', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT enabled, button_label FROM oidc_config WHERE id = 1'
    );

    if (result.rows.length === 0) {
      return res.json({ enabled: false, button_label: 'Login with SSO' });
    }

    const row = result.rows[0];
    res.json({
      enabled: row.enabled,
      button_label: row.button_label || 'Login with SSO'
    });
  } catch (error) {
    console.error('OIDC config error:', error);
    res.json({ enabled: false, button_label: 'Login with SSO' });
  }
});

// --- GET /login (Public) ---
router.get('/login', async (_req: Request, res: Response) => {
  try {
    const oidc = await getOidcConfig();
    if (!oidc) {
      return res.status(400).json({ error: 'OIDC is not configured or not enabled' });
    }

    const { config, callbackBaseUrl } = oidc;

    const state = client.randomState();
    const nonce = client.randomNonce();

    const redirectUri = `${callbackBaseUrl}/api/auth/oidc/callback`;

    const authUrl = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      state,
      nonce
    });

    // Store state + nonce in a short-lived httpOnly cookie
    res.cookie('oidc_state', JSON.stringify({ state, nonce }), {
      httpOnly: true,
      secure: false, // internal network uses HTTP
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000, // 5 minutes
      path: '/'
    });

    res.redirect(authUrl.href);
  } catch (error) {
    console.error('OIDC login error:', error);
    res.redirect(`${getClientRedirectUrl()}/#sso_error=login_failed`);
  }
});

// --- GET /callback (Public) ---
router.get('/callback', async (req: Request, res: Response) => {
  try {
    // Parse state cookie
    const stateCookie = req.cookies?.oidc_state;
    if (!stateCookie) {
      return res.redirect(`${getClientRedirectUrl()}/#sso_error=missing_state`);
    }

    let storedState: string;
    let storedNonce: string;
    try {
      const parsed = JSON.parse(stateCookie);
      storedState = parsed.state;
      storedNonce = parsed.nonce;
    } catch {
      return res.redirect(`${getClientRedirectUrl()}/#sso_error=invalid_state`);
    }

    // Clear the cookie
    res.clearCookie('oidc_state', { path: '/' });

    // Check for error from provider
    if (req.query.error) {
      const errorDesc = req.query.error_description || req.query.error;
      return res.redirect(`${getClientRedirectUrl()}/#sso_error=${encodeURIComponent(String(errorDesc))}`);
    }

    // Verify state matches
    if (req.query.state !== storedState) {
      return res.redirect(`${getClientRedirectUrl()}/#sso_error=state_mismatch`);
    }

    const oidc = await getOidcConfig();
    if (!oidc) {
      return res.redirect(`${getClientRedirectUrl()}/#sso_error=oidc_not_configured`);
    }

    const { config, issuerUrl, claimMapping, callbackBaseUrl } = oidc;

    // Build the full callback URL from the incoming request
    const callbackUrl = new URL(`${callbackBaseUrl}${req.originalUrl}`);

    // Exchange authorization code for tokens
    const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
      expectedNonce: storedNonce,
      expectedState: storedState
    });

    const claims = tokens.claims();
    if (!claims) {
      return res.redirect(`${getClientRedirectUrl()}/#sso_error=no_id_token`);
    }

    const sub = claims.sub;
    const preferredUsername = (claims as any).preferred_username || (claims as any)[claimMapping.email] || sub;

    // Look up user_oidc by (oidc_subject, oidc_issuer)
    const oidcLookup = await pool.query(
      'SELECT user_id FROM user_oidc WHERE oidc_subject = $1 AND oidc_issuer = $2',
      [sub, issuerUrl]
    );

    let userId: string;
    let username: string;
    let role: 'GUEST' | 'MEMBER' | 'ADMIN';

    // Extract profile fields from claims using configurable mapping
    const email = (claims as any)[claimMapping.email] || null;
    const displayName = (claims as any)[claimMapping.name] || null;
    const avatarUrl = (claims as any)[claimMapping.avatar] || null;

    if (oidcLookup.rows.length > 0) {
      // Existing linked user — sync profile fields
      const userResult = await pool.query(
        'UPDATE users SET email = COALESCE($2, email), display_name = COALESCE($3, display_name), avatar_url = COALESCE($4, avatar_url) WHERE id = $1 RETURNING id, username, role',
        [oidcLookup.rows[0].user_id, email, displayName, avatarUrl]
      );

      if (userResult.rows.length === 0) {
        return res.redirect(`${getClientRedirectUrl()}/#sso_error=user_not_found`);
      }

      userId = userResult.rows[0].id;
      username = userResult.rows[0].username;
      role = userResult.rows[0].role;
    } else {
      // Auto-create user with READ role (in a transaction)
      const dbClient = await pool.connect();
      try {
        await dbClient.query('BEGIN');

        let baseUsername = String(preferredUsername).replace(/[^a-zA-Z0-9_.-]/g, '_').substring(0, 50);
        if (!baseUsername) baseUsername = 'sso_user';

        // Deduplicate username (max 100 attempts)
        let candidateUsername = baseUsername;
        let suffix = 0;
        while (suffix < 100) {
          const existing = await dbClient.query(
            'SELECT id FROM users WHERE username = $1',
            [candidateUsername]
          );
          if (existing.rows.length === 0) break;
          suffix++;
          candidateUsername = `${baseUsername}_${suffix}`;
        }

        username = candidateUsername;
        role = 'GUEST';

        const newUser = await dbClient.query(
          'INSERT INTO users (username, password_hash, role, email, display_name, avatar_url) VALUES ($1, NULL, $2, $3, $4, $5) RETURNING id',
          [username, role, email, displayName, avatarUrl]
        );
        userId = newUser.rows[0].id;

        await dbClient.query(
          'INSERT INTO user_oidc (user_id, oidc_subject, oidc_issuer) VALUES ($1, $2, $3)',
          [userId, sub, issuerUrl]
        );

        await dbClient.query('COMMIT');
      } catch (txError) {
        await dbClient.query('ROLLBACK');
        throw txError;
      } finally {
        dbClient.release();
      }
    }

    // Check if user has TOTP 2FA enabled
    const totpResult = await pool.query(
      'SELECT enabled FROM user_totp WHERE user_id = $1 AND enabled = true',
      [userId]
    );

    if (totpResult.rows.length > 0) {
      // Issue a short-lived 2FA ticket instead of a full JWT
      const ticket = signTicket({ id: userId, purpose: '2fa' }, '5m');
      return res.redirect(`${getClientRedirectUrl()}/#requires_2fa=true&ticket=${encodeURIComponent(ticket)}`);
    }

    // Issue a Plank JWT
    const token = generateToken({ id: userId, username, role });

    // Redirect to client with token in URL fragment (not query string)
    // Fragments are never sent in Referer headers or server logs
    res.redirect(`${getClientRedirectUrl()}/#token=${encodeURIComponent(token)}`);
  } catch (error) {
    console.error('OIDC callback error:', error);
    res.redirect(`${getClientRedirectUrl()}/#sso_error=callback_failed`);
  }
});

export default router;
