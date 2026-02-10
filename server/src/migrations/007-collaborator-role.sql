-- Migration: Add COLLABORATOR role
-- Idempotent: safe to re-run

-- Widen role column to fit COLLABORATOR (12 chars, was VARCHAR(10))
ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(20);

DO $$
BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('READ', 'COLLABORATOR', 'ADMIN'));
END $$;
