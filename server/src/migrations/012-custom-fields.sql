-- Migration 012: Custom Fields

CREATE TABLE IF NOT EXISTS board_custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  field_type VARCHAR(20) NOT NULL,
  options JSONB,
  position INTEGER NOT NULL DEFAULT 0,
  show_on_card BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_field_type CHECK (field_type IN ('text', 'number', 'date', 'dropdown', 'checkbox'))
);

CREATE TABLE IF NOT EXISTS card_custom_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES board_custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_card_field UNIQUE (card_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_fields_board ON board_custom_fields(board_id);
CREATE INDEX IF NOT EXISTS idx_custom_field_values_card ON card_custom_field_values(card_id);
CREATE INDEX IF NOT EXISTS idx_custom_field_values_field ON card_custom_field_values(field_id);
