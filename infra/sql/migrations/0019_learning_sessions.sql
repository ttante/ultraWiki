CREATE TABLE IF NOT EXISTS learning_sessions (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES study_packs(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  baseline_due_cards INTEGER NOT NULL CHECK (baseline_due_cards >= 0),
  baseline_mastery_score DOUBLE PRECISION NOT NULL CHECK (baseline_mastery_score >= 0 AND baseline_mastery_score <= 1),
  reviewed_count INTEGER NOT NULL DEFAULT 0 CHECK (reviewed_count >= 0),
  outcome JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_learning_sessions_user_pack_started
  ON learning_sessions(user_id, pack_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_learning_sessions_status
  ON learning_sessions(user_id, status, started_at DESC);
