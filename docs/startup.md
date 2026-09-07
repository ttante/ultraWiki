# UltraWiki Local Startup Guide

This guide covers everything needed to run UltraWiki locally from a fresh checkout.

## What Runs Locally
- `web`: Next.js UI on `http://localhost:3000`
- `api`: Node/TypeScript API on `http://localhost:4000`
- `worker`: FastAPI helper service on `http://localhost:8000`
- `postgres`: Postgres 16 on `localhost:5432`
- `llm`: OpenAI-compatible mock server on `http://localhost:8080`
- Optional `llama`: llama.cpp server profile on `http://localhost:8080` when the mock `llm` service is not using that port
- Optional monitoring: Prometheus on `9090`, Alertmanager on `9093`, Pushgateway on `9091`

By default the API uses the deterministic `rule_based` artifact generator so the app works without a model download. Set `LLM_PROVIDER=openai_compatible` to route summaries, knowledge extraction, glossary generation, flashcards, and quiz generation through an OpenAI-compatible local model server. If the model is unavailable or returns invalid JSON, the API falls back to deterministic artifacts; real-model eval and real-LLM smoke fail when fallback is used.

Generation jobs preserve completed artifacts at budget boundaries. If a job exceeds `TOKEN_BUDGET_PER_JOB` or `LATENCY_BUDGET_MS` after summaries, graph, or flashcards, the API marks the job completed with `degradation_state=partial` and the UI can resume missing artifacts later.

The local app also persists profile, library, sharing, and learning-progress data in Postgres. The API supports OIDC/OAuth-backed session cookies for authenticated profile, library, share, learning-progress, and user-data export/delete routes. The web UI exposes an account panel for login/logout, display-name updates, active session state, data export/delete controls, and the local `ultrawiki_user_id` library-key fallback; that header path is a development compatibility mode controlled by `AUTH_ALLOW_HEADER_USER`.

## Prerequisites
- Docker and Docker Compose v2
- Node.js 20+
- npm
- Python 3.12+
- `curl`
- Internet access from the API container/process for Wikipedia fetches
- For monitoring config validation: Docker must be able to pull `prom/prometheus:v2.54.1` and `prom/alertmanager:v0.27.0`
- For real local llama.cpp runtime: a GGUF model file under `./models`

## First-Time Setup
From the repository root:

```bash
cp .env.example .env
npm install --workspaces
python -m pip install -r worker/requirements.txt
```

The checked-in `.env.example` is valid for Docker Compose defaults. For normal Docker startup you can leave it as-is.

## Auth Configuration
Default local startup keeps legacy library-key headers enabled so the current UI can continue to save packs and progress:

```bash
AUTH_ALLOW_HEADER_USER=1
AUTH_SESSION_SECRET=dev-only-ultrawiki-session-secret
AUTH_SESSION_TTL_SECONDS=86400
ADMIN_USER_IDS=
TRUST_PROXY=0
SHARE_TOKEN_SECRET=dev-only-ultrawiki-share-token-secret
SHARE_LINK_TTL_SECONDS=604800
SHARE_READ_RATE_LIMIT_WINDOW_SECONDS=60
SHARE_READ_RATE_LIMIT_MAX=120
SHARE_READ_FAILED_RATE_LIMIT_MAX=20
GENERATION_RATE_LIMIT_WINDOW_SECONDS=60
GENERATION_RATE_LIMIT_MAX=30
AUTH_RATE_LIMIT_WINDOW_SECONDS=60
AUTH_RATE_LIMIT_MAX=120
ANALYTICS_RATE_LIMIT_WINDOW_SECONDS=60
ANALYTICS_RATE_LIMIT_MAX=240
```

If `AUTH_ALLOW_HEADER_USER` is unset, production mode defaults it to `0`. Keep it disabled for any deployed or shared environment unless you intentionally want development-only `x-user-id` identity headers accepted.

`ADMIN_USER_IDS` is a comma-separated allowlist for operational admin routes such as cache invalidation. Non-production mode permits any authenticated session or local header principal when the allowlist is empty; production requires a matching user ID.

