# UltraWiki Ticket Progress Tracker

## Purpose
This file is the operational build tracker for humans and LLM builders. It records active ticket status, implementation order, timestamps, blockers, and future work. It is optimized so an LLM can answer "what are the next X tickets?" by reading one small queue instead of scanning the full backlog.

## How To Pick The Next X Tickets
1. Read only the `LLM_NEXT_QUEUE` block first.
2. To answer "what are the next X tickets?", return the first `X` rows in rank order and include blocker information when present.
3. To implement work immediately, choose the first rows where `Status` is `next` and `Blocked By` is `None`; do not implement blocked rows unless the user explicitly approves handling the blocker first.
4. Do not scan archived tickets to choose next work unless the active queue is empty or the user explicitly asks for history.

## Required Queue Maintenance Rule
Every time any ticket status table is updated, the `LLM_NEXT_QUEUE` block must also be reviewed and updated. Keep it filled with the next 50 tickets in correct implementation order. If fewer than 50 tickets remain, include all remaining tickets.

## Ticket Reset And Archive Policy
Use ticket reset to keep the active table small and useful. When tickets are `done` or `canceled` and no longer need to stay in active context, move them out of the active status table into `docs/ticket-archive.md` or an archive section with completion metadata. Do not split by MVP vs post-MVP; archive purely by lifecycle state.

Current archive state:
- The original canonical backlog is complete and remains in `docs/tickets.md` for reference.
- This tracker should only keep active, next, in-progress, blocked, and recently completed tickets needed for current planning.
- Completed tickets should stay here only when they provide important immediate context for remaining work.

## Timestamp Policy
- `completed_at` and `last_worked_at` use local project time: America/Chicago.
- Historical completion timestamps before this tracker were not recorded per ticket. Use `pre-tracker` when exact completion time is unknown.
- Future edits should update `last_worked_at` on every touched ticket and `completed_at` only when acceptance criteria and validation are actually done.

## Status Values
- `next`: eligible upcoming work in implementation order.
- `in_progress`: currently being implemented.
- `blocked`: cannot proceed without external input or dependency.
- `planned`: accepted future work, not yet in the next execution window.
- `done`: implemented and validated.
- `canceled`: intentionally not doing.

## Last Validation Snapshot
| Timestamp | Scope | Result | Commands | Notes |
|---|---|---|---|---|
| 2026-05-25T13:11:35-05:00 | 50-ticket queue update | not run | N/A | Docs-only change. |
| 2026-05-25T12:54:02-05:00 | Docs tracker update | not run | N/A | Docs-only change. |
| 2026-05-25T10:18:20-05:00 | Share/progress/graph/ops implementation | passed | `npm run typecheck --workspace @ultrawiki/api`; `npm run typecheck --workspace @ultrawiki/web`; `npm run test --workspace @ultrawiki/api`; `npm run test --workspace @ultrawiki/web`; `npm run gate:migration-safety` | API: 179 tests passed. Web: 18 tests passed. Migration safety: 17 pairs passed. |

