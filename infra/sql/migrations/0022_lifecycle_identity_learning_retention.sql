ALTER TABLE lifecycle_maintenance_runs
  ADD COLUMN IF NOT EXISTS profile_days INT NOT NULL DEFAULT 730,
  ADD COLUMN IF NOT EXISTS share_days INT NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS learning_review_days INT NOT NULL DEFAULT 365,
  ADD COLUMN IF NOT EXISTS user_profiles_pruned INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS share_links_pruned INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flashcard_reviews_pruned INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS learning_sessions_pruned INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quiz_attempts_pruned INT NOT NULL DEFAULT 0;

DROP FUNCTION IF EXISTS run_lifecycle_retention_stats(INT, INT, INT, INT);

CREATE OR REPLACE FUNCTION run_lifecycle_retention_stats(
  p_idempotency_days INT DEFAULT 30,
  p_job_days INT DEFAULT 30,
  p_artifact_days INT DEFAULT 365,
  p_telemetry_days INT DEFAULT 180,
  p_profile_days INT DEFAULT 730,
  p_share_days INT DEFAULT 90,
  p_learning_review_days INT DEFAULT 365
)
RETURNS TABLE (
  duration_ms INT,
  idempotency_pruned INT,
  jobs_pruned INT,
  packs_pruned INT,
  stage_cost_events_pruned INT,
  user_profiles_pruned INT,
  share_links_pruned INT,
  flashcard_reviews_pruned INT,
  learning_sessions_pruned INT,
  quiz_attempts_pruned INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_started_at TIMESTAMPTZ := clock_timestamp();
  v_finished_at TIMESTAMPTZ;
BEGIN
  IF p_idempotency_days < 1 OR p_job_days < 1 OR p_artifact_days < 1 OR p_telemetry_days < 1
     OR p_profile_days < 1 OR p_share_days < 1 OR p_learning_review_days < 1 THEN
    RAISE EXCEPTION 'retention days must all be >= 1';
  END IF;

  IF p_artifact_days < p_job_days THEN
    RAISE EXCEPTION 'p_artifact_days must be >= p_job_days';
  END IF;

  IF p_profile_days < p_learning_review_days THEN
    RAISE EXCEPTION 'p_profile_days must be >= p_learning_review_days';
  END IF;

  DELETE FROM idempotency_keys
  WHERE created_at < NOW() - (p_idempotency_days || ' days')::interval;
  GET DIAGNOSTICS idempotency_pruned = ROW_COUNT;

  DELETE FROM generation_jobs
  WHERE status IN ('failed', 'quarantined')
    AND updated_at < NOW() - (p_job_days || ' days')::interval;
  GET DIAGNOSTICS jobs_pruned = ROW_COUNT;

  DELETE FROM stage_cost_events
  WHERE recorded_at < NOW() - (p_telemetry_days || ' days')::interval;
  GET DIAGNOSTICS stage_cost_events_pruned = ROW_COUNT;

  DELETE FROM share_links
  WHERE (revoked_at IS NOT NULL AND revoked_at < NOW() - (p_share_days || ' days')::interval)
     OR (expires_at IS NOT NULL AND expires_at < NOW() - (p_share_days || ' days')::interval);
  GET DIAGNOSTICS share_links_pruned = ROW_COUNT;

  DELETE FROM flashcard_reviews
  WHERE reviewed_at < NOW() - (p_learning_review_days || ' days')::interval;
  GET DIAGNOSTICS flashcard_reviews_pruned = ROW_COUNT;

  DELETE FROM learning_sessions
  WHERE COALESCE(completed_at, started_at) < NOW() - (p_learning_review_days || ' days')::interval;
  GET DIAGNOSTICS learning_sessions_pruned = ROW_COUNT;

  DELETE FROM quiz_attempts
  WHERE submitted_at < NOW() - (p_learning_review_days || ' days')::interval;
  GET DIAGNOSTICS quiz_attempts_pruned = ROW_COUNT;

  DELETE FROM user_profiles up
  WHERE up.updated_at < NOW() - (p_profile_days || ' days')::interval
    AND NOT EXISTS (SELECT 1 FROM saved_packs sp WHERE sp.user_id = up.user_id)
    AND NOT EXISTS (SELECT 1 FROM share_links sl WHERE sl.owner_user_id = up.user_id)
    AND NOT EXISTS (SELECT 1 FROM flashcard_reviews fr WHERE fr.user_id = up.user_id)
    AND NOT EXISTS (SELECT 1 FROM learning_sessions ls WHERE ls.user_id = up.user_id)
    AND NOT EXISTS (SELECT 1 FROM quiz_attempts qa WHERE qa.user_id = up.user_id)
    AND NOT EXISTS (SELECT 1 FROM study_goals sg WHERE sg.user_id = up.user_id);
  GET DIAGNOSTICS user_profiles_pruned = ROW_COUNT;

  DELETE FROM study_packs sp
  WHERE sp.created_at < NOW() - (p_artifact_days || ' days')::interval
    AND NOT EXISTS (
      SELECT 1
      FROM generation_jobs gj
      WHERE gj.pack_id = sp.id
        AND gj.status IN ('queued', 'running')
    );
  GET DIAGNOSTICS packs_pruned = ROW_COUNT;

  v_finished_at := clock_timestamp();
  duration_ms := FLOOR(EXTRACT(EPOCH FROM (v_finished_at - v_started_at)) * 1000)::int;

  INSERT INTO lifecycle_maintenance_runs (
    started_at,
    finished_at,
    duration_ms,
    idempotency_days,
    job_days,
    artifact_days,
    telemetry_days,
    profile_days,
    share_days,
    learning_review_days,
    idempotency_pruned,
    jobs_pruned,
    packs_pruned,
    stage_cost_events_pruned,
    user_profiles_pruned,
    share_links_pruned,
    flashcard_reviews_pruned,
    learning_sessions_pruned,
    quiz_attempts_pruned,
    status
  ) VALUES (
    v_started_at,
    v_finished_at,
    duration_ms,
    p_idempotency_days,
    p_job_days,
    p_artifact_days,
    p_telemetry_days,
    p_profile_days,
    p_share_days,
    p_learning_review_days,
    idempotency_pruned,
    jobs_pruned,
    packs_pruned,
    stage_cost_events_pruned,
    user_profiles_pruned,
    share_links_pruned,
    flashcard_reviews_pruned,
    learning_sessions_pruned,
    quiz_attempts_pruned,
    'completed'
  );

  RETURN NEXT;
EXCEPTION
  WHEN OTHERS THEN
    v_finished_at := clock_timestamp();
    duration_ms := FLOOR(EXTRACT(EPOCH FROM (v_finished_at - v_started_at)) * 1000)::int;
    idempotency_pruned := COALESCE(idempotency_pruned, 0);
    jobs_pruned := COALESCE(jobs_pruned, 0);
    packs_pruned := COALESCE(packs_pruned, 0);
    stage_cost_events_pruned := COALESCE(stage_cost_events_pruned, 0);
    user_profiles_pruned := COALESCE(user_profiles_pruned, 0);
    share_links_pruned := COALESCE(share_links_pruned, 0);
    flashcard_reviews_pruned := COALESCE(flashcard_reviews_pruned, 0);
    learning_sessions_pruned := COALESCE(learning_sessions_pruned, 0);
    quiz_attempts_pruned := COALESCE(quiz_attempts_pruned, 0);

    INSERT INTO lifecycle_maintenance_runs (
      started_at,
      finished_at,
      duration_ms,
      idempotency_days,
      job_days,
      artifact_days,
      telemetry_days,
      profile_days,
      share_days,
      learning_review_days,
      idempotency_pruned,
      jobs_pruned,
      packs_pruned,
      stage_cost_events_pruned,
      user_profiles_pruned,
      share_links_pruned,
      flashcard_reviews_pruned,
      learning_sessions_pruned,
      quiz_attempts_pruned,
      status,
      error_text
    ) VALUES (
      v_started_at,
      v_finished_at,
      duration_ms,
      p_idempotency_days,
      p_job_days,
      p_artifact_days,
      p_telemetry_days,
      p_profile_days,
      p_share_days,
      p_learning_review_days,
      idempotency_pruned,
      jobs_pruned,
      packs_pruned,
      stage_cost_events_pruned,
      user_profiles_pruned,
      share_links_pruned,
      flashcard_reviews_pruned,
      learning_sessions_pruned,
      quiz_attempts_pruned,
      'failed',
      SQLERRM
    );

    RAISE;
END;
$$;
