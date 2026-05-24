CREATE TABLE IF NOT EXISTS source_links (
  id BIGSERIAL PRIMARY KEY,
  pack_id UUID NOT NULL REFERENCES study_packs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  source_heading TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pack_id, title, source_heading)
);

CREATE INDEX IF NOT EXISTS idx_source_links_pack_id ON source_links(pack_id);