## LLM_NEXT_QUEUE
<!-- LLM_NEXT_QUEUE_START -->
| Rank | Ticket | Status | Priority | Depends On | Blocked By | Size | Next Action | Required Tests | Likely Files |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | T21.2 | next | P1 | T21.1 | None | S | Update docs for share links, account keys/profiles, spaced-repetition progress, graph search/path inspector, and ops tab. | Docs review; targeted UI smoke if docs reference changed flows. | `docs/ui.md`, `docs/startup.md`, `docs/tickets.md`, `docs/ticket-progress.md` |
| 2 | T21.3 | next | P1 | T21.2 | T21.2 | S | Add a tracker integrity gate that verifies queue rows match active tickets and that the queue has 50 rows or all remaining rows. | Script/unit test for parser; docs gate if wired. | `scripts/*`, `package.json`, `docs/ticket-progress.md` |
| 3 | T21.4 | next | P1 | T21.2 | T21.2 | S | Refresh release/readiness evidence for share/progress/ops features and tracker workflow. | Docs review; release readiness gate if updated. | `docs/release-readiness.md`, `docs/release-evidence-*.md`, `docs/ticket-progress.md` |
| 4 | T22.1 | next | P0 | T21.2 | Auth provider decision | L | Decide/authenticate local users with sessions, replace key-only trust where needed, add owner/viewer/editor permission checks and audit logs. | API auth tests; web auth state tests; security event tests; typecheck. | `api/src/routes/api.ts`, `api/src/repo/*`, `api/src/contracts/studyPack.ts`, `web/components/study-pack-app.tsx`, `web/app/api/*` |
| 5 | T22.2 | next | P1 | T22.1 | T22.1 | M | Build `/shared/[shareId]` read-only frontend page with missing/expired states and save-to-library action. | Web page tests; API proxy tests if added; typecheck. | `web/app/shared/[shareId]/page.tsx`, `web/app/api/shared/[shareId]/route.ts`, `web/components/*`, `web/tests/*` |
| 6 | T22.3 | next | P1 | T22.1, T22.2 | T22.1 | M | Add share management UI for owners to list, copy, revoke, and inspect share links. | API route tests; web interaction tests; permission tests. | `api/src/routes/api.ts`, `api/src/repo/*`, `web/components/*`, `web/tests/*` |
| 7 | T22.4 | next | P1 | T22.1 | T22.1 | M | Add share expiry, revocation, and hashed-token persistence. | Migration safety; repo tests; API security tests. | `infra/sql/migrations/*`, `api/src/repo/*`, `api/src/routes/api.ts` |
| 8 | T22.5 | next | P1 | T22.1 | T22.1 | M | Add account settings and session UX for login/logout, display name, and active account state. | Web auth/session tests; API profile tests. | `web/components/*`, `web/app/api/me/route.ts`, `api/src/routes/api.ts` |
| 9 | T22.6 | next | P1 | T22.1 | T22.1 | M | Emit audit logs and metrics for auth, permission failures, share creation, share reads, and revocation. | Logger tests; metrics tests; security event tests. | `api/src/logger.ts`, `api/src/routes/api.ts`, `api/src/telemetry/*` |
| 10 | T22.7 | next | P1 | T22.1 | T22.1 | M | Add permission regression matrix covering owner, viewer, editor, anonymous, expired, revoked, and wrong-user flows. | API integration matrix; web access-state tests. | `api/tests/routes.test.ts`, `web/tests/*`, `api/tests/security.test.ts` |
| 11 | T23.1 | next | P1 | T21.2 | None | L | Add due-card learning session mode with ordered queue, completion state, session metrics, and mastery trend. | API progress/session tests; repo tests; web workflow tests; migration safety if schema changes. | `api/src/repo/*`, `api/src/routes/api.ts`, `api/src/contracts/studyPack.ts`, `web/components/study-pack-app.tsx`, `infra/sql/migrations/*` |
| 12 | T23.2 | next | P1 | T23.1 | T23.1 | M | Formalize due queue scheduling policy with deterministic intervals, overdue ordering, and rating transitions. | Unit tests for scheduler; repo tests. | `api/src/domain/*`, `api/src/repo/*`, `api/tests/*` |
| 13 | T23.3 | next | P1 | T23.1 | T23.1 | M | Persist learning sessions with started/completed timestamps, reviewed counts, and session outcomes. | Migration safety; repo tests; API tests. | `infra/sql/migrations/*`, `api/src/repo/*`, `api/src/routes/api.ts` |
| 14 | T23.4 | next | P1 | T23.1 | T23.1 | M | Add quiz retakes and mastery trend tracking across attempts and card reviews. | API analytics tests; repo tests; web tests. | `api/src/repo/*`, `api/src/routes/api.ts`, `web/components/*` |
| 15 | T23.5 | next | P1 | T23.3 | T23.3 | M | Add per-user learning analytics API for due count, streak, retention, mastery, and accuracy trend. | API contract tests; repo tests; analytics tests. | `api/src/contracts/studyPack.ts`, `api/src/routes/api.ts`, `api/src/repo/*` |
| 16 | T23.6 | next | P1 | T23.5 | T23.5 | M | Add learning dashboard UI with due cards, trend chart, review history, and weak areas. | Web component tests; accessibility checks. | `web/components/*`, `web/tests/study-pack-app.test.tsx`, `web/app/globals.css` |
| 17 | T23.7 | next | P2 | T23.3 | T23.3 | M | Add study goals and streak tracking with configurable daily targets. | API tests; web tests. | `api/src/repo/*`, `api/src/routes/api.ts`, `web/components/*` |
| 18 | T23.8 | next | P2 | T23.1 | T23.1 | S | Enhance exports to include reviewed/due state for Anki or study progress exports. | Export unit tests; API route tests. | `api/src/domain/studyPackExport.ts`, `api/src/routes/api.ts`, `api/tests/studyPackExport.test.ts` |
| 19 | T23.9 | next | P2 | T23.5 | T23.5 | M | Add reminder hooks for due-card counts without external notification dependency. | API tests; web status tests. | `api/src/routes/api.ts`, `web/components/*` |
| 20 | T24.1 | next | P1 | T21.2 | None | M | Harden Ops tab with time-window filters, SLO pass/fail badges, cost drilldowns, fallback/error tables, and security/rate-limit metrics. | API analytics tests; web dashboard tests; monitoring gate if config changes. | `api/src/routes/api.ts`, `api/src/telemetry/*`, `web/components/study-pack-app.tsx`, `web/app/api/analytics/*` |
| 21 | T24.2 | next | P1 | T24.1 | T24.1 | M | Add cost drilldown API by pack, prompt version, model, stage, and time window. | API analytics tests; repo tests. | `api/src/routes/api.ts`, `api/src/repo/*`, `api/tests/routes.test.ts` |
| 22 | T24.3 | next | P1 | T24.1 | T24.1 | M | Add SLO status badges, target comparison, and error budget burn indicators. | Domain tests; web dashboard tests. | `api/src/domain/slo.ts`, `web/components/*`, `web/tests/*` |
| 23 | T24.4 | next | P1 | T24.1 | T24.1 | M | Add security and rate-limit metrics to ops analytics and UI. | Security metrics tests; web dashboard tests. | `api/src/domain/security.ts`, `api/src/telemetry/*`, `web/components/*` |
| 24 | T24.5 | next | P2 | T24.1 | T24.1 | S | Add ops runbook deep links from dashboard panels to checked-in runbooks. | Web tests; docs link validation. | `web/components/*`, `docs/*`, `infra/monitoring/runbooks/*` |
| 25 | T24.6 | next | P2 | T24.2 | T24.2 | M | Add admin filters and CSV export for ops tables. | Web tests; export tests. | `web/components/*`, `web/app/api/analytics/*`, `api/src/routes/api.ts` |
| 26 | T25.1 | next | P1 | T22.1 | T22.1 permission model | M | Define retention lifecycle for profiles, share links, and learning review data; add dry-run/maintenance coverage. | Lifecycle retention tests; migration safety; release data ops gate. | `api/src/domain/lifecycleRetention.ts`, `api/scripts/*`, `infra/sql/migrations/*`, `docs/*` |
| 27 | T25.2 | next | P1 | T22.1 | T22.1 permission model | M | Harden share links with expiry, revocation, token hashing, rate limits, and security events. | API security tests; repo tests; adversarial/security gate if updated. | `api/src/routes/api.ts`, `api/src/repo/*`, `api/src/domain/security.ts`, `infra/sql/migrations/*` |
| 28 | T25.3 | next | P1 | T22.1, T25.1 | T22.1 | L | Add user data export/delete flows for profiles, library, shares, attempts, and learning reviews. | API tests; lifecycle tests; web tests. | `api/src/routes/api.ts`, `api/src/repo/*`, `web/components/*`, `docs/*` |
| 29 | T25.4 | next | P1 | T25.1 | T25.1 | M | Extend backup/restore drills to cover profiles, shares, reviews, sessions, and analytics rollups. | Backup drill gate; restore verification tests. | `api/src/domain/backupDrill.ts`, `scripts/*`, `docs/*` |
| 30 | T25.5 | next | P2 | T25.1 | T25.1 | M | Add data repair/backfill tooling for share links, learning progress, and profile records. | Script tests; dry-run tests. | `api/scripts/*`, `api/src/repo/*`, `docs/*` |
| 31 | T26.1 | next | P1 | T21.2 | None | M | Audit UI empty, loading, partial, error, and offline states across all tabs and rails. | Web component tests; accessibility checks. | `web/components/study-pack-app.tsx`, `web/tests/*`, `web/app/globals.css` |
| 32 | T26.2 | next | P1 | T26.1 | T26.1 | M | Complete accessibility pass for keyboard navigation, labels, focus states, contrast, and reduced motion. | Web accessibility/unit tests; manual checklist docs. | `web/components/*`, `web/app/globals.css`, `docs/ui.md` |
| 33 | T26.3 | next | P1 | T26.1 | T26.1 | M | Polish responsive and mobile layouts for graph, flashcards, quiz, library, and ops dashboard. | Web responsive tests where practical; visual/manual checklist. | `web/app/globals.css`, `web/components/*`, `docs/ui.md` |
| 34 | T26.4 | next | P2 | T26.1 | T26.1 | S | Add citation stream search/filter and evidence grouping by artifact type. | Web component tests. | `web/components/study-pack-app.tsx`, `web/tests/*` |
| 35 | T26.5 | next | P2 | T26.2 | T26.2 | M | Add keyboard shortcuts for search, tabs, graph controls, flashcard review, and quiz grading. | Web interaction tests; accessibility docs. | `web/components/*`, `web/tests/*`, `docs/ui.md` |
| 36 | T26.6 | next | P2 | T26.3 | T26.3 | M | Add lightweight visual regression or screenshot smoke coverage for critical UI states. | Visual/smoke test gate. | `web/tests/*`, `scripts/*`, `package.json` |
| 37 | T27.1 | next | P1 | T24.1 | T24.1 | M | Add local LLM runtime health panel showing provider, model, latency, fallback count, and timeout status. | API health tests; web dashboard tests. | `api/src/domain/localLlmDoctor.ts`, `api/src/routes/api.ts`, `web/components/*` |
| 38 | T27.2 | next | P1 | T27.1 | T27.1 | M | Add model selection/preset visibility for Qwen 2.5 14B on RTX 4080 and fallback modes. | Config tests; web tests. | `api/src/domain/runtimePreset.ts`, `api/src/config.ts`, `web/components/*` |
| 39 | T27.3 | next | P2 | T7.2, T24.1 | T24.1 | M | Add prompt evaluation UI surfacing golden-set results and prompt/model regressions. | API eval tests; web tests. | `api/src/domain/promptEvaluation.ts`, `api/src/routes/api.ts`, `web/components/*` |
| 40 | T27.4 | next | P2 | T27.1 | T27.1 | M | Add real-model smoke trigger/status from API or UI with safe local-only controls. | API route tests; smoke script tests; docs. | `api/src/routes/api.ts`, `scripts/*`, `docs/startup.md` |
| 41 | T27.5 | next | P2 | T23.5, T27.3 | T23.5 | M | Add generation quality feedback loop from users into eval data without contaminating trusted artifacts. | API tests; data governance tests; web tests. | `api/src/repo/*`, `api/src/domain/promptEvaluation.ts`, `web/components/*` |
| 42 | T28.1 | next | P1 | T22.1, T23.5 | T22.1 | M | Review API pagination, indexes, and query limits for library, shares, progress, analytics, and ops endpoints. | Repo tests; Postgres query tests; migration safety if indexes added. | `api/src/repo/postgres.ts`, `infra/sql/migrations/*`, `api/tests/postgresRepo.test.ts` |
| 43 | T28.2 | next | P1 | T12.2 | None | M | Add queue/worker concurrency soak tests for retries, resume, cache hits, and local LLM fallback. | Reliability tests; benchmark gate if affected. | `api/tests/reliability.test.ts`, `scripts/*`, `api/src/routes/api.ts` |
| 44 | T28.3 | next | P2 | T14.3, T24.1 | T24.1 | M | Add cache invalidation admin controls and observability for stale artifact repair. | API tests; web admin tests. | `api/src/repo/*`, `api/src/routes/api.ts`, `web/components/*` |
| 45 | T28.4 | next | P1 | T22.1 | T22.1 | M | Add rate-limiting middleware for generation, share reads, auth/session operations, and analytics endpoints. | API security tests; metrics tests. | `api/src/routes/api.ts`, `api/src/domain/security.ts`, `api/tests/*` |
| 46 | T28.5 | next | P1 | T21.2, T22.2, T23.1, T24.1 | T22.2, T23.1, T24.1 | M | Add end-to-end smoke covering create pack, save, share, review due cards, quiz, and ops status. | Smoke script; web/API integration tests. | `scripts/*`, `web/tests/*`, `api/tests/routes.test.ts` |
| 47 | T29.1 | next | P1 | T22.1 | T22.1 | M | Add saved library search, filters, sorting, and readiness/progress facets. | API list tests; web tests. | `api/src/routes/api.ts`, `api/src/repo/*`, `web/components/*` |
| 48 | T29.2 | next | P2 | T29.1 | T29.1 | M | Add pack tags and collections for organizing saved study packs. | Migration safety; API tests; web tests. | `infra/sql/migrations/*`, `api/src/repo/*`, `web/components/*` |
| 49 | T29.3 | next | P2 | T29.1 | T29.1 | M | Add pack compare/version history for regenerated packs and source revision changes. | API tests; UI tests; contract tests. | `api/src/repo/*`, `api/src/routes/api.ts`, `web/components/*` |
| 50 | T29.4 | next | P2 | T12.2, T29.1 | T29.1 | L | Add topic-list import and safe batch generation with queue/backpressure visibility. | API queue tests; web workflow tests; smoke tests. | `api/src/routes/api.ts`, `api/src/repo/*`, `web/components/*`, `scripts/*` |
<!-- LLM_NEXT_QUEUE_END -->

