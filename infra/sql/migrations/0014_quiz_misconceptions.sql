ALTER TABLE quiz_artifacts
ADD COLUMN IF NOT EXISTS misconceptions JSONB NOT NULL DEFAULT '[]'::jsonb;
