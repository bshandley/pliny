-- 023: Add public_token column to boards for shareable read-only links
ALTER TABLE boards ADD COLUMN IF NOT EXISTS public_token UUID DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_public_token ON boards(public_token) WHERE public_token IS NOT NULL;