`SHARE_TOKEN_SECRET` signs deterministic public share tokens while the database stores only token hashes. Keep it stable for the lifetime of active share links. `SHARE_LINK_TTL_SECONDS` controls the default expiry assigned to new share links. `SHARE_READ_RATE_LIMIT_*` settings bound public shared-pack reads and repeated failed token probes; exceeded limits return `429` and emit audited `rate_limit.share_read_exceeded` events. `GENERATION_RATE_LIMIT_*`, `AUTH_RATE_LIMIT_*`, and `ANALYTICS_RATE_LIMIT_*` protect generation/resume, auth session, and Ops analytics routes with the same `429` and `Retry-After` behavior while emitting `rate_limit.*_exceeded` security metrics. Leave `TRUST_PROXY=0` unless the API is behind a trusted reverse proxy that overwrites forwarded address headers; when enabled, Express uses its trusted proxy handling for client IPs.

To enable real login, configure an OIDC/OAuth provider by setting all of:

```bash
OIDC_ISSUER=your-issuer-id
OIDC_AUTHORIZATION_URL=https://provider.example/authorize
OIDC_TOKEN_URL=https://provider.example/token
OIDC_USERINFO_URL=https://provider.example/userinfo
OIDC_CLIENT_ID=ultrawiki
OIDC_CLIENT_SECRET=...
OIDC_REDIRECT_URI=http://localhost:4000/api/auth/callback
OIDC_SCOPE="openid profile email"
```

With those values present, `GET /api/auth/login` redirects to the provider, `GET /api/auth/callback` creates an HttpOnly `ultrawiki_auth_session` cookie, `GET /api/auth/session` returns the active account, and `POST /api/auth/logout` clears the session. Set `AUTH_ALLOW_HEADER_USER=0` when you want protected routes to reject unauthenticated legacy `x-user-id` calls in local mode.

## Recommended Startup: Docker Compose
Start the full default stack:

```bash
docker compose up --build
```

This starts `postgres`, `api`, `web`, `worker`, and `llm`.

The API and web images build from the repository root workspace lockfile, run production start commands, and mount the prompt registry at `./infra/prompts` so prompt edits are visible after container restart.

The API applies SQL migrations automatically on startup because `RUN_MIGRATIONS=1` is set by default. In Compose, the API uses:

```bash
DATABASE_URL=postgresql://ultrawiki:ultrawiki@postgres:5432/ultrawiki
MIGRATIONS_DIR=/infra/sql/migrations
```

The current migrations include local-first product tables for:

- `saved_packs`: key-based saved library membership.
- `user_profiles`: profile records keyed by authenticated OIDC user IDs or legacy local library keys.
- `share_links`: viewer/editor share metadata tied to owner user IDs, hashed public tokens, expiry, and revocation timestamps.
- `quiz_attempts`: per-user quiz attempts with retake numbers, selected answers, accuracy deltas, and combined card/quiz mastery trend snapshots.
- `flashcard_reviews`: per-card spaced-repetition ratings and due timestamps.
- `learning_sessions`: persisted due-card sessions with started/completed timestamps, reviewed counts, and outcome snapshots.
- `study_goals`: optional per-user daily review targets for the Learning dashboard.

## Health Checks
After startup, check:

```bash
curl -fsS http://localhost:3000/api/health
curl -fsS http://localhost:4000/health
curl -fsS http://localhost:8000/health
curl -fsS http://localhost:8080/health
```

Expected services:
- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- Worker: `http://localhost:8000`
- Mock LLM: `http://localhost:8080`

Then open:

```text
http://localhost:3000
```

Enter an English Wikipedia title such as `Alan Turing` or an English Wikipedia URL.

## One-Command Smoke Test
The smoke script starts the Docker stack, checks health, then tears the stack down with volumes:

```bash
npm run smoke
```

This is useful for validating a clean local environment. Because it runs `docker compose down -v` on exit, it deletes the local Compose Postgres volume.

Smoke uses isolated host ports so it can run even if your normal local stack or host Postgres is already bound:
- Web: `http://localhost:13000`
- API: `http://localhost:14000`
- Postgres host port: `15432`
- Worker: `http://localhost:18000`
- Mock LLM: `http://localhost:18080`

Override these with `WEB_HOST_PORT`, `API_HOST_PORT`, `POSTGRES_HOST_PORT`, `WORKER_HOST_PORT`, or `LLM_HOST_PORT` when needed.

