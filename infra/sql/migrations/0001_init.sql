CREATE TABLE IF NOT EXISTS study_packs (
  id UUID PRIMARY KEY,
  input TEXT NOT NULL,
  source_revision_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_sections (
  id BIGSERIAL PRIMARY KEY,
  pack_id UUID NOT NULL REFERENCES study_packs(id) ON DELETE CASCADE,
  heading TEXT NOT NULL,
  content TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  pack_id UUID NOT NULL,
  job_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id UUID PRIMARY KEY,
  pack_id UUID NOT NULL REFERENCES study_packs(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INT NOT NULL,
  attempt INT NOT NULL,
  retry_state TEXT NOT NULL,
  degradation_state TEXT NOT NULL,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON generation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_heartbeat ON generation_jobs(heartbeat_at);
