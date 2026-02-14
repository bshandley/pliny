-- Add profile fields populated from OIDC provider
DO $$
BEGIN
  ALTER TABLE users ADD COLUMN email VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE users ADD COLUMN display_name VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
