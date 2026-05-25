# UltraWiki MVP Stories and Tickets

## Purpose
This backlog translates `docs/plans.md` into implementation-ready stories and tickets with strict test-driven development, reliability, observability, taxonomy governance, and cost/performance controls from day one.

## Progress Tracker
Operational ticket status, timestamps, blockers, and next implementation order are tracked in `docs/ticket-progress.md`. Future implementation agents should update that file whenever a ticket is started, blocked, completed, or when new future work is discovered.

## Delivery Model
- Story shape: vertical slices that ship user-visible value.
- Ticket policy: every ticket must be test-first and CI-gated.
- Priority levels: `P0` (blocker/core), `P1` (required for MVP), `P2` (post-core hardening within MVP window).

## Global Definition of Done (Applies to Every Ticket)
- A failing test is committed first (`red`), then implementation (`green`), then cleanup (`refactor`).
- CI is green for lint, typecheck, unit/integration tests, and required e2e suite.
- Coverage thresholds are met:
  - API/worker/domain logic: >=90% line coverage.
  - UI components/hooks: >=80% line coverage.
  - Critical paths (job orchestration, grounding, budget enforcement): >=95% branch coverage.
- Structured logging and tracing are added for new execution paths (or explicitly marked `N/A` with reason).
- Taxonomy impact reviewed and mapped to controlled vocab/schema.
- Prompt/config/model changes are versioned with changelog entry.
- Cost and latency budget impact is documented.
- Rollback/failure behavior is documented in ticket notes.

## Required CI Gates
- `gate:tdd-proof`: verify modified tickets include failing test evidence in PR checklist.
- `gate:coverage`: enforce thresholds above.
- `gate:contracts`: artifact/API schema contract tests.
- `gate:quality-scoring`: validate measurable scoring thresholds, known pass/fail fixtures, and golden-topic score pass/fail behavior.
- `gate:golden-set`: quality regression suite on canonical topics.
- `gate:prompt-regression`: side-by-side prompt quality regression checks on golden topics.
- `gate:runtime-presets`: validates RTX 4080/Qwen preset matrix and runtime defaults.
- `gate:local-llm-config`: validates llama.cpp/Qwen local runtime config and Compose profile.
- `gate:change-gating-policy`: enforces protected-change quality gate policy and emergency override expiry/follow-up rules.
- `gate:adversarial-corpus`: adversarial prompt-injection corpus regression suite.
- `gate:lifecycle-retention`: retention/lifecycle policy enforcement and maintenance dry-run.
- `gate:backup-restore-drill`: backup/restore drill log and verification checks.
- `gate:support-playbook`: support triage/escalation/rollback playbook and tabletop exercise checks.
- `gate:release-data-ops`: consolidated migration, retention, and backup/restore release evidence gate.
- `gate:release-readiness`: validates every P0/P1 ticket has linked release evidence.
- `gate:bench-regression`: performance regression threshold checks for model pipeline.
- `gate:migration-safety`: migration up/down tests (when schema changes exist).

## Ticket Template (Use for Every Ticket)
```md
### T<story>.<ticket> <Title>
Priority: P0|P1|P2
Owner: <role/team>
Depends on: <ticket ids or none>

Scope
- ...

Implementation Notes
- ...

Acceptance Criteria
- [ ] ...
- [ ] ...

Required Tests (TDD)
- Unit:
- Integration:
- E2E (if applicable):
- Non-functional (if applicable):

Observability
- Logs:
- Metrics:
- Traces:
- Alerts:

Cost/Performance Impact
- ...

Docs/Runbook
- ...
```

## Story Roadmap
1. S1 Local Platform and CI Baseline
2. S15 Contract and Schema Versioning
3. S7 Prompt Versioning and Taxonomy Governance
4. S8 Logging, Monitoring, Alerting
5. S9 Cost and Performance Controls
6. S13 Prompt Injection and Input Security
7. S2 Ingestion Vertical Slice
8. S11 Reliability Core (Idempotency + Recovery)
9. S12 Capacity and Backpressure
10. S3 Grounded Summaries Vertical Slice
11. S4 Flashcards and Quiz Vertical Slice
12. S5 Concepts, Graph, Timeline Vertical Slice
13. S6 Learn-Next Recommendations Vertical Slice
14. S14 Caching and Reuse
15. S18 Graceful Degradation and Resume
16. S16 SLOs and Error Budget Operations
17. S17 RTX 4080 Benchmark Qualification
18. S20 Golden Evaluation Governance
19. S19 Data Ops and Wikipedia Compliance
20. S10 Support and Release Readiness

