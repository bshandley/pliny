-- Subtasks: Add parent_id to cards (1-level deep only)
ALTER TABLE cards ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES cards(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cards_parent_id ON cards(parent_id);
