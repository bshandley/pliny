-- Migration: Rename roles for clarity
-- Global roles: READ -> GUEST, COLLABORATOR -> MEMBER
-- Board roles: READ -> VIEWER, COLLABORATOR -> EDITOR

-- Widen column first in case needed
ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(20);

-- Update global user roles (idempotent)
UPDATE users SET role = 'GUEST'  WHERE role = 'READ';
UPDATE users SET role = 'MEMBER' WHERE role = 'COLLABORATOR';

-- Drop and recreate constraint with new values
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('GUEST', 'MEMBER', 'ADMIN'));

-- Rename board member roles (idempotent)
UPDATE board_members SET role = 'VIEWER' WHERE role = 'READ';
UPDATE board_members SET role = 'EDITOR' WHERE role = 'COLLABORATOR';

-- Drop and recreate board_members role constraint
ALTER TABLE board_members DROP CONSTRAINT IF EXISTS board_members_role_check;
ALTER TABLE board_members ADD CONSTRAINT board_members_role_check
  CHECK (role IN ('VIEWER', 'EDITOR', 'ADMIN'));
