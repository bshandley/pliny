-- Add configurable callback base URL for OIDC
DO $$
BEGIN
  ALTER TABLE oidc_config ADD COLUMN callback_base_url VARCHAR(500);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