To validate the full topic-to-study-pack flow, run:

```bash
npm run smoke:study-pack
```

This uses isolated ports, creates an `Alan Turing` study pack, waits for the job to complete, fetches the pack, and verifies summaries, glossary terms, graph, timeline, flashcards, quiz questions, misconception checks, provenance, cache metadata, cost analytics, and Prometheus metrics.
The smoke script sets higher smoke-only defaults for `TOKEN_BUDGET_PER_JOB` and `LATENCY_BUDGET_MS` so a full live Wikipedia article can complete all artifact groups; you can still override those environment variables before running it.

For a faster deterministic CI gate over the product-critical route and app shell workflow, run:

```bash
npm run gate:critical-flow-smoke
```

This runs targeted API and web tests covering study-pack creation, saved-library persistence, share-link creation/read, due-card review, quiz attempt persistence, and Ops status loading.

## Running Detached
Start in the background:

```bash
docker compose up -d --build
```

Follow logs:

```bash
docker compose logs -f api web worker postgres llm
```

Stop without deleting volumes:

```bash
docker compose down
```

Stop and delete volumes:

```bash
docker compose down -v
```

## Local Development Without Docker for App Services
You can run Postgres in Docker and run app services directly on the host.

Start only Postgres and mock LLM:

```bash
docker compose up -d postgres llm
```

For host-run API, use `localhost` in `DATABASE_URL`:

```bash
export DATABASE_URL=postgresql://ultrawiki:ultrawiki@localhost:5432/ultrawiki
export RUN_MIGRATIONS=1
export MIGRATIONS_DIR=../infra/sql/migrations
npm run dev --workspace @ultrawiki/api
```

Run web in another terminal:

```bash
export API_BASE_URL=http://localhost:4000
export NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
npm run dev --workspace @ultrawiki/web
```

Run worker in another terminal:

```bash
cd worker
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Running API Without Postgres
For quick API-only development, use the in-memory repo:

```bash
export USE_MEMORY_REPO=1
export RUN_MIGRATIONS=0
npm run dev --workspace @ultrawiki/api
```

This does not persist data across process restarts and bypasses Postgres behavior, so use Postgres for queue, migration, and persistence work.

## Manual Migrations
When the API starts with `RUN_MIGRATIONS=1`, migrations run automatically.

To run migrations manually against host Postgres:

```bash
export DATABASE_URL=postgresql://ultrawiki:ultrawiki@localhost:5432/ultrawiki
export MIGRATIONS_DIR=../infra/sql/migrations
npm run db:migrate --workspace @ultrawiki/api
```

To run migrations inside Compose, restart the API or run:

```bash
docker compose exec api npm run db:migrate
```

## Local Model Runtime with llama.cpp
Place the model here:

```text
./models/qwen2.5-14b-instruct-q4_k_m.gguf
```

The checked-in Compose file defines both the default mock `llm` service and optional `llama` service on host port `8080`. Do not start both at the same time without changing one of the port mappings.

Validate the checked-in local Qwen/llama.cpp config:

```bash
npm run llm:doctor
npm run gate:local-llm-config
npm run gate:real-model-eval-config
```

Use strict doctor mode when you expect the machine to be fully ready. It fails if the GGUF file or llama Compose profile is not ready:

```bash
npm run llm:doctor -- --strict
```

Validate the host model path and print GPU diagnostics:

```bash
npm run llm:check-local
```

To validate only the llama.cpp server:

```bash
docker compose --profile llama up --build llama
```

Or validate and start it with the diagnostic helper:

```bash
npm run llm:check-local -- --start
```

The `llama` service runs:

```text
ghcr.io/ggerganov/llama.cpp:server
model: /models/qwen2.5-14b-instruct-q4_k_m.gguf
context: 4096
gpu layers: 100
port: 8080
gpu access: Docker `gpus: all`
```

Runtime presets are documented in:

```text
infra/evaluation/runtime-presets.md
infra/evaluation/runtime-presets.json
```

Useful overrides:

```bash
RUNTIME_PRESET=rtx4080_qwen14b_safe
LLM_QUANTIZATION=q4_k_m
LLM_CONTEXT_WINDOW=4096
LLM_CHUNK_SIZE=1000
LLM_CONCURRENCY=1
JOB_CONCURRENCY_LIMIT=1
```

To run the full app against llama.cpp, start the stack with `LLM_PROVIDER=openai_compatible` and point the API at the `llama` service:

```bash
export LLM_PROVIDER=openai_compatible
export LLM_BASE_URL=http://llama:8080/v1
export LLM_MODEL=qwen2.5-14b-instruct-q4_k_m
export LLM_TIMEOUT_MS=120000
docker compose --profile llama up --build postgres api web worker llama
```

Do not start the default mock `llm` service on the same host port as `llama` unless you override `LLM_HOST_PORT` or `LLAMA_HOST_PORT`.

To evaluate the real model against the checked-in Qwen/RTX thresholds, run:

```bash
npm run eval:real-model -- --start
```

The command validates the model file, starts `llama` on isolated host port `28080`, runs a real-model artifact/performance eval, writes `api/benchmarks/real-model-latest.json`, and stops the `llama` container when finished. Keep the container running after eval with:

```bash
REAL_MODEL_EVAL_KEEP_STACK=1 npm run eval:real-model -- --start
```

If you already have an OpenAI-compatible llama.cpp server running, point eval at it:

```bash
LLM_PROVIDER=openai_compatible \
LLM_BASE_URL=http://localhost:8080/v1 \
npm run eval:real-model
```

To include the golden-set quality suite against the real model:

```bash
REAL_MODEL_EVAL_INCLUDE_GOLDEN_SET=1 npm run eval:real-model -- --start
```

To run the full app stack, generate a study pack through the API, and verify returned artifacts came from the real model:

```bash
npm run smoke:real-llm
```

`smoke:real-llm` uses isolated host ports:
- Web: `http://localhost:23000`
- API: `http://localhost:24000`
- Postgres host port: `25432`
- Worker: `http://localhost:28000`
- llama.cpp host port: `28080`

