DROP INDEX IF EXISTS idx_saved_packs_tags_gin;
DROP INDEX IF EXISTS idx_saved_packs_user_collection;

ALTER TABLE saved_packs
  DROP COLUMN IF EXISTS collection,
  DROP COLUMN IF EXISTS tags;
