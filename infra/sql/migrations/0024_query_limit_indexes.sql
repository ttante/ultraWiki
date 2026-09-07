CREATE INDEX IF NOT EXISTS idx_generation_jobs_session_updated
  ON generation_jobs(session_id, updated_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generation_jobs_pack_updated
  ON generation_jobs(pack_id, updated_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_share_links_owner_pack_active
  ON share_links(owner_user_id, pack_id, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_flashcard_reviews_user_reviewed
  ON flashcard_reviews(user_id, reviewed_at DESC, card_index ASC);

CREATE INDEX IF NOT EXISTS idx_learning_sessions_user_activity
  ON learning_sessions(user_id, (COALESCE(completed_at, started_at)) DESC);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_submitted
  ON quiz_attempts(user_id, submitted_at DESC, attempt_number DESC);

CREATE INDEX IF NOT EXISTS idx_generation_outcomes_recorded_status
  ON generation_outcomes(recorded_at DESC, status);

CREATE INDEX IF NOT EXISTS idx_stage_cost_events_recorded_filters
  ON stage_cost_events(recorded_at DESC, pack_id, prompt_version, model, stage);
