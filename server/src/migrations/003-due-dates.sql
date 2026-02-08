-- Add optional due_date column to cards
ALTER TABLE cards ADD COLUMN IF NOT EXISTS due_date DATE;
