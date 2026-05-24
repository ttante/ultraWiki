# MVP Release Evidence - 2026-05-23

## Status
- Local mock stack smoke: passed.
- Build hygiene: passed with no Next.js `next.config.js` module-type warning.
- Release data-ops gate: passed.
- Release readiness gate: passed.
- Local Qwen/llama.cpp config gate: passed.
- Docker Compose config validation: passed.
- API test suite: passed, `42` files / `138` tests.
- Web test suite: passed, `2` files / `13` tests.
- Real Qwen server start: pending local model file.

## Commands Run

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Result: passed.

```bash
npm run build --workspace @ultrawiki/web
```

Result: passed. The previous `next.config.js` module-type warning is gone.

```bash
npm run smoke
```

Result: passed. Verified:
- Postgres health through `pg_isready`
- API health on isolated smoke port
- Web health on isolated smoke port
- Worker health on isolated smoke port
- Mock LLM health on isolated smoke port

```bash
npm run gate:local-llm-config
```

Result: passed. Validated:
- `infra/llm/local-qwen.json`
- `docker-compose.yml` llama profile
- RTX 4080/Qwen runtime preset linkage
- llama.cpp model path, context window, GPU offload, and profile wiring

```bash
docker compose config
docker compose --profile llama config
```

Result: passed.

```bash
npm run llm:check-local
```

Result: blocked as expected in this checkout:

```text
FAIL model file missing: models/qwen2.5-14b-instruct-q4_k_m.gguf
```

Action: place `qwen2.5-14b-instruct-q4_k_m.gguf` at that path, then run:

```bash
npm run llm:check-local
npm run llm:check-local -- --start
```

## Notes
- Smoke uses isolated ports by default to avoid collisions with a developer's normal local services.
- `models/*.gguf` is ignored by Git; the model file should not be committed.
- Current app generation remains deterministic/local-rule-based; llama.cpp support is validated as infrastructure for the real-model integration path.
