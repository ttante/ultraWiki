CREATE TABLE IF NOT EXISTS outcomes_maintenance_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  duration_ms INT NOT NULL,
  raw_days INT NOT NULL,
  rollup_days INT NOT NULL,
  outcomes_pruned INT NOT NULL DEFAULT 0,
  quiz_attempts_pruned INT NOT NULL DEFAULT 0,
  rollups_refreshed INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_outcomes_maintenance_runs_finished_at ON outcomes_maintenance_runs(finished_at);
CREATE INDEX IF NOT EXISTS idx_outcomes_maintenance_runs_status ON outcomes_maintenance_runs(status);

CREATE OR REPLACE FUNCTION run_outcomes_maintenance_stats(
  p_raw_days INT DEFAULT 90,
  p_rollup_days INT DEFAULT 730
)
RETURNS TABLE (
  duration_ms INT,
  outcomes_pruned INT,
  quiz_attempts_pruned INT,
  rollups_refreshed INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_started_at TIMESTAMPTZ := clock_timestamp();
  v_finished_at TIMESTAMPTZ;
  v_rollup_from DATE := CURRENT_DATE - 7;
  v_rollup_to DATE := CURRENT_DATE;
BEGIN
  IF p_raw_days < 1 THEN
    RAISE EXCEPTION 'p_raw_days must be >= 1';
  END IF;

  IF p_rollup_days < p_raw_days THEN
    RAISE EXCEPTION 'p_rollup_days must be >= p_raw_days';
  END IF;

  PERFORM refresh_outcomes_daily_rollups(v_rollup_from, v_rollup_to);
  rollups_refreshed := (v_rollup_to - v_rollup_from) + 1;

  DELETE FROM generation_outcomes
  WHERE recorded_at < NOW() - (p_raw_days || ' days')::interval;
  GET DIAGNOSTICS outcomes_pruned = ROW_COUNT;

  DELETE FROM quiz_attempts
  WHERE submitted_at < NOW() - (p_raw_days || ' days')::interval;
  GET DIAGNOSTICS quiz_attempts_pruned = ROW_COUNT;

  DELETE FROM outcomes_daily_rollups
  WHERE day < CURRENT_DATE - p_rollup_days;

  v_finished_at := clock_timestamp();
  duration_ms := FLOOR(EXTRACT(EPOCH FROM (v_finished_at - v_started_at)) * 1000)::int;

  INSERT INTO outcomes_maintenance_runs (
    started_at,
    finished_at,
    duration_ms,
    raw_days,
    rollup_days,
    outcomes_pruned,
    quiz_attempts_pruned,
    rollups_refreshed,
    status
  ) VALUES (
    v_started_at,
    v_finished_at,
    duration_ms,
    p_raw_days,
    p_rollup_days,
    outcomes_pruned,
    quiz_attempts_pruned,
    rollups_refreshed,
    'completed'
  );

  RETURN NEXT;
EXCEPTION
  WHEN OTHERS THEN
    v_finished_at := clock_timestamp();
    duration_ms := FLOOR(EXTRACT(EPOCH FROM (v_finished_at - v_started_at)) * 1000)::int;
    outcomes_pruned := COALESCE(outcomes_pruned, 0);
    quiz_attempts_pruned := COALESCE(quiz_attempts_pruned, 0);
    rollups_refreshed := COALESCE(rollups_refreshed, 0);

    INSERT INTO outcomes_maintenance_runs (
      started_at,
      finished_at,
      duration_ms,
      raw_days,
      rollup_days,
      outcomes_pruned,
      quiz_attempts_pruned,
      rollups_refreshed,
      status,
      error_text
    ) VALUES (
      v_started_at,
      v_finished_at,
      duration_ms,
      p_raw_days,
      p_rollup_days,
      outcomes_pruned,
      quiz_attempts_pruned,
      rollups_refreshed,
      'failed',
      SQLERRM
    );
    RAISE;
END;
$$;