Like `npm run smoke`, `smoke:real-llm` tears down the Compose stack with volumes on exit.

The API also exposes a guarded local trigger/status wrapper for the same real-model smoke. It is disabled by default, always disabled in production, and requires an explicit confirmation payload so it cannot be started accidentally:

```bash
export REAL_MODEL_SMOKE_API_ENABLED=1
curl -fsS 'http://localhost:4000/api/runtime/llm/smoke'
curl -fsS -X POST 'http://localhost:4000/api/runtime/llm/smoke' \
  -H 'content-type: application/json' \
  -d '{"confirm":"run-real-model-smoke"}'
```

The trigger runs the fixed local command `npm run smoke:real-llm`; the request cannot supply an arbitrary command. Requests must come from loopback. If your local Docker or proxy setup does not present a loopback client address, set `REAL_MODEL_SMOKE_API_TOKEN` on the API and pass the same value as a bearer token or through the helper script environment.

Poll the status endpoint until it reports `passed` or `failed`, or use the helper script:

```bash
API_BASE_URL=http://localhost:4000 npm run smoke:real-model:trigger
# Or, when REAL_MODEL_SMOKE_API_TOKEN is configured on the API:
REAL_MODEL_SMOKE_API_TOKEN=... API_BASE_URL=http://localhost:4000 npm run smoke:real-model:trigger
```

## Monitoring Stack
Start app + monitoring:

```bash
docker compose --profile monitoring up --build
```

Open:

```text
Prometheus:   http://localhost:9090
Alertmanager: http://localhost:9093
Pushgateway:  http://localhost:9091
```

App metrics:

```bash
curl -fsS http://localhost:4000/api/metrics/outcomes
```

The Prometheus output includes `ultrawiki_security_events_total`, `ultrawiki_security_events_by_category_total`, `ultrawiki_security_events_by_type_total`, `ultrawiki_rate_limit_events_total`, and `ultrawiki_rate_limit_events_by_type_total` counters for audited auth, sharing, security-control, and rate-limit events.

Cost trend support view:

```bash
curl -fsS 'http://localhost:4000/api/analytics/costs?window_hours=24'
```

SLO target and current signal view:

```bash
curl -fsS 'http://localhost:4000/api/analytics/slo?window_hours=24'
```

Validate monitoring config:

```bash
npm run gate:monitoring-config
```

Simulate an alert end-to-end:

