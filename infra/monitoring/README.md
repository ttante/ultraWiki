# Monitoring Assets

## Outcomes Metrics Endpoint
- API exposes Prometheus metrics at `GET /api/metrics/outcomes`.
- JSON analytics snapshot is available at `GET /api/analytics/outcomes`.

## Grafana Dashboard
- Import `infra/monitoring/grafana/outcomes-dashboard.json`.
- Expected metric series:
  - `ultrawiki_jobs_completed_total`
  - `ultrawiki_jobs_failed_total`
  - `ultrawiki_job_duration_avg_ms`
  - `ultrawiki_job_completion_rate`
  - `ultrawiki_summary_citation_rate_avg`
  - `ultrawiki_flashcards_avg`
  - `ultrawiki_quiz_questions_avg`
  - `ultrawiki_quiz_attempts_total`
  - `ultrawiki_quiz_accuracy_avg`
  - `ultrawiki_outcomes_maintenance_duration_ms`
  - `ultrawiki_outcomes_maintenance_pruned_generation_outcomes_total`
  - `ultrawiki_outcomes_maintenance_pruned_quiz_attempts_total`
  - `ultrawiki_outcomes_maintenance_rollups_refreshed_total`
  - `ultrawiki_outcomes_maintenance_last_run_timestamp_seconds`
  - `ultrawiki_cost_estimated_total_usd`
  - `ultrawiki_cost_estimated_avg_usd_per_pack`
  - `ultrawiki_stage_cost_estimated_total_usd{stage=...}`
  - `ultrawiki_stage_tokens_estimated_avg{stage=...}`
  - `ultrawiki_stage_latency_avg_ms{stage=...}`
  - `ultrawiki_queue_depth`
  - `ultrawiki_queue_running_jobs`
  - `ultrawiki_queue_max_depth`
  - `ultrawiki_degraded_jobs_total`
  - `ultrawiki_degraded_job_rate`
  - `ultrawiki_cache_events_total`
  - `ultrawiki_cache_hits_total`
  - `ultrawiki_cache_misses_total`
  - `ultrawiki_cache_hit_rate`
  - `ultrawiki_security_suspicious_inputs_total`
  - `ultrawiki_security_signature_alerts_total`
  - `ultrawiki_security_suspicious_inputs_by_signature_total{signature=...}`
  - `ultrawiki_security_signature_alerts_by_signature_total{signature=...}`
  - `ultrawiki_slo_time_to_first_artifact_p95_ms`
  - `ultrawiki_slo_full_pack_completion_p95_ms`
  - `ultrawiki_slo_job_success_rate`
  - `ultrawiki_slo_citation_coverage_rate`

## SLO Definitions
- Checked-in definitions: `infra/monitoring/slo-definitions.json`
- PromQL references: `infra/monitoring/slo-queries.promql`
- `p95 time-to-first-artifact`:
  - Query: `ultrawiki_slo_time_to_first_artifact_p95_ms`
  - Signal: p95 of (`ingestion` + `summarization`) stage latency per job.
- `p95 full-pack completion time`:
  - Query: `ultrawiki_slo_full_pack_completion_p95_ms`
  - Signal: p95 end-to-end completed job duration.
- `job success rate`:
  - Query: `ultrawiki_slo_job_success_rate`
  - Signal: `completed / (completed + failed)`.
- `citation coverage rate`:
  - Query: `ultrawiki_slo_citation_coverage_rate`
  - Signal: average citation coverage on completed summaries.
- Current guardrail targets:
  - job success rate `>= 0.99`
  - citation coverage rate `>= 0.85`
  - p95 time-to-first-artifact `<= 30000ms`
  - p95 full-pack completion `<= 60000ms`

## Alert Rules
- Prometheus rules: `infra/monitoring/prometheus/alerts/outcomes-slo-alerts.yml`
- Runbook: `infra/monitoring/runbooks/outcomes-slo-alerts.md`
- Rules include:
  - Multi-window burn-rate alerts for job-success SLO (`99%` target).
  - Citation coverage quality alert.
  - Quiz accuracy regression alert with minimum volume guard.
  - Queue saturation alert.
  - Degraded/partial output rate alert.
  - Cache hit-rate efficiency alert.
  - Stage latency alert.
  - Security signature threshold alert.
  - Maintenance anomaly alerts (never-run, stale, duration-high, duration-spike, prune-spike).
  - Severity-based routing metadata policy (`infra/monitoring/alert-routing-policy.json`) with `page_service`, `ticket_queue`, `notify_channel`, and `escalation_target` validation.
  - Page alerts must map to runbook anchors and passed drill evidence (`infra/monitoring/drills/alert-drills.json`).

## Error Budget Policy
- Policy doc: `infra/monitoring/policies/error-budget-policy.md`
- Scenario fixtures: `infra/monitoring/fixtures/error-budget-policy-scenarios.json`
- Gate: `npm run gate:error-budget-policy`

## Local Monitoring Stack
- Start app + monitoring profile:
  - `docker compose --profile monitoring up --build`
- UIs:
  - Prometheus: `http://localhost:9090`
  - Alertmanager: `http://localhost:9093`
  - Pushgateway: `http://localhost:9091`

## End-to-End Alert Simulation
- Run:
  - `bash scripts/monitoring-simulate-alert.sh`
- The script:
  - pushes `ultrawiki_synthetic_alert 1` to Pushgateway,
  - waits for `UltraWikiSyntheticAlert` in Prometheus,
  - confirms it appears in Alertmanager,
  - deletes the synthetic metric.

## CI Validation
- `npm run gate:monitoring-config`
  - validates Prometheus config/rules via `promtool`.
  - validates Alertmanager config via `amtool`.
- `npm run gate:alert-policy`
  - enforces `owner`, `severity`, and `runbook` metadata on every alert rule.
  - validates Alertmanager severity routes and receiver names against `infra/monitoring/alert-routing-policy.json`.
  - enforces severity routing policy:
    - `severity: page` requires `page_service` and `escalation_target`.
    - `severity: ticket` requires `ticket_queue` and `escalation_target`.
    - `severity: info` requires `notify_channel`.
- `npm run gate:alert-runbook-linkage`
  - enforces runbook anchor coverage for every alert.
  - enforces drill evidence existence for every paging alert.
