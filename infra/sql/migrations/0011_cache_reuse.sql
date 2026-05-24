CREATE TABLE IF NOT EXISTS source_cache (
  cache_key TEXT PRIMARY KEY,
  source_title TEXT NOT NULL,
  source_revision_id TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  language TEXT NOT NULL,
  sections JSONB NOT NULL,
  outgoing_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_cache_revision ON source_cache(source_revision_id);
CREATE INDEX IF NOT EXISTS idx_source_cache_expires_at ON source_cache(expires_at);

CREATE TABLE IF NOT EXISTS artifact_cache (
  cache_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('summaries', 'active_recall', 'knowledge_structure')),
  source_revision_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  taxonomy_version TEXT NOT NULL,
  payload JSONB NOT NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (kind, source_revision_id, prompt_version, taxonomy_version)
);

CREATE INDEX IF NOT EXISTS idx_artifact_cache_lookup
  ON artifact_cache(kind, source_revision_id, prompt_version, taxonomy_version);
CREATE INDEX IF NOT EXISTS idx_artifact_cache_expires_at ON artifact_cache(expires_at);

CREATE TABLE IF NOT EXISTS pack_cache_events (
  id BIGSERIAL PRIMARY KEY,
  pack_id UUID NOT NULL REFERENCES study_packs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('source', 'summaries', 'active_recall', 'knowledge_structure')),
  cache_key TEXT NOT NULL,
  hit BOOLEAN NOT NULL,
  source_revision_id TEXT NOT NULL,
  parser_version TEXT,
  prompt_version TEXT,
  taxonomy_version TEXT,
  cached_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pack_cache_events_pack_id ON pack_cache_events(pack_id, id ASC);
CREATE INDEX IF NOT EXISTS idx_pack_cache_events_stage_recorded_at ON pack_cache_events(stage, recorded_at DESC);
