CREATE TABLE IF NOT EXISTS card_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  target_card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('blocks', 'relates_to')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_card_id, target_card_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_card_relations_source ON card_relations(source_card_id);
CREATE INDEX IF NOT EXISTS idx_card_relations_target ON card_relations(target_card_id);