```bash
npm run monitoring:simulate-alert
```

## Maintenance Jobs
Outcomes maintenance dry-run:

```bash
OUTCOMES_MAINTENANCE_DRY_RUN=1 npm run maintenance:outcomes --workspace @ultrawiki/api
```

Lifecycle retention dry-run:

```bash
LIFECYCLE_MAINTENANCE_DRY_RUN=1 npm run maintenance:lifecycle --workspace @ultrawiki/api
```

The lifecycle policy covers idempotency keys, failed/quarantined jobs, generated artifacts, cost telemetry, stale profiles without owned data, expired or revoked share links, flashcard reviews, learning sessions, and quiz attempts. The dry-run prints the active day windows without deleting data.

Data repair dry-run:

```bash
npm run maintenance:data-repair --workspace @ultrawiki/api
```

The data repair tool is dry-run by default and reports profile rows, learning saved-pack links, legacy share token metadata, and quiz-attempt sequence rows that would be repaired. Apply repairs only after reviewing the JSON output:

```bash
npm run maintenance:data-repair --workspace @ultrawiki/api -- --apply
```

Against a host Postgres database:

```bash
export DATABASE_URL=postgresql://ultrawiki:ultrawiki@localhost:5432/ultrawiki
npm run maintenance:outcomes --workspace @ultrawiki/api
npm run maintenance:lifecycle --workspace @ultrawiki/api
npm run maintenance:data-repair --workspace @ultrawiki/api
```

Scheduled workflow definitions are checked in under `.github/workflows/`.

## Validation Commands
Run the normal local validation suite:

```bash
npm run typecheck
npm run lint
npm run test
```

Run product/governance gates:

```bash
npm run gate:contracts
npm run gate:ticket-progress
npm run gate:golden-set
npm run gate:prompt-regression
npm run gate:local-llm-config
npm run gate:bench-regression
npm run gate:migration-safety
npm run gate:alert-policy
npm run gate:error-budget-policy
npm run gate:alert-runbook-linkage
npm run gate:change-gating-policy
npm run gate:adversarial-corpus
npm run gate:lifecycle-retention
npm run gate:backup-restore-drill
npm run gate:support-playbook
npm run gate:outcomes-maintenance
```

`gate:backup-restore-drill` verifies that the newest restore drill covers generated packs, saved library rows, user profiles, share links, flashcard reviews, learning sessions, quiz attempts, study goals, outcome rollups, outcome maintenance runs, and cost events.

`gate:monitoring-config` uses Docker to run Prometheus and Alertmanager validation tools.

```bash
npm run gate:monitoring-config
```

`gate:coverage` runs workspace tests. `gate:tdd-proof` is currently a placeholder policy gate.

## Environment Variables
Common variables:

```bash
POSTGRES_USER=ultrawiki
POSTGRES_PASSWORD=ultrawiki
POSTGRES_DB=ultrawiki
POSTGRES_HOST_PORT=5432
DATABASE_URL=postgresql://ultrawiki:ultrawiki@postgres:5432/ultrawiki
RUN_MIGRATIONS=1
MIGRATIONS_DIR=../infra/sql/migrations
API_PORT=4000
API_HOST_PORT=4000
API_BASE_URL=http://localhost:4000
WEB_PORT=3000
WEB_HOST_PORT=3000
WORKER_PORT=8000
WORKER_HOST_PORT=8000
LLM_HOST_PORT=8080
LLAMA_HOST_PORT=8080
JOB_CONCURRENCY_LIMIT=2
SESSION_CONCURRENCY_LIMIT=1
MAX_QUEUE_DEPTH=100
IDEMPOTENCY_TTL_SECONDS=3600
TOKEN_BUDGET_PER_JOB=40000
LATENCY_BUDGET_MS=30000
CACHE_TTL_SECONDS=604800
SHARE_TOKEN_SECRET=dev-only-ultrawiki-share-token-secret
SHARE_LINK_TTL_SECONDS=604800
WIKIPEDIA_LANG=en
LLM_BASE_URL=http://llm:8080/v1
```

Additional useful variables:

