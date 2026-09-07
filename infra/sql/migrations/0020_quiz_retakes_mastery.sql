ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS attempt_number INT NOT NULL DEFAULT 1;
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS selected_indices JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS previous_accuracy DOUBLE PRECISION;
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS accuracy_delta DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS card_mastery_score DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS mastery_score DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS mastery_delta DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE quiz_attempts
SET user_id = COALESCE(user_id, 'legacy-anonymous')
WHERE user_id IS NULL;

WITH sequenced AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, pack_id
      ORDER BY submitted_at ASC, id ASC
    ) AS attempt_number,
    LAG(accuracy) OVER (
      PARTITION BY user_id, pack_id
      ORDER BY submitted_at ASC, id ASC
    ) AS previous_accuracy
  FROM quiz_attempts
)
UPDATE quiz_attempts
SET attempt_number = sequenced.attempt_number,
    previous_accuracy = sequenced.previous_accuracy,
    accuracy_delta = CASE
      WHEN sequenced.previous_accuracy IS NULL THEN 0
      ELSE quiz_attempts.accuracy - sequenced.previous_accuracy
    END,
    mastery_score = quiz_attempts.accuracy,
    mastery_delta = CASE
      WHEN sequenced.previous_accuracy IS NULL THEN 0
      ELSE quiz_attempts.accuracy - sequenced.previous_accuracy
    END
FROM sequenced
WHERE quiz_attempts.id = sequenced.id;

ALTER TABLE quiz_attempts
  ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_pack_attempt
  ON quiz_attempts(user_id, pack_id, attempt_number DESC);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_mastery
  ON quiz_attempts(pack_id, mastery_score, submitted_at DESC);
