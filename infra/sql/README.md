# SQL Migrations

- `0001_init.sql`: core schema for ingestion, idempotency, and jobs.
- `0001_down.sql`: rollback for initial schema.
- `0005_outcomes_and_attempts.sql`: persistent quiz attempts and job outcome metrics.
- `0005_down.sql`: rollback for outcomes and attempts tables.
- `0006_outcomes_rollup_retention.sql`: daily rollups + retention maintenance functions.
- `0006_down.sql`: rollback for rollups and maintenance functions.
- `0007_maintenance_telemetry.sql`: maintenance run telemetry table + stats-returning function.
- `0007_down.sql`: rollback for maintenance telemetry schema.
- `0008_stage_cost_events.sql`: per-stage cost/latency/token telemetry table.
- `0008_down.sql`: rollback for stage-cost telemetry schema.

Run migrations with your migration tool of choice, or manually using `psql`.

## Outcomes Retention Maintenance
- Maintenance function: `run_outcomes_maintenance_stats(raw_days, rollup_days)`.
- Telemetry table: `outcomes_maintenance_runs`.
- Defaults:
  - raw tables (`generation_outcomes`, `quiz_attempts`): `90` days
  - rollups (`outcomes_daily_rollups`): `730` days
- Manual run via API workspace:
  - `npm exec -w @ultrawiki/api node --import tsx scripts/outcomes-maintenance.ts`
- Scheduled run:
  - GitHub Actions workflow: `.github/workflows/outcomes-maintenance.yml` (daily + manual dispatch).