```bash
USE_MEMORY_REPO=1
DISABLE_QUEUE_POLLING=1
CACHE_TTL_SECONDS=604800
SECURITY_ALERT_SIGNATURE_THRESHOLD=3
SECURITY_ALERT_WINDOW_SECONDS=300
RUNTIME_PRESET=rtx4080_qwen14b_safe
LLM_QUANTIZATION=q4_k_m
LLM_CONTEXT_WINDOW=4096
LLM_CHUNK_SIZE=1000
LLM_CONCURRENCY=1
```

Use Docker service hostnames inside Compose (`postgres`, `api`, `llm`). Use `localhost` when running services directly on the host.

## Useful API Calls
Create a pack:

```bash
curl -fsS -X POST http://localhost:4000/api/study-packs \
  -H 'content-type: application/json' \
  -H 'x-session-id: local-session' \
  -d '{"title_or_url":"Alan Turing","idempotency_key":"idem-local-12345"}'
```

Check a job:

```bash
curl -fsS http://localhost:4000/api/jobs/<job_id>
```

Check queue and session capacity:

```bash
curl -fsS http://localhost:4000/api/queue/status \
  -H 'x-session-id: local-session'
```

Queue a safe batch from an imported topic list. The response includes per-topic accepted/reused/deferred/rejected results plus before/after capacity snapshots, so callers can retry deferred topics when queue or session capacity opens:

```bash
curl -fsS -X POST http://localhost:4000/api/study-packs/batch \
  -H 'content-type: application/json' \
  -H 'x-session-id: local-session' \
  -H 'x-user-id: local-library-key' \
  -d '{"idempotency_key":"batch-local-001","topics":["Ada Lovelace","Grace Hopper"]}'
```

Fetch a study pack:

```bash
curl -fsS http://localhost:4000/api/study-packs/<pack_id>
```

Check the current authenticated session:

```bash
curl -fsS http://localhost:4000/api/auth/session \
  --cookie 'ultrawiki_auth_session=<session-token>'
```

Start an OIDC/OAuth login when provider settings are configured:

```bash
curl -i 'http://localhost:4000/api/auth/login?redirect_path=/'
```

Create or fetch a local profile with the development compatibility library key:

```bash
curl -fsS http://localhost:4000/api/me \
  -H 'x-user-id: local-library-key'
```

Update the profile display name:

```bash
curl -fsS -X POST http://localhost:4000/api/me \
  -H 'content-type: application/json' \
  -H 'x-user-id: local-library-key' \
  -d '{"display_name":"Local Learner"}'
```

Export all user-owned profile, library, share, quiz, review, session, and study-goal data for an account:

```bash
curl -fsS http://localhost:4000/api/me/export \
  -H 'x-user-id: local-library-key'
```

Delete user-owned profile, library, share, quiz, review, session, and study-goal data for an account. Generated study-pack artifacts remain in place:

```bash
curl -fsS -X DELETE http://localhost:4000/api/me \
  -H 'x-user-id: local-library-key'
```

List saved packs for a library key:

```bash
curl -fsS 'http://localhost:4000/api/library?limit=8' \
  -H 'x-user-id: local-library-key'
```

Search or facet saved packs by readiness, progress, tag, collection, and sort order:

```bash
curl -fsS 'http://localhost:4000/api/library?limit=8&q=ada&readiness=full&progress=due&tag=math&collection=STEM&sort=title_asc' \
  -H 'x-user-id: local-library-key'
```

Save a loaded pack to a library:

```bash
curl -fsS -X POST http://localhost:4000/api/study-packs/<pack_id>/save \
  -H 'x-user-id: local-library-key'
```

Replace a saved pack's organization metadata:

```bash
curl -fsS -X PATCH http://localhost:4000/api/library/<pack_id>/organization \
  -H 'content-type: application/json' \
  -H 'x-user-id: local-library-key' \
  -d '{"tags":["math","history"],"collection":"STEM"}'
```

Compare saved regenerations for the same topic input:

```bash
curl -fsS 'http://localhost:4000/api/library/<pack_id>/versions?limit=8' \
  -H 'x-user-id: local-library-key'
```

Create a read-only viewer share link:

```bash
curl -fsS -X POST http://localhost:4000/api/study-packs/<pack_id>/share \
  -H 'content-type: application/json' \
  -H 'x-user-id: local-library-key' \
  -d '{"role":"viewer"}'
```

