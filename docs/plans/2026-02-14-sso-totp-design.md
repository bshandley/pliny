# SSO Login & Optional TOTP 2FA Design

## Overview

Add OIDC-based SSO login (via PocketID) and optional TOTP two-factor authentication for password logins to Plank.

## Requirements

- SSO via PocketID (standard OIDC Authorization Code flow)
- Password + SSO coexist — user picks on login page
- 2FA (TOTP) applies to password login only (SSO already uses passkeys)
- Auto-provision SSO users with READ role on first login
- OIDC configuration managed in admin UI (stored in DB)
- 2FA setup via user profile/settings page (QR code, enable/disable)

## Approach

Server-side OIDC with `openid-client`. Backend handles the full OIDC flow — redirect to PocketID, receive callback, exchange code for tokens, extract user info. Frontend just redirects to a backend URL. Secrets never touch the browser.

## Architecture

### OIDC Flow

1. User clicks "Login with PocketID" on login page
2. Frontend redirects to `GET /api/auth/oidc/login`
3. Backend builds OIDC authorization URL (using discovery document) and redirects browser to PocketID
4. User authenticates with PocketID (passkeys)
5. PocketID redirects back to `GET /api/auth/oidc/callback` with authorization code
6. Backend exchanges code for tokens, extracts user info from ID token
7. Backend finds-or-creates Plank user (auto-create with READ role if new)
8. Backend issues Plank JWT and redirects browser to `/?token=xxx`
9. Frontend picks up token, stores in localStorage, proceeds normally

### 2FA Flow (password login only)

1. User submits username + password
2. Backend verifies credentials
3. If 2FA enabled: returns `{ requires_2fa: true, ticket: "..." }` instead of JWT
4. Frontend shows TOTP input screen
5. User enters 6-digit code from authenticator app
6. Frontend sends `POST /api/auth/verify-2fa` with ticket + code
7. Backend verifies TOTP code, issues real JWT

## Database Schema

Migration 008:

```sql
-- Single-row OIDC configuration (admin-managed)
CREATE TABLE oidc_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT false,
  issuer_url VARCHAR(500),
  client_id VARCHAR(255),
  client_secret VARCHAR(500),       -- AES-256-GCM encrypted
  button_label VARCHAR(100) DEFAULT 'Login with SSO',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Per-user TOTP secrets
CREATE TABLE user_totp (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted VARCHAR(500) NOT NULL,  -- AES-256-GCM encrypted
  enabled BOOLEAN NOT NULL DEFAULT false,
  backup_codes TEXT[],                      -- bcrypt-hashed, single-use
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Maps OIDC subject to Plank user
CREATE TABLE user_oidc (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  oidc_subject VARCHAR(255) NOT NULL,
  oidc_issuer VARCHAR(500) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(oidc_subject, oidc_issuer)
);

-- Allow SSO-only users (no password)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
```

## Backend Routes

### OIDC routes (`server/src/routes/oidc.ts`)

- `GET /api/auth/oidc/login` — Build OIDC auth URL, redirect browser to PocketID
- `GET /api/auth/oidc/callback` — Exchange code for tokens, find/create user, issue JWT, redirect to frontend
- `GET /api/auth/oidc/config` — Public. Returns `{ enabled, button_label }` for login page

### Settings routes (`server/src/routes/settings.ts`)

- `GET /api/settings/oidc` — Admin only. Full OIDC config (secret masked)
- `PUT /api/settings/oidc` — Admin only. Update OIDC config

### TOTP routes (`server/src/routes/totp.ts`)

- `POST /api/auth/verify-2fa` — Public (with ticket). Verify TOTP code, return JWT
- `POST /api/settings/totp/setup` — Authenticated. Generate secret, return QR URI + backup codes
- `POST /api/settings/totp/enable` — Authenticated. Verify code to confirm, then enable
- `DELETE /api/settings/totp` — Authenticated. Disable 2FA (requires password)
- `GET /api/settings/totp/status` — Authenticated. Returns `{ enabled }`

### Modified login (`POST /api/auth/login`)

After password verification, check `user_totp` table. If 2FA enabled, return `{ requires_2fa: true, ticket }` (5-min JWT with `purpose: '2fa'`). If not, return JWT as today.

### OIDC callback logic

1. Verify `state` parameter matches cookie (CSRF protection)
2. Exchange authorization code for tokens via `openid-client`
3. Extract `sub`, `preferred_username`, `email` from ID token
4. Look up `user_oidc` by `(sub, issuer)`:
   - Found: load linked Plank user
   - Not found: create user (username from `preferred_username`, role READ, null password_hash), insert `user_oidc` row
5. Issue Plank JWT, redirect to `/?token=<jwt>`

## Frontend Changes

### Login page (`Login.tsx`)

- On mount, fetch `GET /api/auth/oidc/config`
- If enabled, show SSO button below password form with "or" divider
- SSO button: `window.location.href = '/api/auth/oidc/login'`

### Token pickup (`App.tsx`)

- On mount, check URL for `?token=xxx` query parameter
- If found, `api.setToken(token)`, strip from URL with `history.replaceState`, restore session via `api.me()`

### 2FA challenge (`TotpChallenge.tsx`)

- Shown when login returns `requires_2fa: true`
- 6-digit numeric input, autofocus
- Sends ticket + code to `POST /api/auth/verify-2fa`
- Login.tsx state: `idle` → `awaiting_2fa` → `authenticated`

### Profile page (`ProfileSettings.tsx`)

- Route: `/profile`, accessible from user menu (all users)
- Shows username, role, created date (read-only)
- 2FA section: setup QR code + backup codes, verify to enable, password-confirm to disable
- SSO-only users cannot enable TOTP

### Admin OIDC settings (`/admin/settings`)

- Sub-route under admin area
- Form: Issuer URL, Client ID, Client Secret, Button Label, Enabled toggle
- Follows existing `.form-group` form pattern

### User menu (`UserMenu.tsx`)

- "Profile" item for all users
- "Settings" item for admins (navigates to `/admin/settings`)

## Security

- **OIDC CSRF**: Random `state` stored in httpOnly `SameSite=Lax` cookie (5 min TTL)
- **TOTP secrets**: AES-256-GCM encrypted at rest, key from `TOTP_ENCRYPTION_KEY` env var (falls back to `JWT_SECRET`)
- **OIDC client secret**: Same AES-256-GCM encryption, masked on read, only settable
- **2FA ticket**: 5-min JWT with `purpose: '2fa'` claim, rejected by `authenticate` middleware
- **Backup codes**: 8 codes, 8 chars alphanumeric, bcrypt-hashed, single-use, shown once
- **SSO-only users**: NULL `password_hash`, password login rejects with "Please use SSO"

## NPM Packages

- `openid-client` — OIDC discovery + authorization code flow
- `otpauth` — TOTP generation/verification
- `qrcode` — QR code data URI for authenticator setup
