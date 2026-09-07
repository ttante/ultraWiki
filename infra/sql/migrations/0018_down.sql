DROP INDEX IF EXISTS idx_share_links_pack_owner_active;
DROP INDEX IF EXISTS idx_share_links_active;
DROP INDEX IF EXISTS idx_share_links_token_hash;

CREATE INDEX IF NOT EXISTS idx_share_links_active
  ON share_links(share_id)
  WHERE expires_at IS NULL;

ALTER TABLE share_links
  DROP COLUMN IF EXISTS revoked_at,
  DROP COLUMN IF EXISTS token_version,
  DROP COLUMN IF EXISTS token_hash;
