CREATE TABLE IF NOT EXISTS outcomes_daily_rollups (
  day DATE PRIMARY KEY,
  completed_jobs INT NOT NULL,
  failed_jobs INT NOT NULL,
  avg_duration_ms DOUBLE PRECISION NOT NULL,
  avg_citation_rate DOUBLE PRECISION NOT NULL,
  avg_flashcards DOUBLE PRECISION NOT NULL,
  avg_quiz_questions DOUBLE PRECISION NOT NULL,
  quiz_attempts INT NOT NULL,
  avg_quiz_accuracy DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION refresh_outcomes_daily_rollups(p_from DATE, p_to DATE)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RETURN;
  END IF;

  DELETE FROM outcomes_daily_rollups
  WHERE day BETWEEN p_from AND p_to;

  INSERT INTO outcomes_daily_rollups (
    day,
    completed_jobs,
    failed_jobs,
    avg_duration_ms,
    avg_citation_rate,
    avg_flashcards,
    avg_quiz_questions,
    quiz_attempts,
    avg_quiz_accuracy,
    updated_at
  )
  SELECT
    d.day,
    COALESCE(go.completed_jobs, 0),
    COALESCE(go.failed_jobs, 0),
    COALESCE(go.avg_duration_ms, 0),
    COALESCE(go.avg_citation_rate, 0),
    COALESCE(go.avg_flashcards, 0),
    COALESCE(go.avg_quiz_questions, 0),
    COALESCE(qa.quiz_attempts, 0),
    COALESCE(qa.avg_quiz_accuracy, 0),
    NOW()
  FROM generate_series(p_from, p_to, '1 day'::interval) AS d(day)
  LEFT JOIN (
    SELECT
      DATE(recorded_at) AS day,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_jobs,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_jobs,
      COALESCE(AVG(duration_ms) FILTER (WHERE status = 'completed'), 0)::float8 AS avg_duration_ms,
      COALESCE(AVG(citation_rate) FILTER (WHERE status = 'completed'), 0)::float8 AS avg_citation_rate,
      COALESCE(AVG(flashcards_count) FILTER (WHERE status = 'completed'), 0)::float8 AS avg_flashcards,
      COALESCE(AVG(quiz_questions_count) FILTER (WHERE status = 'completed'), 0)::float8 AS avg_quiz_questions
    FROM generation_outcomes
    WHERE DATE(recorded_at) BETWEEN p_from AND p_to
    GROUP BY DATE(recorded_at)
  ) go ON go.day = d.day
  LEFT JOIN (
    SELECT
      DATE(submitted_at) AS day,
      COUNT(*)::int AS quiz_attempts,
      COALESCE(AVG(accuracy), 0)::float8 AS avg_quiz_accuracy
    FROM quiz_attempts
    WHERE DATE(submitted_at) BETWEEN p_from AND p_to
    GROUP BY DATE(submitted_at)
  ) qa ON qa.day = d.day;
END;
$$;

CREATE OR REPLACE FUNCTION apply_outcomes_retention(
  p_raw_days INT DEFAULT 90,
  p_rollup_days INT DEFAULT 730
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_raw_days < 1 THEN
    RAISE EXCEPTION 'p_raw_days must be >= 1';
  END IF;
  IF p_rollup_days < p_raw_days THEN
    RAISE EXCEPTION 'p_rollup_days must be >= p_raw_days';
  END IF;

  DELETE FROM generation_outcomes
  WHERE recorded_at < NOW() - (p_raw_days || ' days')::interval;

  DELETE FROM quiz_attempts
  WHERE submitted_at < NOW() - (p_raw_days || ' days')::interval;

  DELETE FROM outcomes_daily_rollups
  WHERE day < CURRENT_DATE - p_rollup_days;
END;
$$;

CREATE OR REPLACE FUNCTION run_outcomes_maintenance(
  p_raw_days INT DEFAULT 90,
  p_rollup_days INT DEFAULT 730
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_outcomes_daily_rollups(CURRENT_DATE - 7, CURRENT_DATE);
  PERFORM apply_outcomes_retention(p_raw_days, p_rollup_days);
END;
$$;
