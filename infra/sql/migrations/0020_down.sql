DROP INDEX IF EXISTS idx_quiz_attempts_mastery;
DROP INDEX IF EXISTS idx_quiz_attempts_user_pack_attempt;

ALTER TABLE quiz_attempts
  DROP COLUMN IF EXISTS mastery_delta,
  DROP COLUMN IF EXISTS mastery_score,
  DROP COLUMN IF EXISTS card_mastery_score,
  DROP COLUMN IF EXISTS accuracy_delta,
  DROP COLUMN IF EXISTS previous_accuracy,
  DROP COLUMN IF EXISTS selected_indices,
  DROP COLUMN IF EXISTS attempt_number,
  DROP COLUMN IF EXISTS user_id;
