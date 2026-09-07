CREATE TABLE IF NOT EXISTS generation_feedback (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES study_packs(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('overall', 'summaries', 'flashcards', 'quiz', 'glossary', 'concept_graph')),
  artifact_id TEXT,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  signal TEXT NOT NULL CHECK (signal IN ('helpful', 'unclear', 'incorrect', 'missing_citation', 'too_shallow', 'unsafe', 'other')),
  comment TEXT,
  prompt_version TEXT,
  model TEXT,
  trusted_artifact BOOLEAN NOT NULL DEFAULT FALSE CHECK (trusted_artifact = FALSE),
  eval_candidate BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generation_feedback_pack_created
  ON generation_feedback(pack_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generation_feedback_user_created
  ON generation_feedback(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generation_feedback_artifact_signal
  ON generation_feedback(artifact_type, signal, created_at DESC);
