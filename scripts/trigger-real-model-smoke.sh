#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
api_base_url="${API_BASE_URL:-http://localhost:4000}"
endpoint="${api_base_url%/}/api/runtime/llm/smoke"
poll_interval_seconds="${REAL_MODEL_SMOKE_POLL_INTERVAL_SECONDS:-2}"
timeout_seconds="${REAL_MODEL_SMOKE_TIMEOUT_SECONDS:-900}"
confirm_payload='{"confirm":"run-real-model-smoke"}'
curl_bin="${REAL_MODEL_SMOKE_CURL_BIN:-curl}"

if [[ "${mode}" == "--dry-run" ]]; then
  echo "POST ${endpoint}"
  echo "body ${confirm_payload}"
  echo "GET ${endpoint}"
  exit 0
fi

if ! command -v "${curl_bin}" >/dev/null 2>&1; then
  echo "${curl_bin} is required"
  exit 1
fi

curl_auth_args=()
if [[ -n "${REAL_MODEL_SMOKE_API_TOKEN:-}" ]]; then
  curl_auth_args=(-H "authorization: Bearer ${REAL_MODEL_SMOKE_API_TOKEN}")
fi

status_field() {
  node -e "
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input);
  if (!payload.status) process.exit(1);
  console.log(payload.status);
});
"
}

echo "Triggering real-model smoke at ${endpoint}..."
start_response="$("${curl_bin}" -fsS -X POST "${endpoint}" "${curl_auth_args[@]}" -H 'content-type: application/json' -d "${confirm_payload}")"
start_status="$(printf '%s' "${start_response}" | status_field)"

if [[ "${start_status}" != "running" && "${start_status}" != "passed" ]]; then
  echo "${start_response}"
  echo "real-model smoke did not start"
  exit 1
fi

deadline=$((SECONDS + timeout_seconds))
while (( SECONDS < deadline )); do
  response="$("${curl_bin}" -fsS "${curl_auth_args[@]}" "${endpoint}")"
  status="$(printf '%s' "${response}" | status_field)"
  case "${status}" in
    passed)
      echo "${response}"
      echo "real-model smoke passed"
      exit 0
      ;;
    failed)
      echo "${response}"
      echo "real-model smoke failed"
      exit 1
      ;;
    running)
      sleep "${poll_interval_seconds}"
      ;;
    *)
      echo "${response}"
      echo "unexpected real-model smoke status: ${status}"
      exit 1
      ;;
  esac
done

echo "real-model smoke did not finish within ${timeout_seconds}s"
"${curl_bin}" -fsS "${curl_auth_args[@]}" "${endpoint}" || true
exit 1
