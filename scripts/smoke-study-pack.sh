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

export POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-15433}"
export API_HOST_PORT="${API_HOST_PORT:-14001}"
export WEB_HOST_PORT="${WEB_HOST_PORT:-13001}"
export WORKER_HOST_PORT="${WORKER_HOST_PORT:-18001}"
export LLM_HOST_PORT="${LLM_HOST_PORT:-18081}"
export TOKEN_BUDGET_PER_JOB="${TOKEN_BUDGET_PER_JOB:-250000}"
export LATENCY_BUDGET_MS="${LATENCY_BUDGET_MS:-120000}"
tmp_dir="$(mktemp -d)"

cleanup() {
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "${tmp_dir}"
}

trap cleanup EXIT

check_health() {
  local url="$1"
  local name="$2"
  for _ in {1..45}; do
    if curl -fsS "$url" >/dev/null; then
      echo "$name healthy"
      return 0
    fi
    sleep 1
  done
  echo "$name failed health check"
  docker compose logs --tail=120 "$name" || true
  return 1
}

echo "Validating docker compose config..."
docker compose config >/dev/null

echo "Starting full study-pack smoke stack..."
docker compose up -d --build

check_health "http://localhost:${API_HOST_PORT}/health" "api"
check_health "http://localhost:${WEB_HOST_PORT}/api/health" "web"
check_health "http://localhost:${WORKER_HOST_PORT}/health" "worker"
check_health "http://localhost:${LLM_HOST_PORT}/health" "llm"

echo "Creating study pack..."
create_response="$(
  curl -fsS -X POST "http://localhost:${API_HOST_PORT}/api/study-packs" \
    -H 'content-type: application/json' \
    -H 'x-session-id: full-smoke' \
    -d '{"title_or_url":"Alan Turing","idempotency_key":"full-study-pack-smoke"}'
)"

pack_id="$(printf '%s' "${create_response}" | node -e "let s=''; process.stdin.on('data', c => s += c); process.stdin.on('end', () => console.log(JSON.parse(s).pack_id));")"
job_id="$(printf '%s' "${create_response}" | node -e "let s=''; process.stdin.on('data', c => s += c); process.stdin.on('end', () => console.log(JSON.parse(s).job_id));")"

echo "Waiting for job ${job_id}..."
job_response=''
for _ in {1..90}; do
  job_response="$(curl -fsS "http://localhost:${API_HOST_PORT}/api/jobs/${job_id}")"
  status="$(printf '%s' "${job_response}" | node -e "let s=''; process.stdin.on('data', c => s += c); process.stdin.on('end', () => console.log(JSON.parse(s).status));")"
  if [[ "${status}" == "completed" ]]; then
    break
  fi
  if [[ "${status}" == "failed" || "${status}" == "quarantined" ]]; then
    echo "study-pack job failed: ${job_response}"
    docker compose logs --tail=160 api
    exit 1
  fi
  sleep 1
done

if [[ "${status}" != "completed" ]]; then
  echo "study-pack job did not complete: ${job_response}"
  docker compose logs --tail=160 api
  exit 1
fi

echo "Validating completed study pack..."
pack_file="${tmp_dir}/pack.json"
cost_file="${tmp_dir}/costs.json"
metrics_file="${tmp_dir}/metrics.txt"
curl -fsS "http://localhost:${API_HOST_PORT}/api/study-packs/${pack_id}" > "${pack_file}"
curl -fsS "http://localhost:${API_HOST_PORT}/api/analytics/costs" > "${cost_file}"
curl -fsS "http://localhost:${API_HOST_PORT}/api/metrics/outcomes" > "${metrics_file}"

node - "${pack_file}" "${cost_file}" "${metrics_file}" <<'JS'
const fs = require('node:fs');
const [packPath, costPath, metricsPath] = process.argv.slice(2);
const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
const costs = JSON.parse(fs.readFileSync(costPath, 'utf8'));
const metrics = fs.readFileSync(metricsPath, 'utf8');

const fail = (message) => {
  console.error(`FAIL ${message}`);
  process.exit(1);
};

if (pack.readiness.status !== 'full') fail(`expected full pack, got ${pack.readiness.status}`);
if (pack.summaries.length !== 3) fail(`expected 3 summaries, got ${pack.summaries.length}`);
if (!Array.isArray(pack.glossary) || pack.glossary.length < 5) fail(`unexpected glossary count ${pack.glossary?.length ?? 0}`);
if (pack.flashcards.length < 15 || pack.flashcards.length > 25) fail(`unexpected flashcard count ${pack.flashcards.length}`);
if (pack.quiz_questions.length < 10 || pack.quiz_questions.length > 15) fail(`unexpected quiz count ${pack.quiz_questions.length}`);
if (!Array.isArray(pack.quiz_questions[0]?.misconceptions) || pack.quiz_questions[0].misconceptions.length !== 4) fail('missing quiz misconception checks');
if (!Array.isArray(pack.graph.nodes) || pack.graph.nodes.length === 0) fail('expected graph nodes');
if (!Array.isArray(pack.timeline)) fail('expected timeline array');
if (!pack.source_attribution?.revision_url?.includes('oldid=')) fail('expected revision attribution');
if (!pack.cache?.source || !Array.isArray(pack.cache.artifacts) || pack.cache.artifacts.length < 4) fail('expected source and artifact cache events');
if (typeof pack.grounding_stats?.citation_rate !== 'number' || pack.grounding_stats.citation_rate <= 0) fail('expected positive citation rate');
if (!costs.llm_ops?.calls) fail('expected llm_ops in cost analytics');
if (!metrics.includes('ultrawiki_jobs_completed_total')) fail('expected outcome metrics');
if (!metrics.includes('ultrawiki_llm_model_calls_total')) fail('expected LLM metrics');

console.log(`full study-pack smoke passed: pack=${pack.id} summaries=${pack.summaries.length} glossary=${pack.glossary.length} flashcards=${pack.flashcards.length} quiz=${pack.quiz_questions.length}`);
JS