The authenticated user must already have the pack saved in their library before creating a share link. In OIDC mode, replace the `x-user-id` header with the `ultrawiki_auth_session` cookie.

New share links include an expiry timestamp and use public share tokens in the returned path. The database stores the token hash, not the plaintext URL token.

List active share links owned by the current user for a saved pack:

```bash
curl -fsS 'http://localhost:4000/api/study-packs/<pack_id>/shares?limit=10' \
  -H 'x-user-id: local-library-key'
```

Revoke an owned share link:

```bash
curl -fsS -X DELETE http://localhost:4000/api/study-packs/<pack_id>/shares/<share_id> \
  -H 'x-user-id: local-library-key'
```

Fetch a shared pack payload:

```bash
curl -fsS http://localhost:4000/api/shared/<share_id>
```

Public shared-pack reads are rate limited by the Express client address, and repeated malformed, expired, revoked, or tampered token reads have a lower failed-read limit. Generation start/resume, auth session endpoints, and Ops analytics endpoints are also rate limited by the same trusted client-address policy. Forwarded address headers affect the limiter only when `TRUST_PROXY=1`; leave it disabled unless a trusted reverse proxy overwrites those headers. Failed-read audit logs include token fingerprints instead of raw public share tokens.

Fetch flashcard review progress for a library key:

```bash
curl -fsS http://localhost:4000/api/study-packs/<pack_id>/progress \
  -H 'x-user-id: local-library-key'
```

Export Anki CSV with reviewed/due progress columns for a saved pack:

```bash
curl -fsS 'http://localhost:4000/api/study-packs/<pack_id>/export?format=anki_csv' \
  -H 'x-user-id: local-library-key' \
  -o study-pack-progress.csv
```

Start a persisted due-card learning session:

```bash
curl -fsS -X POST http://localhost:4000/api/study-packs/<pack_id>/learning-session \
  -H 'content-type: application/json' \
  -H 'x-user-id: local-library-key' \
  -d '{"baseline_due_cards":2,"baseline_mastery_score":0}'
```

Refresh a persisted learning session after reviews:

```bash
curl -fsS 'http://localhost:4000/api/study-packs/<pack_id>/learning-session?session_id=<session_id>' \
  -H 'x-user-id: local-library-key'
```

Fetch per-user learning analytics across saved packs:

```bash
curl -fsS http://localhost:4000/api/learning/analytics \
  -H 'x-user-id: local-library-key'
```

Fetch local due-card reminder status for a library key:

```bash
curl -fsS http://localhost:4000/api/learning/reminders \
  -H 'x-user-id: local-library-key'
```

Configure the optional daily review target shown in the Learning dashboard:

```bash
curl -fsS -X PUT http://localhost:4000/api/learning/goal \
  -H 'content-type: application/json' \
  -H 'x-user-id: local-library-key' \
  -d '{"daily_target_reviews":5}'
```

Save a spaced-repetition flashcard review:

```bash
curl -fsS -X POST http://localhost:4000/api/study-packs/<pack_id>/flashcards/0/reviews \
  -H 'content-type: application/json' \
  -H 'x-user-id: local-library-key' \
  -d '{"rating":"good"}'
```

Fetch cost telemetry trends:

```bash
curl -fsS 'http://localhost:4000/api/analytics/costs?window_hours=24'
```

Fetch dedicated cost drilldown rows:

```bash
curl -fsS 'http://localhost:4000/api/analytics/costs/drilldown?window_hours=168&stage=summarization&limit=25'
```

Fetch local LLM runtime health for the Ops dashboard:

```bash
curl -fsS 'http://localhost:4000/api/runtime/llm/health'
```

Fetch the read-only Qwen/RTX runtime preset matrix:

```bash
curl -fsS 'http://localhost:4000/api/runtime/llm/presets'
```

Fetch local real-model smoke trigger status:

```bash
curl -fsS 'http://localhost:4000/api/runtime/llm/smoke'
```

Fetch the checked-in golden-set and prompt-regression evaluation snapshot used by the Ops dashboard:

```bash
curl -fsS 'http://localhost:4000/api/evaluation/prompts'
```

The prompt evaluation snapshot also includes aggregate `user_feedback` signal data. These rows are stored as untrusted eval candidates and do not alter checked-in golden-set fixtures until a human review promotes them outside the app.

