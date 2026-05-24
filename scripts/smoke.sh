#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required"
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required"
  exit 1
fi

echo "Validating docker compose config..."
docker compose config >/dev/null

export POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-15432}"
export API_HOST_PORT="${API_HOST_PORT:-14000}"
export WEB_HOST_PORT="${WEB_HOST_PORT:-13000}"
export WORKER_HOST_PORT="${WORKER_HOST_PORT:-18000}"
export LLM_HOST_PORT="${LLM_HOST_PORT:-18080}"

cleanup() {
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT

echo "Starting stack..."
docker compose up -d --build

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

check_postgres() {
  for _ in {1..30}; do
    if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-ultrawiki}" -d "${POSTGRES_DB:-ultrawiki}" >/dev/null 2>&1; then
      echo "postgres healthy"
      return 0
    fi
    sleep 1
  done
  echo "postgres failed health check"
  docker compose logs --tail=80 postgres
  return 1
}

check_postgres
check_health "http://localhost:${API_HOST_PORT}/health" "api"
check_health "http://localhost:${WEB_HOST_PORT}/api/health" "web"
check_health "http://localhost:${WORKER_HOST_PORT}/health" "worker"
check_health "http://localhost:${LLM_HOST_PORT}/health" "llm mock"

echo "smoke passed"
