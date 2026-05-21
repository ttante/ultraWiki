CREATE TABLE IF NOT EXISTS lifecycle_maintenance_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  duration_ms INT NOT NULL,
  idempotency_days INT NOT NULL,
  job_days INT NOT NULL,
  artifact_days INT NOT NULL,
  telemetry_days INT NOT NULL,
  idempotency_pruned INT NOT NULL DEFAULT 0,
  jobs_pruned INT NOT NULL DEFAULT 0,
  packs_pruned INT NOT NULL DEFAULT 0,
  stage_cost_events_pruned INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_maintenance_runs_finished_at ON lifecycle_maintenance_runs(finished_at);
CREATE INDEX IF NOT EXISTS idx_lifecycle_maintenance_runs_status ON lifecycle_maintenance_runs(status);

CREATE OR REPLACE FUNCTION run_lifecycle_retention_stats(
  p_idempotency_days INT DEFAULT 30,
  p_job_days INT DEFAULT 30,
  p_artifact_days INT DEFAULT 365,
  p_telemetry_days INT DEFAULT 180
)
RETURNS TABLE (
  duration_ms INT,
  idempotency_pruned INT,
  jobs_pruned INT,
  packs_pruned INT,
  stage_cost_events_pruned INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_started_at TIMESTAMPTZ := clock_timestamp();
  v_finished_at TIMESTAMPTZ;
BEGIN
  IF p_idempotency_days < 1 OR p_job_days < 1 OR p_artifact_days < 1 OR p_telemetry_days < 1 THEN
    RAISE EXCEPTION 'retention days must all be >= 1';
  END IF;

  IF p_artifact_days < p_job_days THEN
    RAISE EXCEPTION 'p_artifact_days must be >= p_job_days';
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
    idempotency_pruned,
    jobs_pruned,
    packs_pruned,
    stage_cost_events_pruned,
    status
  ) VALUES (
    v_started_at,
    v_finished_at,
    duration_ms,
    p_idempotency_days,
    p_job_days,
    p_artifact_days,
    p_telemetry_days,
    idempotency_pruned,
    jobs_pruned,
    packs_pruned,
    stage_cost_events_pruned,
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

    INSERT INTO lifecycle_maintenance_runs (
      started_at,
      finished_at,
      duration_ms,
      idempotency_days,
      job_days,
      artifact_days,
      telemetry_days,
      idempotency_pruned,
      jobs_pruned,
      packs_pruned,
      stage_cost_events_pruned,
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
      idempotency_pruned,
      jobs_pruned,
      packs_pruned,
      stage_cost_events_pruned,
      'failed',
      SQLERRM
    );

    RAISE;
END;
$$;
