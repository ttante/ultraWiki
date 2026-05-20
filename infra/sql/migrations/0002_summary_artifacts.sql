CREATE TABLE IF NOT EXISTS summary_artifacts (
  id BIGSERIAL PRIMARY KEY,
  pack_id UUID NOT NULL REFERENCES study_packs(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  text TEXT NOT NULL,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pack_id, level)
);