## Canonical Execution Order (Ticket-Level)
This is the required implementation sequence. Tickets in the same phase can run in parallel unless a direct dependency is listed. If story-local ordering conflicts with this section, this section is authoritative.

1. Phase 0 - Project bootstrap and gates
- `T1.1` -> `T1.2` -> `T1.3`

2. Phase 1 - Cross-cutting foundations before feature logic
- `T15.1` -> `T7.1` -> `T7.3`
- `T8.1` -> `T8.2`
- `T9.1` -> `T9.2`
- `T13.1`

3. Phase 2 - Ingestion and job reliability core
- `T2.1` -> `T2.2` -> `T2.3`
- `T11.1` -> `T11.2` -> (`T11.3` and `T11.4`)
- `T12.1` -> `T12.2`

4. Phase 3 - First user-visible artifact slice (summaries)
- `T3.1` -> `T3.2` -> `T3.3`

5. Phase 4 - Active recall slice
- `T4.1` -> `T4.2` -> `T4.3` -> `T4.4`

6. Phase 5 - Knowledge structure slice
- `T5.1` -> `T5.2` -> `T5.3`
- `T15.3` after `T5.2`

7. Phase 6 - Recommendation slice
- `T6.1` -> `T6.2`

8. Phase 7 - Caching and graceful degradation
- `T14.1` -> `T14.2` -> `T14.3`
- `T18.1` -> `T18.2` -> `T18.3`
- `T12.3` after `T12.2` and `T18.1`

9. Phase 8 - Observability maturity and operational policy
- `T8.3` -> `T8.4`
- `T9.3`
- `T16.1` -> `T16.2` -> `T16.3`
- `T13.3`

10. Phase 9 - Quality governance and performance qualification
- `T20.1` -> `T20.2` -> `T7.2` -> `T20.3`
- `T17.1` -> `T17.2` -> `T17.3`
- `T13.2`

11. Phase 10 - Compliance, support, and release
- `T19.3` -> `T19.1` -> `T19.2`
- `T15.2`
- `T10.1` -> `T10.2` -> `T10.3`

## Stories and Tickets

## S1 Local Platform and CI Baseline
Goal: Establish reproducible local environment and strict test-first delivery gates.

### T1.1 Monorepo and Service Skeleton
Priority: P0
- Scope: Create `web` (Next.js), `api` (Node/TS), `worker` (Python/FastAPI), `infra` compose setup, shared config.
- Acceptance Criteria:
  - [x] `docker compose up` starts web/api/worker/postgres/llm services.
  - [x] Health endpoints exist and return healthy status.
  - [x] Service-to-service networking works locally.
- Required Tests:
  - Integration: compose smoke test for startup and health checks.
  - Non-functional: startup timeout threshold test.

### T1.2 Strict CI Gates and TDD Workflow
Priority: P0
- Scope: Add CI pipelines, coverage thresholds, PR checklist, required status checks.
- Acceptance Criteria:
  - [x] CI fails if tests are missing or coverage below threshold.
  - [x] CI fails if contract/golden-set/benchmark gates fail.
  - [x] PR template includes explicit `red -> green` evidence checklist.
- Required Tests:
  - Integration: CI workflow self-test jobs.
  - Non-functional: policy enforcement tests.

### T1.3 Local Developer Smoke Harness
Priority: P1
- Scope: One command to validate full local stack and baseline dependencies.
- Acceptance Criteria:
  - [x] `make smoke` (or equivalent) validates environment and service health.
  - [x] Failures include actionable error messaging.
- Required Tests:
  - Integration: smoke command success/failure branches.

## S2 Ingestion Vertical Slice
Goal: Accept Wikipedia input and persist normalized source content.

### T2.1 Topic Input API (Title or URL)
Priority: P0
- Acceptance Criteria:
  - [x] API accepts English Wikipedia title or URL.
  - [x] Non-English or unsupported domains are rejected with typed errors.
  - [x] Input normalization is deterministic.
