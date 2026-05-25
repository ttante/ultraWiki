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

export LOCAL_LLM_REQUIRE_MODEL=1
node --import tsx api/scripts/local-llm-config.ts
node --import tsx api/scripts/real-model-eval-config.ts
docker compose --profile llama config >/dev/null

export POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-25432}"
export API_HOST_PORT="${API_HOST_PORT:-24000}"
export WEB_HOST_PORT="${WEB_HOST_PORT:-23000}"
export WORKER_HOST_PORT="${WORKER_HOST_PORT:-28000}"
export LLAMA_HOST_PORT="${LLAMA_HOST_PORT:-28080}"
export LLM_PROVIDER=openai_compatible
export LLM_BASE_URL="${LLM_BASE_URL:-http://llama:8080/v1}"
export LLM_MODEL="${LLM_MODEL:-qwen2.5-14b-instruct-q4_k_m}"
export LLM_TIMEOUT_MS="${LLM_TIMEOUT_MS:-120000}"
export JOB_CONCURRENCY_LIMIT="${JOB_CONCURRENCY_LIMIT:-1}"
export SESSION_CONCURRENCY_LIMIT="${SESSION_CONCURRENCY_LIMIT:-1}"
export TOKEN_BUDGET_PER_JOB="${TOKEN_BUDGET_PER_JOB:-100000}"
export LATENCY_BUDGET_MS="${LATENCY_BUDGET_MS:-240000}"

cleanup() {
  docker compose --profile llama down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

json_get() {
  local path="$1"
  node -e "
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input);
  const value = '${path}'.split('.').reduce((acc, key) => acc && acc[key], payload);
  if (value === undefined || value === null) process.exit(1);
  if (typeof value === 'object') console.log(JSON.stringify(value));
  else console.log(String(value));
});
"
}

check_health() {
  local url="$1"
  local name="$2"
  for _ in {1..120}; do
    if curl -fsS "$url" >/dev/null; then
      echo "$name healthy"
      return 0
    fi
    sleep 1
  done
  echo "$name failed health check"
  return 1
}

check_llama() {
  for _ in {1..180}; do
    if curl -fsS "http://localhost:${LLAMA_HOST_PORT}/health" >/dev/null 2>&1 ||
      curl -fsS "http://localhost:${LLAMA_HOST_PORT}/v1/models" >/dev/null 2>&1; then
      echo "llama healthy"
      return 0
    fi
    sleep 1
  done
  echo "llama failed health check"
  docker compose --profile llama logs --tail=120 llama
  return 1
}

check_postgres() {
  for _ in {1..60}; do
    if docker compose --profile llama exec -T postgres pg_isready -U "${POSTGRES_USER:-ultrawiki}" -d "${POSTGRES_DB:-ultrawiki}" >/dev/null 2>&1; then
      echo "postgres healthy"
      return 0
    fi
    sleep 1
  done
  echo "postgres failed health check"
  docker compose --profile llama logs --tail=80 postgres
  return 1
}

echo "Starting real-LLM stack..."
docker compose --profile llama up -d --build postgres api web worker llama

check_postgres
check_health "http://localhost:${API_HOST_PORT}/health" "api"
check_health "http://localhost:${WEB_HOST_PORT}/api/health" "web"
check_health "http://localhost:${WORKER_HOST_PORT}/health" "worker"
check_llama

request_body='{"title_or_url":"Alan Turing","idempotency_key":"real-llm-smoke-20260524"}'
create_response="$(curl -fsS -X POST "http://localhost:${API_HOST_PORT}/api/study-packs" \
  -H 'content-type: application/json' \
  -H 'x-session-id: real-llm-smoke' \
  -d "${request_body}")"
pack_id="$(printf '%s' "${create_response}" | json_get pack_id)"
job_id="$(printf '%s' "${create_response}" | json_get job_id)"

echo "Waiting for job ${job_id}..."
for _ in {1..180}; do
  job_response="$(curl -fsS "http://localhost:${API_HOST_PORT}/api/jobs/${job_id}")"
  status="$(printf '%s' "${job_response}" | json_get status)"
  if [[ "${status}" == "completed" ]]; then
    echo "job completed"
    break
  fi
  if [[ "${status}" == "failed" || "${status}" == "quarantined" ]]; then
    echo "job failed: ${job_response}"
    docker compose --profile llama logs --tail=160 api llama
    exit 1
  fi
  sleep 2
done

if [[ "${status:-}" != "completed" ]]; then
  echo "job did not complete in time"
  docker compose --profile llama logs --tail=160 api llama
  exit 1
fi

pack_response="$(curl -fsS "http://localhost:${API_HOST_PORT}/api/study-packs/${pack_id}")"
printf '%s' "${pack_response}" | LLM_MODEL="${LLM_MODEL}" node -e "
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const pack = JSON.parse(input);
  const failures = [];
  if (pack.readiness?.status !== 'full') failures.push('pack is not full');
  if ((pack.summaries || []).length < 3) failures.push('missing summaries');
  if ((pack.glossary || []).length < 5) failures.push('missing glossary');
  if ((pack.flashcards || []).length < 10) failures.push('missing flashcards');
  if ((pack.quiz_questions || []).length < 5) failures.push('missing quiz questions');
  if (!Array.isArray(pack.quiz_questions?.[0]?.misconceptions) || pack.quiz_questions[0].misconceptions.length !== 4) failures.push('missing misconception checks');
  if ((pack.graph?.nodes || []).length < 1) failures.push('missing graph nodes');
  if ((pack.timeline || []).length < 1) failures.push('missing timeline events');
  const models = [
    ...(pack.summaries || []).map((item) => item.model),
    ...(pack.glossary || []).map((item) => item.model),
    ...(pack.flashcards || []).map((item) => item.model),
    ...(pack.quiz_questions || []).map((item) => item.model)
  ];
  const unexpected = [...new Set(models.filter((model) => model !== process.env.LLM_MODEL))];
  if (unexpected.length > 0) failures.push('fallback model used: ' + unexpected.join(','));
  if (failures.length > 0) {
    for (const failure of failures) console.error('FAIL ' + failure);
    process.exit(1);
  }
  console.log('real LLM smoke artifact check passed');
});
"

echo "real LLM smoke passed"
