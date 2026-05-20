CREATE TABLE IF NOT EXISTS quiz_attempts (
  id UUID PRIMARY KEY,
  pack_id UUID NOT NULL REFERENCES study_packs(id) ON DELETE CASCADE,
  total_questions INT NOT NULL,
  correct_answers INT NOT NULL,
  accuracy DOUBLE PRECISION NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_pack_id ON quiz_attempts(pack_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_submitted_at ON quiz_attempts(submitted_at);

CREATE TABLE IF NOT EXISTS generation_outcomes (
  job_id UUID PRIMARY KEY REFERENCES generation_jobs(id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES study_packs(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  duration_ms INT,
  citation_rate DOUBLE PRECISION,
  flashcards_count INT,
  quiz_questions_count INT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generation_outcomes_status ON generation_outcomes(status);
CREATE INDEX IF NOT EXISTS idx_generation_outcomes_recorded_at ON generation_outcomes(recorded_at);