- Required Tests:
  - Unit: validators/parsers.
  - Integration: endpoint success/failure matrix.

### T2.2 Wikipedia Fetch and Section Parsing
Priority: P0
- Acceptance Criteria:
  - [x] Page revision ID, sections, and canonical source snippets are stored.
  - [x] Parser handles biography/history/science page structures.
  - [x] No prompt/model call is needed for this deterministic stage.
- Required Tests:
  - Unit: section extraction + revision parsing.
  - Integration: persistence integrity tests.

### T2.3 Ingestion Failure and Retry Semantics
Priority: P1
- Acceptance Criteria:
  - [x] Transient fetch failures are retryable.
  - [x] Permanent parsing failures are classified and surfaced.
  - [x] Idempotent re-submit does not duplicate source rows.
- Required Tests:
  - Integration: retry classification.
  - Non-functional: duplicate-submit safety.

## S3 Grounded Summaries Vertical Slice
Goal: Generate multi-level summaries with evidence grounding.

### T3.1 Summary Generation by Level
Priority: P0
- Acceptance Criteria:
  - [x] `beginner`, `intermediate`, and `advanced` summaries are produced.
  - [x] Prompt version and model parameters are recorded.
  - [x] Generated output links back to source spans.
- Required Tests:
  - Unit: summary schema validation.
  - Integration: worker pipeline stage tests.

### T3.2 Grounding Validation and Unsupported-Claim Flags
Priority: P0
- Acceptance Criteria:
  - [x] Claims without citation support are flagged.
  - [x] Unsupported claims are excluded from trusted facts surfaces.
  - [x] Grounding metrics are emitted.
- Required Tests:
  - Unit: claim-to-span matcher.
  - Integration: rejection/flagging behavior.

### T3.3 UI Rendering for Summaries with Citations
Priority: P1
- Acceptance Criteria:
  - [x] Overview tab shows levels and evidence links.
  - [x] Missing citation state is visible and understandable.
- Required Tests:
  - Component: summary and citation UI states.
  - E2E: topic -> summary render flow.

## S4 Flashcards and Quiz Vertical Slice
Goal: Deliver active-recall artifacts with quality checks.

### T4.1 Flashcard Generation (15-25)
Priority: P0
- Acceptance Criteria:
  - [x] Produces 15-25 non-duplicate cards.
  - [x] Answers are source-grounded.
- Required Tests:
  - Unit: dedupe/shape validation.
  - Integration: generation constraints.

### T4.2 Quiz Generation (10-15) + Misconceptions
Priority: P0
- Acceptance Criteria:
  - [x] Produces 10-15 MCQs with single best answer.
  - [x] Includes misconception explanation per question.
- Required Tests:
  - Unit: question rubric validator.
  - Integration: generation + validator interplay.

### T4.3 Quiz Attempt Persistence and Scoring
Priority: P1
- Acceptance Criteria:
  - [x] Attempt history stored and retrievable.
  - [x] Score computation deterministic.
- Required Tests:
  - Unit: scoring logic.
  - Integration: persistence and retrieval.

### T4.4 Study Flow E2E
Priority: P1
- Acceptance Criteria:
  - [x] End-to-end path covers flashcards and quiz.
  - [x] Partial failures are handled without total flow loss.
- Required Tests:
  - E2E: complete study pack usage journey.

## S5 Concepts, Graph, Timeline Vertical Slice
Goal: First-class relationship graph + timeline with evidence drilldown.

### T5.1 Taxonomy-Driven Entity and Relation Extraction
Priority: P0
- Acceptance Criteria:
  - [x] Controlled entity taxonomy: `person`, `organization`, `event`, `concept`, `place`, `work`.
  - [x] Controlled relation taxonomy: `influenced`, `founded`, `member_of`, `occurred_in`, `related_to`, `precedes`.
  - [x] Unknown values are rejected or mapped through explicit rules.
- Required Tests:
  - Unit: taxonomy validators.
  - Integration: extraction to taxonomy mapping.

### T5.2 Graph and Timeline API Contracts
Priority: P0
- Acceptance Criteria:
  - [x] API returns schema-versioned graph and timeline payloads.
  - [x] Every node/edge/event includes source evidence references.
- Required Tests:
  - Unit: contract serialization.
  - Contract: schema conformance.

