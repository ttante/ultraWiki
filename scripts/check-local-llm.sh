#!/usr/bin/env bash
set -euo pipefail

LOCAL_LLM_REQUIRE_MODEL=1 node --import tsx api/scripts/local-llm-config.ts

echo "Validating llama.cpp compose profile..."
docker compose --profile llama config >/dev/null

if command -v nvidia-smi >/dev/null 2>&1; then
  echo "GPU diagnostic:"
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
else
  echo "WARNING nvidia-smi not found; Docker GPU runtime still needs to expose the RTX 4080 to the llama container."
fi

if [[ "${1:-}" == "--start" ]]; then
  echo "Starting llama.cpp server with profile=llama..."
  docker compose --profile llama up -d llama
  for _ in {1..60}; do
    if curl -fsS "http://localhost:${LLAMA_HOST_PORT:-8080}/health" >/dev/null 2>&1; then
      echo "llama.cpp healthy at http://localhost:${LLAMA_HOST_PORT:-8080}"
      exit 0
    fi
    sleep 2
  done
  echo "llama.cpp did not become healthy; recent logs:"
  docker compose logs --tail=120 llama
  exit 1
fi

echo "Local LLM diagnostics passed. To start the server, run:"
echo "  npm run llm:check-local -- --start"
