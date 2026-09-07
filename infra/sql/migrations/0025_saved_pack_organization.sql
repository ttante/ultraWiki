ALTER TABLE saved_packs
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS collection TEXT;

CREATE INDEX IF NOT EXISTS idx_saved_packs_user_collection
  ON saved_packs(user_id, collection)
  WHERE collection IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_saved_packs_tags_gin
  ON saved_packs USING GIN (tags);
