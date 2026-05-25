CREATE TABLE IF NOT EXISTS glossary_artifacts (
  id BIGSERIAL PRIMARY KEY,
  pack_id UUID NOT NULL REFERENCES study_packs(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  definition TEXT NOT NULL,
  citation TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pack_id, term)
);

ALTER TABLE artifact_cache DROP CONSTRAINT IF EXISTS artifact_cache_kind_check;
ALTER TABLE artifact_cache
  ADD CONSTRAINT artifact_cache_kind_check
  CHECK (kind IN ('summaries', 'active_recall', 'knowledge_structure', 'glossary'));

ALTER TABLE pack_cache_events DROP CONSTRAINT IF EXISTS pack_cache_events_stage_check;
ALTER TABLE pack_cache_events
  ADD CONSTRAINT pack_cache_events_stage_check
  CHECK (stage IN ('source', 'summaries', 'active_recall', 'knowledge_structure', 'glossary'));

ALTER TABLE stage_cost_events DROP CONSTRAINT IF EXISTS stage_cost_events_stage_check;
ALTER TABLE stage_cost_events
  ADD CONSTRAINT stage_cost_events_stage_check
  CHECK (stage IN ('ingestion', 'summarization', 'active_recall', 'knowledge_structure', 'glossary'));
