# SQL Migrations

- `0001_init.sql`: core schema for ingestion, idempotency, and jobs.
- `0001_down.sql`: rollback for initial schema.
- `0002_summary_artifacts.sql`: summary artifact persistence.
- `0002_down.sql`: rollback for summary artifacts.
- `0003_active_recall_artifacts.sql`: active-recall artifact persistence.
- `0003_down.sql`: rollback for active-recall artifacts.
- `0004_knowledge_structure_artifacts.sql`: knowledge-structure artifact persistence.
- `0004_down.sql`: rollback for knowledge-structure artifacts.
- `0005_outcomes_and_attempts.sql`: persistent quiz attempts and job outcome metrics.
- `0005_down.sql`: rollback for outcomes and attempts tables.
- `0006_outcomes_rollup_retention.sql`: daily rollups + retention maintenance functions.
- `0006_down.sql`: rollback for rollups and maintenance functions.
- `0007_maintenance_telemetry.sql`: maintenance run telemetry table + stats-returning function.
- `0007_down.sql`: rollback for maintenance telemetry schema.
- `0008_stage_cost_events.sql`: per-stage cost/latency/token telemetry table.
- `0008_down.sql`: rollback for stage-cost telemetry schema.
- `0009_lifecycle_retention.sql`: lifecycle retention maintenance table + stats-returning function.
- `0009_down.sql`: rollback for lifecycle retention schema.
- `0010_source_links.sql`: source attribution link persistence.
- `0010_down.sql`: rollback for source link persistence.
- `0011_cache_reuse.sql`: source/artifact cache reuse tables and telemetry.
- `0011_down.sql`: rollback for cache reuse tables.
- `0012_degradation_resume_queue.sql`: degradation resume metadata for jobs.
- `0012_down.sql`: rollback for degradation resume metadata.
- `0022_lifecycle_identity_learning_retention.sql`: lifecycle retention coverage for user profiles, inactive share links, flashcard reviews, learning sessions, and quiz attempts.
- `0022_down.sql`: rollback for identity/share/learning retention maintenance fields and function signature.
- `0023_generation_feedback.sql`: untrusted generation feedback persistence and indexes.
- `0023_down.sql`: rollback for generation feedback persistence.
- `0024_query_limit_indexes.sql`: bounded-query indexes for library, share, progress, analytics, and ops endpoints.
- `0024_down.sql`: rollback for bounded-query indexes.

Run migrations with your migration tool of choice, or manually using `psql`.

## Migration Safety Gate
- Manifest: `infra/sql/migration-safety.json`.
- Gate: `npm run gate:migration-safety`.
- Checks include contiguous migration IDs, up/down rollback object coverage,
  supported rollback-window size, and critical-table/column integrity.

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

## Lifecycle Retention Maintenance
- Maintenance function: `run_lifecycle_retention_stats(idempotency_days, job_days, artifact_days, telemetry_days, profile_days, share_days, learning_review_days)`.
- Telemetry table: `lifecycle_maintenance_runs`.
- Manual run via API workspace:
  - `npm exec -w @ultrawiki/api node --import tsx scripts/lifecycle-maintenance.ts`
- Scheduled run:
  - GitHub Actions workflow: `.github/workflows/lifecycle-maintenance.yml` (daily + manual dispatch).
