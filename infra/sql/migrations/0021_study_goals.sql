CREATE TABLE IF NOT EXISTS study_goals (
  user_id TEXT PRIMARY KEY,
  daily_target_reviews INT NOT NULL DEFAULT 0 CHECK (daily_target_reviews >= 0 AND daily_target_reviews <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_study_goals_updated
  ON study_goals(updated_at DESC);
