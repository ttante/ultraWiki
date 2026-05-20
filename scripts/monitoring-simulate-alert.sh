#!/usr/bin/env bash
set -euo pipefail

PROM_URL="${PROM_URL:-http://localhost:9090}"
ALERTMANAGER_URL="${ALERTMANAGER_URL:-http://localhost:9093}"
PUSHGATEWAY_URL="${PUSHGATEWAY_URL:-http://localhost:9091}"

echo "Pushing synthetic alert metric to Pushgateway..."
printf 'ultrawiki_synthetic_alert 1\n' | curl -fsS --data-binary @- "${PUSHGATEWAY_URL}/metrics/job/ultrawiki-sim"

echo "Waiting for Prometheus to evaluate alert rule..."
prom_fired=0
for _ in $(seq 1 24); do
  if curl -fsS "${PROM_URL}/api/v1/alerts" | grep -q '"alertname":"UltraWikiSyntheticAlert"'; then
    prom_fired=1
    break
  fi
  sleep 5
done

if [[ "${prom_fired}" -ne 1 ]]; then
  echo "Synthetic alert not found in Prometheus within timeout."
  exit 1
fi

echo "Prometheus alert observed. Checking Alertmanager..."
am_seen=0
for _ in $(seq 1 24); do
  if curl -fsS "${ALERTMANAGER_URL}/api/v2/alerts" | grep -q '"alertname":"UltraWikiSyntheticAlert"'; then
    am_seen=1
    break
  fi
  sleep 5
done

if [[ "${am_seen}" -ne 1 ]]; then
  echo "Synthetic alert not found in Alertmanager within timeout."
  exit 1
fi

echo "Alert reached Alertmanager."
echo "Cleaning up synthetic metric..."
curl -fsS -X DELETE "${PUSHGATEWAY_URL}/metrics/job/ultrawiki-sim" >/dev/null
echo "Done."
