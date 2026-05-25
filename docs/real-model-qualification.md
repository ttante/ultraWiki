# Real-Model Qualification

Last attempted: `2026-05-24`

## Target Runtime
- Model: `qwen2.5-14b-instruct-q4_k_m`
- Required local file: `models/qwen2.5-14b-instruct-q4_k_m.gguf`
- Runtime preset: `rtx4080_qwen14b_safe`
- Compose profile: `llama`
- Config: `infra/llm/local-qwen.json`
- Eval thresholds: `infra/evaluation/real-model-eval.json`

## Current Result
Real-model qualification is blocked because the local GGUF file is not present in this checkout.

Commands run:

```bash
npm run llm:doctor
npm run llm:check-local
npm run eval:real-model
```

Observed blocker:

```text
FAIL model file missing: models/qwen2.5-14b-instruct-q4_k_m.gguf
```

## Required Next Run
After placing the GGUF file at `models/qwen2.5-14b-instruct-q4_k_m.gguf`, run:

```bash
npm run llm:doctor
npm run llm:check-local
npm run llm:check-local -- --start
npm run eval:real-model
npm run smoke:real-llm
```

Use `npm run eval:real-model -- --start` if the llama.cpp server should be started by the eval harness.

## Acceptance Criteria
- `npm run llm:check-local` passes model-file, compose-profile, and GPU diagnostics.
- `npm run llm:doctor -- --strict` reports `ready` before the real-model eval is accepted.
- `npm run eval:real-model` writes `api/benchmarks/real-model-latest.json`.
- `npm run smoke:real-llm` verifies generated summaries, knowledge structure, flashcards, and quiz questions use the configured real model rather than deterministic fallback.
- If any generated artifact falls back, inspect `ultrawiki_llm_*` Prometheus metrics and `/api/analytics/costs` `llm_ops` before accepting the runtime.
