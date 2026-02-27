-- Migration: Rename roles for clarity
-- Global roles: READ -> GUEST, COLLABORATOR -> MEMBER
-- Board roles: READ -> VIEWER, COLLABORATOR -> EDITOR
--
-- NOTE: Must drop constraints BEFORE updating data, since the existing
-- constraint from migration 002 only allows the old role names.

-- Widen columns in case needed
ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(20);

-- Drop old constraint first (allows UPDATE to proceed)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- Update global user roles (idempotent)
UPDATE users SET role = 'GUEST'  WHERE role = 'READ';
UPDATE users SET role = 'MEMBER' WHERE role = 'COLLABORATOR';

-- Add new constraint after data is updated
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('GUEST', 'MEMBER', 'ADMIN'));

-- Drop old board_members constraint first
ALTER TABLE board_members DROP CONSTRAINT IF EXISTS board_members_role_check;

-- Rename board member roles (idempotent)
UPDATE board_members SET role = 'VIEWER' WHERE role = 'READ';
UPDATE board_members SET role = 'EDITOR' WHERE role = 'COLLABORATOR';

-- Add new board constraint after data is updated
ALTER TABLE board_members ADD CONSTRAINT board_members_role_check
  CHECK (role IN ('VIEWER', 'EDITOR', 'ADMIN'));
