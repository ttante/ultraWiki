# Release Evidence - 2026-05-25

## Status
- Share/progress/graph/ops implementation snapshot: passed at `2026-05-25T10:18:20-05:00`.
- Docs and tracker sync: passed at `2026-05-25T15:04:26-05:00`.
- Ticket tracker integrity gate: passed at `2026-05-25T15:13:33-05:00`.
- Release readiness evidence refresh: passed at `2026-05-25T15:18:24-05:00`.
- Real auth and RBAC foundation: passed at `2026-05-25T17:13:16-05:00`.
- Auth finding cleanup: passed at `2026-05-25T17:36:53-05:00`.
- Data lifecycle retention refresh: passed at `2026-05-27T04:10:00-05:00`.
- Real Qwen server start: still dependent on the local GGUF model file.

## Feature Evidence
### Local Profiles, Library, Sessions, and Share Links
- UI documentation: `docs/ui.md`
- Startup/API examples: `docs/startup.md`
- Route coverage: `api/tests/routes.test.ts`, `api/tests/auth.test.ts`
- Repo coverage: `api/tests/memoryRepo.test.ts`, `api/tests/postgresRepo.test.ts`
- Persistence coverage: migrations `0015_saved_packs`, `0016_user_profiles_share_links`

Covered behavior:
- Key-based local profile creation through `/api/me`.
- Saved library reads and saves through `x-user-id`.
- OIDC/OAuth login, callback, session, and logout routes.
- Signed `ultrawiki_auth_session` cookies and bearer session token principal resolution.
- Production mode defaults legacy `x-user-id` header auth off when `AUTH_ALLOW_HEADER_USER` is unset.
- Owner permission checks for share creation and learning progress/review routes.
- Viewer share-link creation, shared pack payload reads through `/api/shared/:shareId`, and the read-only `/shared/:shareId` web page.
- Owner share management list/copy/inspect/revoke flows for saved packs.
- Share-link expiry, hashed public token persistence, and durable soft revocation with `revoked_at`.
- Account panel login/logout, display-name update, active session state, and local library-key fallback.
- Structured audit logs and Prometheus counters for auth failures, permission denials, share creation, share reads, failed share reads, and revocation.
- Current limitations documented: no rate limits for share reads and no full role matrix yet.

### Flashcard Review Progress
- UI documentation: `docs/ui.md`
- Startup/API examples: `docs/startup.md`
- Route coverage: `api/tests/routes.test.ts`
- Repo coverage: `api/tests/memoryRepo.test.ts`, `api/tests/postgresRepo.test.ts`
- Persistence coverage: migration `0017_flashcard_reviews`

Covered behavior:
- Per-card review ratings: `again`, `hard`, `good`, `easy`.
- Due-card and mastery summary returned by `/api/study-packs/:id/progress`.
- Review persistence through `/api/study-packs/:id/flashcards/:cardIndex/reviews`.

### Data Lifecycle Retention
- Policy source: `infra/retention/lifecycle-policy.json`
- Maintenance runner: `api/scripts/lifecycle-maintenance.ts`
- Gate: `npm run gate:lifecycle-retention`
- Migration coverage: `infra/sql/migrations/0009_lifecycle_retention.sql`, `infra/sql/migrations/0022_lifecycle_identity_learning_retention.sql`
- Release data-ops evidence: `infra/ops/release-data-ops.json`

Covered behavior:
- Dry-run validation prints active retention windows without requiring database access.
- DB maintenance prunes idempotency keys, failed/quarantined jobs, old generated packs, cost telemetry, stale profiles without owned data, expired/revoked share links, flashcard reviews, learning sessions, and quiz attempts.
- Policy validation requires explicit controls for user profiles, share links, and learning review data.

### Graph Search, Path Inspector, Timeline Navigator, and Ops Tab
- UI documentation: `docs/ui.md`
- Web workflow coverage: `web/tests/study-pack-app.test.tsx`
- API analytics coverage: `api/tests/routes.test.ts`, `api/tests/outcomesTelemetry.test.ts`, `api/tests/sloDefinitions.test.ts`

Covered behavior:
- Graph node search, node-type filters, and relationship filters.
- Source-evidence panel and path inspector for selected graph nodes.
- Timeline year scrubber and selected-event evidence.
- Ops dashboard calls to outcomes, cost, and SLO analytics endpoints.

### Ticket Tracker Workflow
- Tracker workflow documentation: `docs/ticket-progress.md`
- Canonical backlog instructions: `docs/tickets.md`
- Gate implementation: `api/src/domain/ticketProgressIntegrity.ts`
- Gate CLI: `api/scripts/ticket-progress-integrity.ts`
- Gate shell wrapper: `scripts/gate-ticket-progress.sh`
- Unit coverage: `api/tests/ticketProgressIntegrity.test.ts`

Covered behavior:
- `LLM_NEXT_QUEUE` rows must mirror active ticket status rows.
- Queue ranks must be sequential.
- Queue status, priority, and blocker fields must match the active table.
- Queue length must be exactly 50 rows, or all remaining active rows when fewer than 50 remain.

### Auth Proxy Finding Cleanup
- Web helper coverage: `web/tests/auth-proxy.test.ts`
- Config coverage: `api/tests/config.test.ts`

Covered behavior:
- Next auth proxy helpers forward every upstream `Set-Cookie` value separately when the runtime exposes `Headers.getSetCookie()`.
- Logout and redirect auth proxy routes preserve cookie clearing and session-setting headers.
- Legacy header auth remains enabled for local compatibility but is disabled by default in production when unset.

## Validation Commands
Latest implementation snapshot from `docs/ticket-progress.md`:

```bash
npm run typecheck --workspace @ultrawiki/api
npm run typecheck --workspace @ultrawiki/web
npm run test --workspace @ultrawiki/api
npm run test --workspace @ultrawiki/web
npm run gate:migration-safety
```

Result: passed. API: `179` tests passed. Web: `18` tests passed. Migration safety: `17` pairs passed.

Tracker integrity gate validation:

```bash
npm exec -w @ultrawiki/api vitest run tests/ticketProgressIntegrity.test.ts --coverage.enabled=false
npm run gate:ticket-progress
npm run typecheck --workspace @ultrawiki/api
npm run lint --workspace @ultrawiki/api
git diff --check
```

Result: passed.

Release evidence refresh validation:

```bash
npm exec -w @ultrawiki/api vitest run tests/releaseReadiness.test.ts --coverage.enabled=false
npm run gate:ticket-progress
npm run gate:release-readiness
npm run typecheck --workspace @ultrawiki/api
git diff --check
```

Result: passed.

Auth finding cleanup validation:

```bash
npm run typecheck --workspace @ultrawiki/api
npm run typecheck --workspace @ultrawiki/web
npm exec -w @ultrawiki/api vitest run tests/auth.test.ts tests/config.test.ts tests/routes.test.ts tests/ticketProgressIntegrity.test.ts --coverage.enabled=false
npm run test --workspace @ultrawiki/web
npm run lint --workspace @ultrawiki/api
npm run gate:ticket-progress
git diff --check
```

Result: passed.

## Remaining Release Risks
- Share-read rate limits and the full permission regression matrix remain future work.
- Legacy `x-user-id` header auth is still available for local development when `AUTH_ALLOW_HEADER_USER=1`; keep it disabled in shared or deployed environments.
- Learning sessions, analytics dashboard expansion, and Ops hardening remain active queue work.
- Real-model smoke still requires `models/qwen2.5-14b-instruct-q4_k_m.gguf` on a suitable local host.
