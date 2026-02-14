-- Add configurable OIDC claim mapping fields
DO $$
BEGIN
  ALTER TABLE oidc_config ADD COLUMN claim_email VARCHAR(100) DEFAULT 'email';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE oidc_config ADD COLUMN claim_name VARCHAR(100) DEFAULT 'name';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE oidc_config ADD COLUMN claim_avatar VARCHAR(100) DEFAULT 'picture';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
