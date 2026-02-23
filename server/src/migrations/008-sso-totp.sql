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
DO $$
BEGIN
  ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;