Submit generation quality feedback for a saved pack:

```bash
curl -fsS -X POST http://localhost:4000/api/study-packs/<pack_id>/feedback \
  -H 'content-type: application/json' \
  -H 'x-user-id: local-library-key' \
  -d '{"artifact_type":"quiz","rating":2,"signal":"incorrect","comment":"Answer key looked wrong."}'
```

Export Ops cost tables as CSV:

```bash
curl -fsS 'http://localhost:4000/api/analytics/costs?window_hours=24&format=csv'
curl -fsS 'http://localhost:4000/api/analytics/costs/drilldown?window_hours=168&stage=summarization&limit=25&format=csv'
```

Fetch outcome analytics with security category and rate-limit source breakdowns for the same window:

```bash
curl -fsS 'http://localhost:4000/api/analytics/outcomes?window_hours=24'
```

Fetch SLO targets and current values:

```bash
curl -fsS 'http://localhost:4000/api/analytics/slo?window_hours=24'
```

Resume an incomplete study pack:

```bash
curl -fsS -X POST http://localhost:4000/api/study-packs/<pack_id>/resume \
  -H 'x-session-id: local-session'
```

Submit a quiz attempt:

```bash
curl -fsS -X POST http://localhost:4000/api/quiz-attempts \
  -H 'content-type: application/json' \
  -H 'x-user-id: local-user' \
  -d '{"pack_id":"<pack_id>","selected_indices":[0,0,0,0,0,0,0,0,0,0]}'
```

List recent quiz retakes and mastery trend snapshots:

```bash
curl -fsS 'http://localhost:4000/api/study-packs/<pack_id>/quiz-attempts?limit=5' \
  -H 'x-user-id: local-user'
```

## Troubleshooting
If API startup fails with migration path errors:
- In Compose, `MIGRATIONS_DIR` must be `/infra/sql/migrations`.
- On the host, from the `api` workspace, `MIGRATIONS_DIR` should be `../infra/sql/migrations`.

If the API cannot connect to Postgres:
- In Compose, use host `postgres`.
- From the host, use host `localhost`.

If `docker compose up` fails on port conflicts:
- Check ports `3000`, `4000`, `5432`, `8000`, `8080`, `9090`, `9091`, `9093`.
- Stop the conflicting process or adjust Compose port mappings.

If study-pack generation never finishes:
- Check API logs: `docker compose logs -f api`.
- Check worker health: `curl -fsS http://localhost:8000/health`.
- Check queue/admission settings: `JOB_CONCURRENCY_LIMIT`, `SESSION_CONCURRENCY_LIMIT`, `MAX_QUEUE_DEPTH`.
- Check queue state directly: `curl -fsS http://localhost:4000/api/queue/status -H 'x-session-id: local-session'`.

If a pack is marked partial:
- This means completed artifacts were saved before a token or latency budget boundary.
- Open the pack in the UI and select `Resume missing artifacts`.
- Or call `POST /api/study-packs/<pack_id>/resume` with the same `x-session-id` header.

If saved packs, share buttons, or flashcard review buttons appear inactive:
- Set a `Library key` in the left rail, or send `x-user-id` for API calls.
- If `AUTH_ALLOW_HEADER_USER=0`, use OIDC login so requests include the `ultrawiki_auth_session` cookie.
- Save the pack before creating a share link or recording learning progress for that account.
- The browser stores the key as `ultrawiki_user_id`.
- Clear that localStorage value to switch local account keys in the UI.

If monitoring alert simulation fails:
- Start with `docker compose --profile monitoring up --build`.
- Wait for Prometheus and Alertmanager to finish startup.
- Confirm Pushgateway is reachable at `http://localhost:9091`.

If llama.cpp fails to start:
- Confirm `./models/qwen2.5-14b-instruct-q4_k_m.gguf` exists.
- Confirm the mock `llm` service is not already using host port `8080`.
- Confirm your Docker runtime has GPU access configured.
- Start with the safe preset values before increasing context or concurrency.

## Clean Reset
To reset Docker state and database data:

```bash
docker compose down -v
docker compose up --build
```

To remove generated benchmark reports:

```bash
rm -f api/benchmarks/latest.json
```
