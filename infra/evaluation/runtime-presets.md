# RTX 4080 Runtime Presets

Validated preset matrix lives in `infra/evaluation/runtime-presets.json`.

## Presets
- `rtx4080_qwen14b_safe`
  - quantization: `q4_k_m`
  - context window: `4096`
  - chunk size: `1000`
  - concurrency: `1`
- `rtx4080_qwen14b_balanced`
  - quantization: `q4_k_m`
  - context window: `6144`
  - chunk size: `1300`
  - concurrency: `2`
- `rtx4080_qwen14b_throughput`
  - quantization: `q5_k_m`
  - context window: `4096`
  - chunk size: `900`
  - concurrency: `2`

## Runtime Config
Defaults are enforced from preset selection in `api/src/config.ts`.

Optional overrides:
- `RUNTIME_PRESET`
- `LLM_QUANTIZATION`
- `LLM_CONTEXT_WINDOW`
- `LLM_CHUNK_SIZE`
- `LLM_CONCURRENCY`
- `JOB_CONCURRENCY_LIMIT`
