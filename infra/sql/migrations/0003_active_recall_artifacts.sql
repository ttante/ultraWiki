CREATE TABLE IF NOT EXISTS flashcard_artifacts (
  id BIGSERIAL PRIMARY KEY,
  pack_id UUID NOT NULL REFERENCES study_packs(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  citation TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quiz_artifacts (
  id BIGSERIAL PRIMARY KEY,
  pack_id UUID NOT NULL REFERENCES study_packs(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  correct_index INT NOT NULL,
  explanation TEXT NOT NULL,
  citation TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
