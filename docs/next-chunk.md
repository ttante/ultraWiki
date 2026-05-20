# Next Chunk Implementation Note

This note captures the immediate follow-on chunk so we do not lose sequencing context while allowing execution order to differ from `docs/plans.md`.

## Chunk Goal
Ship the core runtime foundation that makes later generation features reliable, testable, and scalable:
- Postgres-backed persistence and queue orchestration
- Claim/execute/retry lifecycle with `FOR UPDATE SKIP LOCKED`
- Admission/backpressure checks tied to DB state
- Keep parity with `docs/plans.md` outcomes even if order differs

## Items in This Chunk
- [x] Add repository abstraction (`memory` + `postgres`) for API runtime.
- [x] Wire API routes to runtime-selected repo (`USE_MEMORY_REPO` fallback).
- [x] Implement pending-pack creation before job enqueue (FK-safe).
- [x] Implement DB queue claim semantics with `FOR UPDATE SKIP LOCKED`.
- [x] Add queue processor loop with global concurrency cap.
- [x] Keep idempotent create semantics with TTL.
- [x] Keep retry classification + dead-letter transition behavior.
- [x] Keep reaper endpoint to recover/quarantine stale jobs.
- [x] Add explicit migration runner and run migrations in compose startup.
- [x] Replace placeholder policy gates (`golden-set`, `bench`) with real checks.
- [x] Add analytics outcomes API + Prometheus metrics + dashboard scaffold.

## Mapping Back to `docs/plans.md`
- Plan Step 1 (ingestion pipeline): now runs through real queue/persistence path.
- Plan Step 6 (persistence/history): foundational DB path is now implemented early.
- Plan Step 2 (grounded summaries): implemented in pipeline and response contract.
- Plan Step 3 (flashcards + quiz): implemented in pipeline and response contract.
- Plan Step 7 (analytics): outcomes telemetry persists quiz attempts/job outcomes in Postgres, with burn-rate alert rules and linked runbooks checked in.
- Plan Step 4 (UI tabs for overview/flashcards/quiz): implemented with Next.js tabbed experience.
- Plan Step 5 backend artifact extraction + API contract: implemented.
- Plan Step 5 visualization UI: implemented (`Concepts` tab with graph + timeline rendering).

## Immediate Next Recommended Build Order
1. Add alert-routing policy checks (severity-to-channel mapping and escalation target validation).
2. Add maintenance anomaly alerts (runtime spike, unexpectedly high prune counts, stale maintenance run).
