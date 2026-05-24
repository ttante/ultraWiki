# Outcomes SLO Alerts Runbook

## Scope
This runbook covers alert triage for outcomes reliability and quality metrics emitted by the API:
- `ultrawiki_jobs_completed_total`
- `ultrawiki_jobs_failed_total`
- `ultrawiki_summary_citation_rate_avg`
- `ultrawiki_quiz_attempts_total`
- `ultrawiki_quiz_accuracy_avg`
- `ultrawiki_queue_depth`
- `ultrawiki_queue_running_jobs`
- `ultrawiki_queue_max_depth`
- `ultrawiki_degraded_job_rate`
- `ultrawiki_degraded_jobs_total`
- `ultrawiki_cache_hit_rate`
- `ultrawiki_cache_events_total`
- `ultrawiki_stage_latency_avg_ms`
- `ultrawiki_stage_cost_estimated_total_usd`
- `ultrawiki_security_suspicious_inputs_total`
- `ultrawiki_security_signature_alerts_total`
- `ultrawiki_security_suspicious_inputs_by_signature_total`
- `ultrawiki_security_signature_alerts_by_signature_total`
- `ultrawiki_outcomes_maintenance_duration_ms`
- `ultrawiki_outcomes_maintenance_pruned_generation_outcomes_total`
- `ultrawiki_outcomes_maintenance_pruned_quiz_attempts_total`
- `ultrawiki_outcomes_maintenance_rollups_refreshed_total`
- `ultrawiki_outcomes_maintenance_last_run_timestamp_seconds`

## SLO Targets
- Job success SLO: `>= 99%` over rolling 30 days.
- Citation coverage target: `>= 0.85`.
- Quiz accuracy guardrail: `>= 0.55` after 20+ attempts.

## Alert Mapping

### UltraWikiSLOCriticalBurnRate
Symptoms:
- 5m and 1h burn rates both exceed `14.4x`.

Immediate actions:
1. Check current error spikes: `sum(rate(ultrawiki_jobs_failed_total[5m]))`.
2. Identify failing stage from API logs (`job_id`, `stage`, `errors`).
3. If failures are sustained, reduce `JOB_CONCURRENCY_LIMIT` and/or switch to safer model preset.
4. If recent deploy is implicated, roll back last API image.

Escalation:
- Page on-call engineer immediately.

### UltraWikiSLOWarningBurnRate
Symptoms:
- 30m and 6h burn rates both exceed `6x`.

Immediate actions:
1. Compare completion and failure rates in dashboard.
2. Inspect queue depth and retry/dead-letter trends.
3. Create mitigation issue before burn reaches page threshold.

Escalation:
- Ticket to reliability owner in current sprint.

### UltraWikiCitationCoverageLow
Symptoms:
- `ultrawiki_summary_citation_rate_avg < 0.85` for 15m.

Immediate actions:
1. Validate source parser health for affected topics.
2. Inspect summary generation artifacts for missing citations.
3. If source extraction degraded, revert parser changes.

Escalation:
- Ticket to content-quality owner.

### UltraWikiQuizAccuracyLow
Symptoms:
- `ultrawiki_quiz_accuracy_avg < 0.55` with `ultrawiki_quiz_attempts_total >= 20`.

Immediate actions:
1. Inspect newly generated quiz items for ambiguity/multiple-correct options.
2. Run golden-set regression and quiz rubric checks.
3. Roll back prompt version if regression correlates with recent prompt changes.

Escalation:
- Ticket to learning-quality owner.

### UltraWikiQueueSaturated
Symptoms:
- `ultrawiki_queue_depth / ultrawiki_queue_max_depth > 0.8` for 10 minutes.

Immediate actions:
1. Check `ultrawiki_queue_running_jobs` against `ultrawiki_queue_global_concurrency_limit`.
2. Inspect API logs for slow stages, retry loops, and external Wikipedia fetch failures.
3. If workers are healthy but saturated, temporarily lower admission by reducing `MAX_QUEUE_DEPTH` or add worker capacity.
4. If saturation follows a deploy, compare stage latency and failure metrics before and after the deploy.

Escalation:
- Ticket to reliability queue; page only if queue remains saturated and user-facing requests are failing.

### UltraWikiDegradedOutputRateHigh
Symptoms:
- `ultrawiki_degraded_job_rate > 0.2` after at least 10 completed jobs.

Immediate actions:
1. Compare `TOKEN_BUDGET_PER_JOB` and `LATENCY_BUDGET_MS` against recent source sizes.
2. Check which degradation reason is appearing in API job responses.
3. Inspect stage latency and token metrics to determine whether summaries, graph, flashcards, or quiz are driving fallback.
4. If degradation increased after a prompt/model/runtime change, roll back to the last passing preset.

Escalation:
- Ticket to reliability queue and notify content-quality owner if artifacts are systematically missing.

### UltraWikiCacheHitRateLow
Symptoms:
- `ultrawiki_cache_hit_rate < 0.25` after at least 20 cache provenance events.