## Active Ticket Status
| Ticket | Title | Status | Priority | last_worked_at | completed_at | Blockers | Next Action | Future Work / Notes |
|---|---|---|---|---|---|---|---|---|
| T21.1 | Ticket Progress Tracker | done | P1 | 2026-05-25T12:54:02-05:00 | 2026-05-25T12:54:02-05:00 | None | Keep tracker current. | This ticket created the active tracker, queue rules, and reset/archive policy. Keep in active table briefly because it defines current process. |
| T21.2 | Docs and Tracker Sync | next | P1 | 2026-05-25T13:11:35-05:00 |  | None | Update user-facing and builder-facing docs for latest share/progress/graph/ops features. | Include exact UI usage, local startup implications, and ticket tracker update instructions. |
| T21.3 | Ticket Tracker Integrity Gate | next | P1 | 2026-05-25T13:11:35-05:00 |  | T21.2 | Add validation that queue and active table stay synchronized. | Should enforce 50-or-all queue rule. |
| T21.4 | Release Evidence Refresh | next | P1 | 2026-05-25T13:11:35-05:00 |  | T21.2 | Refresh evidence docs for recent platform changes. | Keep release context accurate for future builders. |
| T22.1 | Real Auth and RBAC | next | P0 | 2026-05-25T13:11:35-05:00 |  | Auth provider decision | Decide provider and implement sessions plus permission checks. | Current local account key/profile system is only a foundation. |
| T22.2 | Shared Pack Frontend Page | next | P1 | 2026-05-25T13:11:35-05:00 |  | T22.1 | Build `/shared/[shareId]` page and tests. | Can prototype with existing share API, but final behavior should align with T22.1. |
| T22.3 | Share Management UI | next | P1 | 2026-05-25T13:11:35-05:00 |  | T22.1 | Add owner share management. | Includes list/copy/revoke/inspect flows. |
| T22.4 | Share Expiry, Revocation, and Hashing | next | P1 | 2026-05-25T13:11:35-05:00 |  | T22.1 | Harden share-link persistence. | Requires migration and compatibility handling. |
| T22.5 | Account Settings and Session UX | next | P1 | 2026-05-25T13:11:35-05:00 |  | T22.1 | Add visible account/session controls. | Should avoid hiding current local-first behavior. |
| T22.6 | Auth and Sharing Audit Logs | next | P1 | 2026-05-25T13:11:35-05:00 |  | T22.1 | Add logs/metrics for auth/share events. | Include permission-denied paths. |
| T22.7 | Permission Regression Matrix | next | P1 | 2026-05-25T13:11:35-05:00 |  | T22.1 | Add coverage for role/access combinations. | Should block RBAC regressions. |
| T23.1 | Learning Session Mode | next | P1 | 2026-05-25T13:11:35-05:00 |  | None | Add due-card session workflow. | Existing reviews/progress are per-card; session workflow is not built. |
| T23.2 | Due Queue Scheduling Policy | next | P1 | 2026-05-25T13:11:35-05:00 |  | T23.1 | Formalize scheduling rules. | Should remain deterministic and testable. |
| T23.3 | Learning Session Persistence | next | P1 | 2026-05-25T13:11:35-05:00 |  | T23.1 | Persist session records and outcomes. | Likely needs migrations. |
| T23.4 | Quiz Retake and Mastery Trend | next | P1 | 2026-05-25T13:11:35-05:00 |  | T23.1 | Track retakes and trend signals. | Integrate quiz attempts with card mastery. |
| T23.5 | Learning Analytics API | next | P1 | 2026-05-25T13:11:35-05:00 |  | T23.3 | Add per-user learning analytics endpoint. | Enables dashboard and reminders. |
| T23.6 | Learning Dashboard UI | next | P1 | 2026-05-25T13:11:35-05:00 |  | T23.5 | Add dashboard for due cards and mastery. | Should be mobile-friendly. |
| T23.7 | Study Goals and Streaks | next | P2 | 2026-05-25T13:11:35-05:00 |  | T23.3 | Add goals/streak tracking. | Keep optional and non-punitive. |
| T23.8 | Progress-Aware Exports | next | P2 | 2026-05-25T13:11:35-05:00 |  | T23.1 | Include reviewed/due data in exports. | Useful for Anki and backups. |
| T23.9 | Due Reminder Hooks | next | P2 | 2026-05-25T13:11:35-05:00 |  | T23.5 | Add local reminder data hooks. | No external notification provider yet. |
| T24.1 | Ops Dashboard Hardening | next | P1 | 2026-05-25T13:11:35-05:00 |  | None | Add filters, drilldowns, badges, and operational tables. | Current Ops tab is a useful scaffold, not an admin console. |
| T24.2 | Cost Drilldown API | next | P1 | 2026-05-25T13:11:35-05:00 |  | T24.1 | Expose cost by pack/prompt/model/stage/window. | Supports admin UI. |
| T24.3 | SLO Status and Error Budget Burn | next | P1 | 2026-05-25T13:11:35-05:00 |  | T24.1 | Show pass/fail and burn indicators. | Tie to existing SLO definitions. |
| T24.4 | Security and Rate-Limit Metrics | next | P1 | 2026-05-25T13:11:35-05:00 |  | T24.1 | Add security/rate-limit metrics to ops. | Coordinates with T28.4. |
| T24.5 | Ops Runbook Deep Links | next | P2 | 2026-05-25T13:11:35-05:00 |  | T24.1 | Link panels to runbooks. | Keep docs links checked. |
| T24.6 | Admin Filters and CSV Export | next | P2 | 2026-05-25T13:11:35-05:00 |  | T24.2 | Add filters and CSV export. | Useful for support workflows. |
| T25.1 | Share and Learning Retention Policy | next | P1 | 2026-05-25T13:11:35-05:00 |  | T22.1 permission model | Define lifecycle policy and maintenance jobs for new data. | Should update data-ops/release evidence. |
| T25.2 | Share-Link Security Hardening | next | P1 | 2026-05-25T13:11:35-05:00 |  | T22.1 permission model | Add expiry, revocation, hashing, rate limits, and security events. | Should coordinate with auth and sharing UX. |
| T25.3 | User Data Export/Delete | next | P1 | 2026-05-25T13:11:35-05:00 |  | T22.1 | Add privacy and data lifecycle flows. | Covers profiles, library, shares, attempts, reviews. |
| T25.4 | Backup Coverage For New Tables | next | P1 | 2026-05-25T13:11:35-05:00 |  | T25.1 | Extend backup/restore drills. | Include profile/share/review/session data. |
| T25.5 | Data Repair and Backfill Tooling | next | P2 | 2026-05-25T13:11:35-05:00 |  | T25.1 | Add dry-run repair scripts. | Should be safe by default. |
| T26.1 | UI Empty/Error State Audit | next | P1 | 2026-05-25T13:11:35-05:00 |  | None | Audit all user-visible states. | Include offline and partial data states. |
| T26.2 | Accessibility Pass | next | P1 | 2026-05-25T13:11:35-05:00 |  | T26.1 | Improve keyboard, focus, labels, contrast, reduced motion. | Document manual checks. |
| T26.3 | Responsive and Mobile Polish | next | P1 | 2026-05-25T13:11:35-05:00 |  | T26.1 | Polish graph, deck, quiz, library, ops on small screens. | Preserve design direction. |
| T26.4 | Citation Stream Search and Grouping | next | P2 | 2026-05-25T13:11:35-05:00 |  | T26.1 | Add citation filtering/grouping. | If already partially present, reconcile and test. |
| T26.5 | Keyboard Shortcuts | next | P2 | 2026-05-25T13:11:35-05:00 |  | T26.2 | Add shortcuts for core study actions. | Must not harm accessibility. |
| T26.6 | Visual Regression Smoke | next | P2 | 2026-05-25T13:11:35-05:00 |  | T26.3 | Add screenshot or visual smoke coverage. | Keep lightweight. |
| T27.1 | Local LLM Runtime Health Panel | next | P1 | 2026-05-25T13:11:35-05:00 |  | T24.1 | Surface model/provider health. | Connect to existing doctor/runtime config. |
| T27.2 | Model Selection Presets UI | next | P1 | 2026-05-25T13:11:35-05:00 |  | T27.1 | Show Qwen/RTX preset state and fallback mode. | Avoid unsafe runtime mutation initially. |
| T27.3 | Prompt Evaluation UI | next | P2 | 2026-05-25T13:11:35-05:00 |  | T24.1 | Surface eval/golden-set results. | Keep tied to existing eval harness. |
| T27.4 | Real-Model Smoke Trigger | next | P2 | 2026-05-25T13:11:35-05:00 |  | T27.1 | Add safe local smoke trigger/status. | Must be guarded for local/dev only. |
| T27.5 | Quality Feedback Loop | next | P2 | 2026-05-25T13:11:35-05:00 |  | T23.5 | Capture user feedback for eval without contaminating artifacts. | Needs governance. |
| T28.1 | API Pagination and Index Review | next | P1 | 2026-05-25T13:11:35-05:00 |  | T22.1 | Review indexes/query limits for new endpoints. | Performance hardening. |
| T28.2 | Queue and Worker Soak Tests | next | P1 | 2026-05-25T13:11:35-05:00 |  | None | Add concurrency/retry/resume/cache/fallback soak coverage. | Supports reliability. |
| T28.3 | Cache Invalidation Admin Controls | next | P2 | 2026-05-25T13:11:35-05:00 |  | T24.1 | Add stale artifact repair controls. | Admin-only surface. |
| T28.4 | Rate Limiting Middleware | next | P1 | 2026-05-25T13:11:35-05:00 |  | T22.1 | Protect generation, share reads, auth, and analytics. | Emit metrics for T24.4. |
| T28.5 | Full Critical-Flow Smoke | next | P1 | 2026-05-25T13:11:35-05:00 |  | T22.2, T23.1, T24.1 | Smoke create/save/share/review/quiz/ops. | Should become a standard gate. |
| T29.1 | Library Search and Filters | next | P1 | 2026-05-25T13:11:35-05:00 |  | T22.1 | Add saved library search/filter/sort. | Include readiness/progress facets. |
| T29.2 | Pack Tags and Collections | next | P2 | 2026-05-25T13:11:35-05:00 |  | T29.1 | Organize saved packs into tags/collections. | Likely migration. |
| T29.3 | Pack Compare and Version History | next | P2 | 2026-05-25T13:11:35-05:00 |  | T29.1 | Compare regenerated packs/source revisions. | Useful for source changes. |
| T29.4 | Topic List Import and Batch Generation | next | P2 | 2026-05-25T13:11:35-05:00 |  | T29.1 | Add safe batch generation with queue visibility. | Respect backpressure. |

