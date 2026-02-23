-- Migration 017: GIN indexes for global search
-- Idempotent: safe to re-run

CREATE INDEX IF NOT EXISTS idx_cards_search
  ON cards USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'')));

CREATE INDEX IF NOT EXISTS idx_comments_search
  ON card_comments USING GIN (to_tsvector('english', text));

CREATE INDEX IF NOT EXISTS idx_checklist_search
  ON card_checklist_items USING GIN (to_tsvector('english', text));
