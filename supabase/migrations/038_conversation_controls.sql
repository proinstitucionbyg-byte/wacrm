ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS automation_enabled boolean NOT NULL DEFAULT true;