### T5.3 Interactive Visualization UI
Priority: P1
- Acceptance Criteria:
  - [x] Graph supports pan/zoom/filter by node type.
  - [x] Timeline supports chronological navigation and evidence click-through.
- Required Tests:
  - Component: graph/timeline interactions.
  - E2E: evidence drilldown flow.

## S6 Learn-Next Recommendations Vertical Slice
Goal: Grounded recommendations using Wikipedia link graph and context.

### T6.1 Recommendation Ranking Engine
Priority: P1
- Acceptance Criteria:
  - [x] Candidate topics derived from outgoing links + section context.
  - [x] Ranking rationale stored and exposed.
  - [x] Duplicate or off-topic suggestions filtered.
- Required Tests:
  - Unit: ranking + dedupe logic.
  - Integration: candidate generation/retrieval.

### T6.2 Recommendation UI
Priority: P1
- Acceptance Criteria:
  - [x] Shows ranked next topics with rationale.
  - [x] Users can branch into new study pack generation.
- Required Tests:
  - Component + E2E: recommendation to next-pack flow.

## S7 Prompt Versioning and Taxonomy Governance
Goal: Change control for prompts/taxonomy with regression safety.

### T7.1 Prompt Registry and Semantic Versioning
Priority: P0
- Acceptance Criteria:
  - [x] Every prompt has ID, semantic version, status, and changelog.
  - [x] Runtime stores prompt version per artifact.
- Required Tests:
  - Unit: registry operations/version semantics.
  - Integration: pipeline version capture.

### T7.2 Prompt Evaluation Harness
Priority: P0
- Acceptance Criteria:
  - [x] Supports side-by-side prompt regression checks on golden topics.
  - [x] Fails CI on quality drop thresholds.
- Required Tests:
  - Integration: harness pass/fail behavior.

### T7.3 Taxonomy Dictionary Governance
Priority: P0
- Acceptance Criteria:
  - [x] Central taxonomy dictionary with versioning.
  - [x] Migration path for taxonomy changes.
- Required Tests:
  - Unit: dictionary validation.
  - Migration tests: taxonomy version upgrade.

## S8 Logging, Monitoring, Alerting
Goal: Full observability with OpenTelemetry and operational dashboards.

### T8.1 Structured Logging Standard
Priority: P0
- Acceptance Criteria:
  - [x] All services emit JSON logs with `request_id`, `job_id`, `prompt_version`, `model`, `token_usage`.
  - [x] Log schemas are contract-tested.
- Required Tests:
  - Unit: log shape validators.
  - Integration: cross-service correlation tests.

### T8.2 Distributed Tracing
Priority: P0
- Acceptance Criteria:
  - [x] Traces span web->api->worker->llm pipeline.
  - [x] Critical stages have timing spans and error tags.
- Required Tests:
  - Integration: trace propagation tests.

### T8.3 Metrics and Dashboards
Priority: P1
- Acceptance Criteria:
  - [x] Dashboards include latency, success/failure, queue depth, grounding rate, budget-exceed rate.
  - [x] Dashboard panels have alertable thresholds.
- Required Tests:
  - Integration: metric emission and scrape tests.

### T8.4 Alerts and Runbooks
Priority: P1
- Acceptance Criteria:
  - [x] Alert rules exist for SLO breaches and critical failures.
  - [x] Linked runbook steps are actionable and tested via tabletop drill.
- Required Tests:
  - Non-functional: alert simulation tests.

## S9 Cost and Performance Controls
Goal: Enforce token/time budgets and predictable runtime behavior.

### T9.1 Per-Job Budgets and Hard Limits
Priority: P0
- Acceptance Criteria:
  - [x] Token and latency budgets are configurable by artifact stage.
  - [x] Exceeding limits triggers deterministic fallback behavior.
- Required Tests:
  - Unit: budget policy engine.
  - Integration: hard-limit enforcement.

### T9.2 Prompt and Chunk Guardrails
Priority: P0
- Acceptance Criteria:
  - [x] Chunking strategy protects 12GB VRAM constraints.
  - [x] Prompt size guards prevent runaway context growth.
- Required Tests:
  - Unit: chunk sizing calculations.
  - Non-functional: max-context stress tests.

### T9.3 Cost Telemetry by Stage
Priority: P1
- Acceptance Criteria:
  - [x] Cost metrics persisted per stage and per pack.
  - [x] Cost trends queryable in support dashboards.
