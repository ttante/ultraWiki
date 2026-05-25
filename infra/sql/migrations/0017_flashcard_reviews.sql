CREATE TABLE IF NOT EXISTS flashcard_reviews (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES study_packs(id) ON DELETE CASCADE,
  card_index INTEGER NOT NULL CHECK (card_index >= 0),
  rating TEXT NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_due_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flashcard_reviews_user_pack_card
  ON flashcard_reviews(user_id, pack_id, card_index, reviewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_flashcard_reviews_due
  ON flashcard_reviews(user_id, next_due_at);
