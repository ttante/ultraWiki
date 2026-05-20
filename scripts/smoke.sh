#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required"
  exit 1
fi

echo "Validating docker compose config..."
docker compose config >/dev/null

echo "Starting stack..."
docker compose up -d --build

trap 'docker compose down -v' EXIT

check_health() {
  local url="$1"
  local name="$2"
  for _ in {1..30}; do
    if curl -fsS "$url" >/dev/null; then
      echo "$name healthy"
      return 0
    fi
    sleep 1
  done
  echo "$name failed health check"
  return 1
}

check_health "http://localhost:4000/health" "api"
check_health "http://localhost:3000/api/health" "web"
check_health "http://localhost:8000/health" "worker"

echo "smoke passed"
