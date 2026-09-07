# Lifecycle Retention Policy

Policy source: `infra/retention/lifecycle-policy.json`.

## Scope
- Logs
- Traces
- Idempotency keys
- Failed/quarantined jobs
- Study packs and generated artifacts
- Stage-cost telemetry
- User profiles that no longer own saved packs, active shares, learning records, or goals
- Expired/revoked share links
- Learning review data: flashcard reviews, learning sessions, and quiz attempts

## Enforcement Controls
Every scope in `retention_days` must have an enforcement entry in the policy file.
- `logs`: external deployment log sink retention control.
- `traces`: external OpenTelemetry/backend trace retention control.
- `idempotency_keys`: `run_lifecycle_retention_stats` with `idempotency_days`.
- `jobs_failed_or_quarantined`: `run_lifecycle_retention_stats` with `job_days`.
- `artifacts_and_packs`: `run_lifecycle_retention_stats` with `artifact_days`.
- `cost_telemetry`: `run_lifecycle_retention_stats` with `telemetry_days`.
- `user_profiles`: `run_lifecycle_retention_stats` with `profile_days`.
- `share_links`: `run_lifecycle_retention_stats` with `share_days`.
- `learning_reviews`: `run_lifecycle_retention_stats` with `learning_review_days`.

The lifecycle gate validates policy shape, required controls, the DB maintenance
function, and the scheduled workflow before the runner is allowed to execute.

## Exceptions
Exceptions are explicitly listed in the policy file with a reason and custom retention window. Current exceptions:
- `security_events`: longer window for abuse investigation.
- `compliance_attribution`: longer window for attribution/revision support.

## Maintenance Execution
Lifecycle DB cleanup function:
- `run_lifecycle_retention_stats(idempotency_days, job_days, artifact_days, telemetry_days, profile_days, share_days, learning_review_days)`

Runner script:
- `npm run maintenance:lifecycle --workspace @ultrawiki/api`

Dry-run validation:
- `LIFECYCLE_MAINTENANCE_DRY_RUN=1 npm run maintenance:lifecycle --workspace @ultrawiki/api`
