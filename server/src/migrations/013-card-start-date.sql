-- Migration 013: Add start_date to cards for timeline view
ALTER TABLE cards ADD COLUMN IF NOT EXISTS start_date DATE NULL;
