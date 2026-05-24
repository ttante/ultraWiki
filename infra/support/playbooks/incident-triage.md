# UltraWiki Support Playbook

## Scope
Operational triage for common incident classes in production-like environments.

## Triage Defaults
- Severity owner: support on-call.
- Escalation target: platform owner for infrastructure or queue failures; AI owner for prompt/model failures.
- Evidence to capture: correlation IDs, job IDs, affected pack IDs, runtime preset, prompt version, taxonomy version, and current cost/latency metrics.
- User communication: state whether artifacts are delayed, partial, retriable, or unavailable.

## Common Failure: Timeouts
1. Confirm queue depth and job stage from `/api/jobs/:id`.
2. Check latency spikes in outcomes metrics and stage-cost telemetry.
3. If widespread, reduce concurrency via runtime preset or `JOB_CONCURRENCY_LIMIT`.
4. If localized, re-drive impacted jobs and capture correlation IDs.

## Common Failure: Malformed Pages
1. Validate input domain and article parseability.
2. Inspect ingestion parser output for section extraction anomalies.
3. Re-run with title input if URL encoding is suspect.
4. If parser bug confirmed, quarantine affected jobs and create hotfix ticket.
5. Capture source revision ID and parser version before clearing or retrying work.

## Common Failure: Model Overload
1. Inspect current runtime preset and concurrency.
2. Shift to `rtx4080_qwen14b_safe` preset.
3. Trigger deterministic degradation path if budget/latency limits are exceeded.
4. Record user-visible impact and estimated recovery window.

## Escalation Procedure
1. Page on-call owner when job success SLO or citation coverage alert pages.
2. Escalate to platform owner if issue persists past 30 minutes.
3. Open incident ticket with impact summary, blast radius, and timeline.
4. Escalate to AI owner when prompt regression, model overload, malformed outputs, or safety filter failures are suspected.

## Rollback Procedure
1. Revert to last known-good prompt/runtime/config version.
2. Disable newly introduced overrides or feature flags.
3. Re-run golden-set and prompt-regression gates before restoring normal traffic.
4. Attach rollback evidence to incident ticket and follow-up remediation task.
5. Record the rollback version, validation command output, and any skipped checks in the incident ticket.
