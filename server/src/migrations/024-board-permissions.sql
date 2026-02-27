-- Add role column to board_members
ALTER TABLE board_members
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'EDITOR'
  CHECK (role IN ('ADMIN', 'COLLABORATOR', 'READ', 'EDITOR', 'VIEWER'));

-- Ensure board creators are in board_members with ADMIN role
INSERT INTO board_members (board_id, user_id, role)
SELECT b.id, b.created_by, 'ADMIN'
FROM boards b
WHERE b.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM board_members bm
    WHERE bm.board_id = b.id AND bm.user_id = b.created_by
  );

-- Promote existing creator rows to ADMIN
UPDATE board_members bm
SET role = 'ADMIN'
FROM boards b
WHERE bm.board_id = b.id
  AND bm.user_id = b.created_by;
