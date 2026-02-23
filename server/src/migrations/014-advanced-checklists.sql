-- Migration 014: Advanced checklists — add assignee, due date, priority to checklist items

ALTER TABLE card_checklist_items ADD COLUMN IF NOT EXISTS assignee_name VARCHAR(100) NULL;
ALTER TABLE card_checklist_items ADD COLUMN IF NOT EXISTS due_date DATE NULL;
ALTER TABLE card_checklist_items ADD COLUMN IF NOT EXISTS priority VARCHAR(10) NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_checklist_priority'
  ) THEN
    ALTER TABLE card_checklist_items ADD CONSTRAINT chk_checklist_priority
      CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high'));
  END IF;
END
$$;
