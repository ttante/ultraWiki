# UltraWiki Release Readiness

Release candidate: `mvp-local-readiness`

Canonical evidence manifest: `infra/release/readiness-report.json`.

Current release evidence snapshot: `docs/release-evidence-2026-05-25.md`.

## Release Gate
Run the full readiness gate before any release tag:

```bash
npm run gate:release-readiness
```

The gate validates:
- every required lint/typecheck/test/build command is listed,
- every required CI gate is listed,
- the ticket tracker integrity gate is included and the active queue mirrors `docs/ticket-progress.md`,
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
- Run `npm run gate:ticket-progress` after any tracker update and before release tagging.
- If releasing model/runtime changes, run `npm run eval:real-model -- --start` on an RTX 4080 host with the Qwen GGUF present.
- If releasing full-stack real-model changes, run `npm run smoke:real-llm` on that same host.
- Record the latest real-model result or model-file blocker in `docs/real-model-qualification.md`.
- Attach command output or CI run URL to the release issue.
- Verify `docs/startup.md` still matches local startup steps.
- Verify `docs/ui.md` still matches current share, library, flashcard progress, graph, and Ops tab flows.
- Verify support runbooks and backup/restore drill evidence are current.

## Evidence Ownership
- Platform/CI: compose, smoke, startup docs, CI workflow.
- Product slices: API/domain/web tests for ingestion, artifacts, graph, recommendations, and study flow.
- Governance: prompt, taxonomy, golden-set, benchmark, real-model eval thresholds, and change-gating reports.
- Operations: monitoring, alerts, SLO/error-budget, retention, backup/restore, migration safety.
- Support: incident playbook, tabletop exercises, release readiness report, and ticket tracker integrity.

## Current Feature Evidence
- Local profile/library/share-link foundation: documented in `docs/ui.md`, `docs/startup.md`, and covered by API route/repo tests listed in `docs/release-evidence-2026-05-25.md`.
- Flashcard spaced-repetition progress: documented in `docs/ui.md`, startup API examples, and covered by route/repo tests listed in the current evidence snapshot.
- Graph search, path inspector, timeline navigator, and Ops tab scaffold: documented in `docs/ui.md`; current UI/API validation evidence is summarized in the current evidence snapshot.
- Data lifecycle retention for profiles, inactive share links, and learning review data: policy, maintenance runner, migration coverage, and data-ops gate evidence are summarized in the current evidence snapshot.
- Tracker workflow: `docs/ticket-progress.md` now includes the standard update workflow and is guarded by `npm run gate:ticket-progress`.
