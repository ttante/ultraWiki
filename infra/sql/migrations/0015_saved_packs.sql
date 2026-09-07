CREATE TABLE IF NOT EXISTS saved_packs (
  user_id TEXT NOT NULL,
  pack_id UUID NOT NULL REFERENCES study_packs(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  collection TEXT,
  PRIMARY KEY (user_id, pack_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_packs_user_saved_at
  ON saved_packs(user_id, saved_at DESC);