- Required Tests:
  - Integration: telemetry storage and query tests.

## S10 Support and Release Readiness
Goal: Operational readiness for real users.

### T10.1 Support Playbooks
Priority: P1
- Acceptance Criteria:
  - [x] Triage playbook for common failures (timeouts, malformed pages, model overload).
  - [x] Escalation and rollback procedures documented.
- Required Tests:
  - Non-functional: tabletop incident exercises.

### T10.2 Data Migration and Retention Checks
Priority: P1
- Acceptance Criteria:
  - [x] Migration suite validates schema changes safely.
  - [x] Retention jobs validated against policy.
- Required Tests:
  - Integration: migration tests.

### T10.3 End-to-End Readiness Report
Priority: P1
- Acceptance Criteria:
  - [x] Publish release checklist with pass/fail artifacts.
  - [x] All P0/P1 tickets linked to verification evidence.
- Required Tests:
  - Non-functional: release gate verification script.

## S11 Reliability Core (Idempotency + Recovery)
Goal: Ensure safe retries and resilient job lifecycle.

### T11.1 Idempotency Keys for Study-Pack Create
Priority: P0
- Acceptance Criteria:
  - [x] Duplicate create requests with same key return same `pack_id`/`job_id`.
  - [x] Keys expire with configurable TTL.
- Required Tests:
  - Unit: key validation/TTL.
  - Integration: duplicate request behavior.

### T11.2 Exactly-Once Artifact Commit
Priority: P0
- Acceptance Criteria:
  - [x] Worker retries cannot duplicate artifact writes.
  - [x] Stage completion is transactional.
- Required Tests:
  - Integration: race/retry duplicate prevention.

### T11.3 DLQ and Poison-Job Quarantine
Priority: P1
- Acceptance Criteria:
  - [x] Repeated permanent failures route to DLQ.
  - [x] Quarantined jobs are inspectable and re-drivable.
- Required Tests:
  - Integration: DLQ routing and re-drive flow.

### T11.4 Stuck-Job Reaper
Priority: P1
- Acceptance Criteria:
  - [x] Heartbeat expiry marks jobs stuck.
  - [x] Reaper retries or quarantines based on policy.
- Required Tests:
  - Integration: crash recovery simulation.

## S12 Capacity and Backpressure
Goal: Controlled behavior under load.

### T12.1 Concurrency Limits
Priority: P0
- Acceptance Criteria:
  - [x] Global and per-session limits configurable.
  - [x] Limits enforced consistently across API and worker.
- Required Tests:
  - Integration: saturation and fairness tests.

### T12.2 Queue Admission Control
Priority: P0
- Acceptance Criteria:
  - [x] Overload yields explicit status (`429`/queued/deferred semantics).
  - [x] Admission decisions are observable.
- Required Tests:
  - Integration: overload behavior.

### T12.3 Backpressure Signals to UI
Priority: P1
- Acceptance Criteria:
  - [x] UI receives and displays wait/degraded states.
  - [x] No silent failure on throttling.
- Required Tests:
  - Component + integration: overloaded system user flow.

## S13 Prompt Injection and Input Security
Goal: Prevent source content from hijacking system behavior.

### T13.1 Instruction Isolation for Source Text
Priority: P0
- Acceptance Criteria:
  - [x] Source text is separated from system/task instructions.
  - [x] Sanitization rules remove known injection patterns from control channels.
- Required Tests:
  - Unit: sanitizer behavior.
  - Integration: pipeline isolation tests.

### T13.2 Adversarial Corpus Tests
Priority: P1
- Acceptance Criteria:
  - [x] Corpus includes malicious wiki patterns and edge payloads.
  - [x] CI fails on regression in injection defenses.
- Required Tests:
  - Non-functional: adversarial regression suite.

### T13.3 Security Event Logging
Priority: P1
- Acceptance Criteria:
  - [x] Suspicious patterns emit security events with correlation IDs.
  - [x] Alerts configurable for repeated attack signatures.
- Required Tests:
  - Integration: security event emission.

## S14 Caching and Reuse
Goal: Lower latency and cost by reusing deterministic work.

