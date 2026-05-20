# ultraWiki

Monorepo for the UltraWiki MVP.

## Services
- `web`: Next.js UI
- `api`: Node/TypeScript API and orchestration
- `worker`: FastAPI worker
- `postgres`: Persistence
- `llm`: OpenAI-compatible mock server (default)
- `llama`: optional llama.cpp server profile for local Qwen runtime

## Quick Start
1. Copy `.env.example` to `.env` and set values.
2. Run `docker compose up --build`.
   - API applies SQL migrations automatically on startup.
3. Check health:
   - `http://localhost:3000/api/health`
   - `http://localhost:4000/health`
   - `http://localhost:8000/health`

## Run with real llama.cpp
Start with the `llama` profile and place your model in `./models`:
`docker compose --profile llama up --build`

## Run with monitoring stack
Start Prometheus + Alertmanager + Pushgateway:
`docker compose --profile monitoring up --build`

Then simulate an alert end-to-end:
`bash scripts/monitoring-simulate-alert.sh`

## CI Gates
See `docs/tickets.md` for TDD and release gate requirements.
