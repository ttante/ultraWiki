# UltraWiki Release Readiness

Release candidate: `mvp-local-readiness`

Canonical evidence manifest: `infra/release/readiness-report.json`.

## Release Gate
Run the full readiness gate before any release tag:

```bash
npm run gate:release-readiness
```

The gate validates:
- every required lint/typecheck/test/build command is listed,
- every required CI gate is listed,
- runtime LLM prompts are versioned in `infra/prompts/registry.json` and validated by `npm run gate:llm-prompt-registry`,
- local real-model evaluation thresholds are validated without requiring the 14B model in CI,
- every P0/P1 ticket in `docs/tickets.md` is linked to evidence,
- every referenced evidence artifact exists.

## Manual Release Checklist
- Run `npm run lint`.
- Run `npm run typecheck`.
- Run `npm run test`.
- Run `npm run build`.
- Run all required gates listed in `infra/release/readiness-report.json`.
- If releasing model/runtime changes, run `npm run eval:real-model -- --start` on an RTX 4080 host with the Qwen GGUF present.
- If releasing full-stack real-model changes, run `npm run smoke:real-llm` on that same host.
- Record the latest real-model result or model-file blocker in `docs/real-model-qualification.md`.
- Attach command output or CI run URL to the release issue.
- Verify `docs/startup.md` still matches local startup steps.
- Verify support runbooks and backup/restore drill evidence are current.

## Evidence Ownership
- Platform/CI: compose, smoke, startup docs, CI workflow.
- Product slices: API/domain/web tests for ingestion, artifacts, graph, recommendations, and study flow.
- Governance: prompt, taxonomy, golden-set, benchmark, real-model eval thresholds, and change-gating reports.
- Operations: monitoring, alerts, SLO/error-budget, retention, backup/restore, migration safety.
- Support: incident playbook, tabletop exercises, release readiness report.
