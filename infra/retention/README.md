# Lifecycle Retention Policy

Policy source: `infra/retention/lifecycle-policy.json`.

## Scope
- Logs
- Traces
- Idempotency keys
- Failed/quarantined jobs
- Study packs and generated artifacts
- Stage-cost telemetry

## Exceptions
Exceptions are explicitly listed in the policy file with a reason and custom retention window. Current exceptions:
- `security_events`: longer window for abuse investigation.
- `compliance_attribution`: longer window for attribution/revision support.

## Maintenance Execution
Lifecycle DB cleanup function:
- `run_lifecycle_retention_stats(idempotency_days, job_days, artifact_days, telemetry_days)`

Runner script:
- `npm run maintenance:lifecycle --workspace @ultrawiki/api`

Dry-run validation:
- `LIFECYCLE_MAINTENANCE_DRY_RUN=1 npm run maintenance:lifecycle --workspace @ultrawiki/api`
