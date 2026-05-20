CREATE TABLE IF NOT EXISTS stage_cost_events (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES study_packs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('ingestion', 'summarization', 'active_recall', 'knowledge_structure')),
  estimated_tokens INT NOT NULL CHECK (estimated_tokens >= 0),
  latency_ms INT NOT NULL CHECK (latency_ms >= 0),
  estimated_cost_usd NUMERIC(12, 6) NOT NULL CHECK (estimated_cost_usd >= 0),
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stage_cost_events_pack_id ON stage_cost_events(pack_id);
CREATE INDEX IF NOT EXISTS idx_stage_cost_events_stage_recorded_at ON stage_cost_events(stage, recorded_at DESC);
