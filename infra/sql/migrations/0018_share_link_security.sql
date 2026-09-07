ALTER TABLE share_links ADD COLUMN IF NOT EXISTS token_hash TEXT;
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS token_version TEXT;
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

UPDATE share_links
SET token_hash = COALESCE(token_hash, 'legacy-md5:' || md5(share_id::text)),
    token_version = COALESCE(token_version, 'legacy-md5')
WHERE token_hash IS NULL
   OR token_version IS NULL;

ALTER TABLE share_links
  ALTER COLUMN token_hash SET NOT NULL,
  ALTER COLUMN token_version SET NOT NULL,
  ALTER COLUMN token_version SET DEFAULT 'hmac-sha256-v1';

CREATE UNIQUE INDEX IF NOT EXISTS idx_share_links_token_hash
  ON share_links(token_hash);

DROP INDEX IF EXISTS idx_share_links_active;

CREATE INDEX IF NOT EXISTS idx_share_links_active
  ON share_links(share_id, token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_share_links_pack_owner_active
  ON share_links(pack_id, owner_user_id, created_at DESC)
  WHERE revoked_at IS NULL;
