-- Add archived column to boards
ALTER TABLE boards ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
