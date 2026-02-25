-- 1. Rename old card_assignees
ALTER TABLE card_assignees RENAME TO card_assignees_old;

-- 2. Create new card_assignees
CREATE TABLE card_assignees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT card_assignees_must_have_identity CHECK (user_id IS NOT NULL OR display_name IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_card_assignees_linked ON card_assignees (card_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_card_assignees_unlinked ON card_assignees (card_id, display_name) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_card_assignees_card_id ON card_assignees (card_id);
CREATE INDEX IF NOT EXISTS idx_card_assignees_user_id ON card_assignees (user_id) WHERE user_id IS NOT NULL;

-- 3. Migrate card_members → linked assignees
INSERT INTO card_assignees (card_id, user_id, created_at)
SELECT cm.card_id, cm.user_id, cm.created_at
FROM card_members cm
ON CONFLICT DO NOTHING;

-- 4. Migrate card_assignees_old → auto-link where possible, else unlinked
-- 4a. Auto-link: assignee_name matches a user's username, and no linked row exists yet
INSERT INTO card_assignees (card_id, user_id, created_at)
SELECT cao.card_id, u.id, cao.added_at
FROM card_assignees_old cao
JOIN users u ON LOWER(u.username) = LOWER(cao.assignee_name)
ON CONFLICT DO NOTHING;

-- 4b. Unlinked: remaining assignees that weren't auto-linked
INSERT INTO card_assignees (card_id, display_name, created_at)
SELECT cao.card_id, cao.assignee_name, cao.added_at
FROM card_assignees_old cao
WHERE NOT EXISTS (
  SELECT 1 FROM card_assignees ca
  WHERE ca.card_id = cao.card_id
  AND (
    (ca.user_id IS NOT NULL AND ca.user_id IN (
      SELECT u.id FROM users u WHERE LOWER(u.username) = LOWER(cao.assignee_name)
    ))
    OR
    (ca.display_name = cao.assignee_name)
  )
)
ON CONFLICT DO NOTHING;

-- 5. Add assignee_user_id to checklist items
ALTER TABLE card_checklist_items ADD COLUMN IF NOT EXISTS assignee_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- 5a. Auto-link existing checklist assignee_names to users
UPDATE card_checklist_items ci
SET assignee_user_id = u.id
FROM users u
WHERE LOWER(ci.assignee_name) = LOWER(u.username)
AND ci.assignee_name IS NOT NULL
AND ci.assignee_user_id IS NULL;

-- 6. Drop old tables
DROP TABLE IF EXISTS card_assignees_old;
DROP TABLE IF EXISTS card_members;
DROP TABLE IF EXISTS board_assignees;