## Recently Completed Context
| Ticket | Title | completed_at | Validation | Why It Remains Here |
|---|---|---|---|---|
| T22.0 | Local Account/Profile and Share-Link Foundation | 2026-05-25T10:18:20-05:00 | API/web typecheck and tests passed; migration safety passed. | Provides immediate context for T22.1/T22.2. |
| T23.0 | Flashcard Review Progress Foundation | 2026-05-25T10:18:20-05:00 | API/web typecheck and tests passed; migration safety passed. | Provides immediate context for T23.1. |
| T24.0 | Graph Search, Path Inspector, and Ops Tab Scaffold | 2026-05-25T10:18:20-05:00 | API/web typecheck and tests passed; migration safety passed. | Provides immediate context for T24.1. |

## Work Log
| Timestamp | Ticket | Status Change | Summary | Validation |
|---|---|---|---|---|
| 2026-05-25T13:11:35-05:00 | T21.1 | done -> done | Expanded `LLM_NEXT_QUEUE` to 50 ranked tickets and mirrored active status rows. | Docs-only; not run. |
| 2026-05-25T12:54:02-05:00 | T21.1 | created -> done | Created operational tracker, active table, LLM queue, and update rules. | Docs-only; not run. |
| 2026-05-25T10:18:20-05:00 | T22.0/T23.0/T24.0 | in_progress -> done | Added local profiles/share links, flashcard spaced-repetition progress, graph search/path inspector, and Ops tab scaffold. | API/web typecheck and tests passed; migration safety passed. |

## Update Checklist For Future Builders
- Update `Active Ticket Status` before the final response whenever any ticket status changes.
- Update `LLM_NEXT_QUEUE` every time `Active Ticket Status` changes.
- Keep `LLM_NEXT_QUEUE` filled with the next 50 tickets in implementation order, or all remaining tickets if fewer than 50 remain.
- If a ticket is touched but not completed, update `last_worked_at`, status, blocker, and next action.
- If a new future task is discovered, add it to `Active Ticket Status` and insert it into `LLM_NEXT_QUEUE` at the correct rank.
- Move old `done` or `canceled` tickets out of active status during ticket reset; archive by lifecycle state, not by MVP/post-MVP category.
- Never mark `done` without tests or a documented reason why tests are not applicable.
