ALTER TABLE stage_cost_events DROP CONSTRAINT IF EXISTS stage_cost_events_stage_check;
ALTER TABLE stage_cost_events
  ADD CONSTRAINT stage_cost_events_stage_check
  CHECK (stage IN ('ingestion', 'summarization', 'active_recall', 'knowledge_structure'));

ALTER TABLE pack_cache_events DROP CONSTRAINT IF EXISTS pack_cache_events_stage_check;
ALTER TABLE pack_cache_events
  ADD CONSTRAINT pack_cache_events_stage_check
  CHECK (stage IN ('source', 'summaries', 'active_recall', 'knowledge_structure'));

ALTER TABLE artifact_cache DROP CONSTRAINT IF EXISTS artifact_cache_kind_check;
ALTER TABLE artifact_cache
  ADD CONSTRAINT artifact_cache_kind_check
  CHECK (kind IN ('summaries', 'active_recall', 'knowledge_structure'));

DROP TABLE IF EXISTS glossary_artifacts;
