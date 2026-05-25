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

Cost trend support view:

```bash
curl -fsS 'http://localhost:4000/api/analytics/costs?window_hours=24'
```

SLO target and current signal view:

```bash
curl -fsS http://localhost:4000/api/analytics/slo
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

Against a host Postgres database:

```bash
export DATABASE_URL=postgresql://ultrawiki:ultrawiki@localhost:5432/ultrawiki
npm run maintenance:outcomes --workspace @ultrawiki/api
npm run maintenance:lifecycle --workspace @ultrawiki/api
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

Fetch a study pack:

```bash
curl -fsS http://localhost:4000/api/study-packs/<pack_id>
```

Fetch cost telemetry trends:

```bash
curl -fsS 'http://localhost:4000/api/analytics/costs?window_hours=24'
```

Fetch SLO targets and current values:

```bash
curl -fsS http://localhost:4000/api/analytics/slo
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
  -d '{"pack_id":"<pack_id>","selected_indices":[0,0,0,0,0,0,0,0,0,0]}'
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
