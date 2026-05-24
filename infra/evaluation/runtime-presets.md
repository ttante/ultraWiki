# RTX 4080 Runtime Presets

Validated preset matrix lives in `infra/evaluation/runtime-presets.json`.

## Presets
- `rtx4080_qwen14b_safe`
  - model: `qwen2.5-14b`
  - hardware: `rtx4080_12gb`
  - quantization: `q4_k_m`
  - context window: `4096`
  - chunk size: `1000`
  - concurrency: `1`
  - status: validated default
- `rtx4080_qwen14b_balanced`
  - model: `qwen2.5-14b`
  - hardware: `rtx4080_12gb`
  - quantization: `q4_k_m`
  - context window: `6144`
  - chunk size: `1300`
  - concurrency: `2`
  - status: validated
- `rtx4080_qwen14b_throughput`
  - model: `qwen2.5-14b`
  - hardware: `rtx4080_12gb`
  - quantization: `q5_k_m`
  - context window: `4096`
  - chunk size: `900`
  - concurrency: `2`
  - status: validated

## Validation
- Gate command: `npm run gate:runtime-presets`
- The gate verifies `infra/evaluation/runtime-presets.json` matches `api/src/domain/runtimePreset.ts`.
- Presets are constrained to 12GB VRAM-safe context windows, chunk sizes, quantization choices, and concurrency.

## Runtime Config
Defaults are enforced from preset selection in `api/src/config.ts`.

Optional overrides:
- `RUNTIME_PRESET`
- `LLM_QUANTIZATION`
- `LLM_CONTEXT_WINDOW`
- `LLM_CHUNK_SIZE`
- `LLM_CONCURRENCY`
- `JOB_CONCURRENCY_LIMIT`
