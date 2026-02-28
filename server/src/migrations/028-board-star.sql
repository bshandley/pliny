-- Add star/favorite support to board members
ALTER TABLE board_members ADD COLUMN IF NOT EXISTS is_starred BOOLEAN NOT NULL DEFAULT false;
