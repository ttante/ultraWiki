#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required"
  exit 1
fi

export LOCAL_LLM_REQUIRE_MODEL=1
node --import tsx api/scripts/local-llm-config.ts
node --import tsx api/scripts/real-model-eval-config.ts
docker compose --profile llama config >/dev/null

export LLM_PROVIDER=openai_compatible
export LLM_MODEL="${LLM_MODEL:-qwen2.5-14b-instruct-q4_k_m}"
export LLM_TIMEOUT_MS="${LLM_TIMEOUT_MS:-120000}"
export BENCH_RUNTIME_PROFILE="${BENCH_RUNTIME_PROFILE:-rtx4080_qwen14b_safe}"
export BENCH_ITERATIONS="${BENCH_ITERATIONS:-1}"
export BENCH_MEMORY_LIMIT_MB="${BENCH_MEMORY_LIMIT_MB:-12288}"

cleanup() {
  if [[ "${mode}" == "--start" && "${REAL_MODEL_EVAL_KEEP_STACK:-0}" != "1" ]]; then
    docker compose --profile llama stop llama >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ "${mode}" == "--start" ]]; then
  export LLAMA_HOST_PORT="${LLAMA_HOST_PORT:-28080}"
  echo "Starting llama.cpp on host port ${LLAMA_HOST_PORT}..."
  docker compose --profile llama up -d llama
fi

export LLM_BASE_URL="${LLM_BASE_URL:-http://localhost:${LLAMA_HOST_PORT:-8080}/v1}"

check_llm_ready() {
  local base_without_v1="${LLM_BASE_URL%/v1}"
  curl -fsS "${base_without_v1}/health" >/dev/null 2>&1 || curl -fsS "${LLM_BASE_URL}/models" >/dev/null 2>&1
}

for _ in {1..120}; do
  if check_llm_ready; then
    echo "llama.cpp ready at ${LLM_BASE_URL}"
    ready=1
    break
  fi
  sleep 1
done

if [[ "${ready:-0}" != "1" ]]; then
  echo "FAIL real LLM server did not become ready at ${LLM_BASE_URL}"
  echo "Start it with: npm run eval:real-model -- --start"
  exit 1
fi

node --import tsx api/scripts/real-model-eval.ts

if [[ "${REAL_MODEL_EVAL_INCLUDE_GOLDEN_SET:-0}" == "1" ]]; then
  echo "Running golden-set against real model..."
  GOLDEN_SET_USE_LLM=1 npm run gate:golden-set
fi