### T14.1 Revision-Hash Ingestion Cache
Priority: P0
- Acceptance Criteria:
  - [x] Same page revision reuses normalized content.
  - [x] Cache provenance links to revision IDs.
- Required Tests:
  - Unit: cache key logic.
  - Integration: hit/miss behavior.

### T14.2 Intermediate Artifact Cache
Priority: P1
- Acceptance Criteria:
  - [x] Extracted entities/timelines reusable across retries/regeneration.
  - [x] Cache correctness preserved across prompt-version changes.
- Required Tests:
  - Integration: invalidation on dependency change.

### T14.3 Cache Invalidation Policy
Priority: P1
- Acceptance Criteria:
  - [x] TTL and dependency-driven invalidation documented and enforced.
  - [x] Stale data detection is observable.
- Required Tests:
  - Unit + integration: invalidation paths.

## S15 Contract and Schema Versioning
Goal: Prevent drift between services and UI.

### T15.1 Schema-Versioned Artifact Payloads
Priority: P0
- Acceptance Criteria:
  - [x] All artifact responses include `schema_version`.
  - [x] Consumers support backward-compatible reads during transitions.
- Required Tests:
  - Contract tests across versions.

### T15.2 Migration Safety Suite
Priority: P0
- Acceptance Criteria:
  - [x] Migration up/down verification for supported rollback window.
  - [x] Data integrity checks for critical tables.
- Required Tests:
  - Integration: migration safety tests.

### T15.3 API Drift Guard
Priority: P1
- Acceptance Criteria:
  - [x] Contract snapshots block accidental breaking changes.
  - [x] UI fixtures update workflow documented.
- Required Tests:
  - Contract + integration tests.

## S16 SLOs and Error Budget Operations
Goal: Run system with clear reliability targets.

### T16.1 SLO Definition and Instrumentation
Priority: P0
- Acceptance Criteria:
  - [x] Define and instrument:
    - `p95 time-to-first-artifact`
    - `p95 full-pack completion time`
    - job success rate
    - citation coverage rate
  - [x] SLO dashboards and queries checked in.
- Required Tests:
  - Integration: SLO metric correctness.

### T16.2 Error Budget Policy
Priority: P1
- Acceptance Criteria:
  - [x] Error budget burn policy defined for release decisions.
  - [x] Automatic policy checks in release pipeline.
- Required Tests:
  - Non-functional: simulated burn-rate gating.

### T16.3 Alert-to-Runbook Linkage
Priority: P1
- Acceptance Criteria:
  - [x] Every paging alert maps to a runbook entry.
  - [x] On-call drills validate triage flow.
- Required Tests:
  - Non-functional: drill execution logs.

## S17 RTX 4080 Benchmark Qualification
Goal: Keep local Qwen runtime performant on 12GB VRAM.

### T17.1 Benchmark Harness
Priority: P0
- Acceptance Criteria:
  - [x] Measures throughput, stage latency, memory headroom, failure rates.
  - [x] Captures per-prompt-version benchmark metadata.
- Required Tests:
  - Non-functional: harness consistency tests.

### T17.2 Safe Runtime Preset Matrix
Priority: P0
- Acceptance Criteria:
  - [x] Publish validated presets (quantization, context window, chunk size, concurrency).
  - [x] Defaults are encoded in runtime config.
- Required Tests:
  - Integration: preset loading and enforcement.

### T17.3 Regression Gates
Priority: P1
- Acceptance Criteria:
  - [x] CI fails if benchmark regresses beyond threshold.
  - [x] Waiver process documented with expiry.
- Required Tests:
  - Non-functional: synthetic regression test.

## S18 Graceful Degradation and Resume
Goal: Always return usable output even under budget/time pressure.

### T18.1 Deterministic Fallback Order
Priority: P0
- Acceptance Criteria:
  - [x] On budget/time exceed, fallback order is enforced:
    1) summaries
    2) graph/timeline
    3) flashcards
    4) quiz
  - [x] Degradation reason and stage are surfaced in API/UI.
- Required Tests:
  - Integration: fallback order verification.

### T18.2 Resume and Retry Continuation
Priority: P1
- Acceptance Criteria:
  - [x] Users can resume incomplete packs.
  - [x] Resume does not recompute already-valid stages unless requested.
- Required Tests:
  - Integration + E2E: resume workflows.