Immediate actions:
1. Confirm `CACHE_TTL_SECONDS` has not been reduced unexpectedly.
2. Inspect cache events in the loaded pack response for parser, prompt, taxonomy, and revision mismatches.
3. Check whether source revisions changed frequently for tested topics.
4. If cache invalidation is too aggressive, review recent prompt/taxonomy version changes before reverting.

Escalation:
- Ticket to reliability queue with sample pack IDs and cache event rows.

### UltraWikiStageLatencyHigh
Symptoms:
- `max(ultrawiki_stage_latency_avg_ms) > 20000` for 15 minutes.

Immediate actions:
1. Identify the slow stage from the dashboard legend.
2. Compare stage token estimates and article sizes for the same time window.
3. Check local runtime preset, CPU/GPU saturation, and Wikipedia fetch latency.
4. Reduce `JOB_CONCURRENCY_LIMIT` or switch to safer runtime preset if local model pressure is high.

Escalation:
- Ticket to reliability queue; page if latency causes sustained SLO burn-rate alerts.

### UltraWikiSecuritySignatureAlertsHigh
Symptoms:
- `increase(ultrawiki_security_signature_alerts_total[10m]) > 0` for 5 minutes.

Immediate actions:
1. Inspect security log events by `correlationId`, `signature`, and sanitized `inputPreview`.
2. Compare signature counts in `ultrawiki_security_suspicious_inputs_by_signature_total`.
3. If a new attack pattern is present, add it to the adversarial corpus and sanitizer signatures.
4. If traffic is abusive, add rate-limit or blocklist mitigation before changing generation prompts.

Escalation:
- Ticket to security queue; page reliability only if traffic also causes queue saturation or SLO burn.

### UltraWikiSyntheticAlert
Symptoms:
- Alert fires shortly after pushing `ultrawiki_synthetic_alert 1` to Pushgateway.

Immediate actions:
1. Confirm alert appears in Prometheus `/alerts` UI.
2. Confirm alert is visible in Alertmanager `/alerts` UI.
3. Reset metric to `0` or delete the Pushgateway series when done.

Escalation:
- None. This alert is for local pipeline verification.

### UltraWikiOutcomesMaintenanceNeverRun
Symptoms:
- `ultrawiki_outcomes_maintenance_last_run_timestamp_seconds == 0` for 6 hours.

Immediate actions:
1. Verify scheduled workflow `outcomes-maintenance.yml` has executed in the last 24 hours.
2. If no runs occurred, trigger `workflow_dispatch` and inspect runner logs for startup failures.
3. Confirm `npm run db:migrate --workspace @ultrawiki/api` succeeds before maintenance step.
4. Validate DB connectivity and `DATABASE_URL` secret scope for the workflow environment.

Escalation:
- Ticket to reliability queue with workflow run URL and failure class.

### UltraWikiOutcomesMaintenanceStale
Symptoms:
- Last successful maintenance run is older than 36 hours.

Immediate actions:
1. Inspect `outcomes_maintenance_runs` for recent failed rows and error payload.
2. Check API deploy/migration history for schema drift after last successful run.
3. Run `npm run maintenance:outcomes --workspace @ultrawiki/api` manually in staging with `--dry-run`.
4. If healthy in staging, re-run failed production workflow run.

Escalation:
- Ticket to reliability queue; elevate if stale window exceeds 72 hours.

### UltraWikiOutcomesMaintenanceDurationHigh
Symptoms:
- `ultrawiki_outcomes_maintenance_duration_ms > 120000` for 15 minutes.

Immediate actions:
1. Check row prune counts from latest run for unusual growth trends.
2. Review PostgreSQL query plans for maintenance deletes and rollup refreshes.
3. Confirm index coverage on `generation_outcomes` and `quiz_attempts` retention predicates.
4. Temporarily lower workload by narrowing retention windows only if storage pressure is critical.

Escalation:
- Ticket to reliability queue; page DBA/on-call if duration exceeds 10 minutes.


### UltraWikiOutcomesMaintenanceDurationSpike
Symptoms:
- Maintenance duration exceeds `60s` and is more than `2x` the 7-day average.

Immediate actions:
1. Compare latest prune counts with the 7-day baseline and recent traffic volume.
2. Inspect PostgreSQL query plans for retention deletes and rollup refreshes.
3. Check for missing indexes or table bloat on outcomes and quiz attempt tables.
4. If the spike follows a deploy, compare migration changes touching retention predicates.

Escalation:
- Ticket to reliability queue; add DBA/on-call if repeated spikes persist for two runs.

### UltraWikiOutcomesMaintenancePruneSpike
Symptoms:
- Pruned rows exceed `50,000` for `generation_outcomes` or `quiz_attempts`.

Immediate actions:
1. Validate retention configuration changes in infra config and recent deploys.
2. Confirm spike aligns with expected backfill/cleanup events (for example after policy change).
3. Inspect ingestion traffic for anomalous surges or duplicate writes.
4. If unexpected, snapshot offending partitions and open incident issue for data pipeline analysis.

Escalation:
- Ticket to reliability queue and notify data pipeline owner.

## Tabletop Drill Checklist
1. Trigger synthetic failures in staging and confirm each alert fires.
2. Confirm alert payload includes `runbook` annotation and correct anchor.
3. Validate triage time-to-mitigation under 30 minutes for page-level alert.