### T18.3 Partial-Complete UX States
Priority: P1
- Acceptance Criteria:
  - [x] UI clearly distinguishes partial vs full completion.
  - [x] Next actions are explicit (resume/retry/view available outputs).
- Required Tests:
  - Component + E2E: degraded state UX.

## S19 Data Ops and Wikipedia Compliance
Goal: Reliable operations and source compliance.

### T19.1 Retention and Lifecycle Jobs
Priority: P1
- Acceptance Criteria:
  - [x] Retention policy enforced for logs, traces, artifacts, and jobs.
  - [x] Policy exceptions documented.
- Required Tests:
  - Integration: lifecycle job behavior.

### T19.2 Backup and Restore Drills
Priority: P0
- Acceptance Criteria:
  - [x] Automated backup schedule in place.
  - [x] Restore drill succeeds on schedule with verification report.
- Required Tests:
  - Non-functional: restore drill validation.

### T19.3 Wikipedia Attribution and Revision Traceability
Priority: P0
- Acceptance Criteria:
  - [x] UI/API include source attribution links and revision IDs.
  - [x] Generated artifacts retain source provenance fields.
- Required Tests:
  - Contract + E2E: attribution visibility and correctness.

## S20 Golden Evaluation Governance
Goal: Prevent silent quality regressions across model/prompt/code changes.

### T20.1 Golden Topic Set
Priority: P0
- Acceptance Criteria:
  - [x] Canonical topics across biography, history, science, technology, culture, and abstract concept domains.
  - [x] Dataset versioned and reproducible.
- Required Tests:
  - Non-functional: dataset integrity checks.

### T20.2 Quality Scoring Framework
Priority: P0
- Acceptance Criteria:
  - [x] Define measurable thresholds for summary quality, citation coverage, quiz validity, graph coherence.
  - [x] Fail/passing logic integrated into CI.
- Required Tests:
  - Integration: scorer behavior on known pass/fail fixtures.

### T20.3 Change Gating Policy
Priority: P1
- Acceptance Criteria:
  - [x] Prompt/model/runtime changes require golden-set pass.
  - [x] Emergency override process exists with expiry and follow-up requirement.
- Required Tests:
  - Non-functional: gate enforcement tests.

## Core Public Interfaces (Must Be Reflected in Tickets)
- `POST /api/study-packs`:
  - Input: `{ title_or_url, level_target?, idempotency_key }`
  - Output: `{ pack_id, job_id, accepted_at }`
- `GET /api/jobs/:id`:
  - Output: `{ status, stage, progress, attempt, retry_state, degradation_state, errors? }`
- `GET /api/study-packs/:id`:
  - Output includes `schema_version`, `source_revision_id`, `grounding_stats`, artifacts.
- `POST /api/quiz-attempts`:
  - Input: `{ pack_id, answers[] }`
  - Output: `{ score, misconceptions[], recommendations[] }`
- `GET /api/analytics/costs?window_hours=24`:
  - Output includes total cost, average cost per pack, by-stage, by-pack, and by-prompt/model breakdowns.
- `GET /api/analytics/slo`:
  - Output includes SLO target definitions and current SLO signals.
- `GET /api/metrics/outcomes`:
  - Output includes Prometheus metrics for outcomes, SLOs, stage cost, queue depth, degradation rate, and cache health.

## Controlled Taxonomy (MVP Baseline)
- Topic type: `biography`, `history`, `science`, `technology`, `culture`, `other`
- Entity type: `person`, `organization`, `event`, `concept`, `place`, `work`
- Relation type: `influenced`, `founded`, `member_of`, `occurred_in`, `related_to`, `precedes`
- Pedagogy level: `beginner`, `intermediate`, `advanced`

## Cost Management Requirements (Global)
- Per-job token budgets and per-stage time budgets are mandatory.
- Hard limit triggers graceful degradation; no silent retries beyond policy.
- Cost telemetry required per stage, per prompt version, per pack.
- Budget exceed metrics must feed alerting and dashboard visibility.

## Release Exit Criteria (MVP)
- All `P0` tickets closed with linked evidence.
- `P1` tickets for observability, cost control, reliability, and compliance closed.
- Golden-set quality gates pass on default runtime preset.
- SLO dashboards active; paging alerts + runbooks validated.
- Backup restore drill succeeded within the last release cycle.
