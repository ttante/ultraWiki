#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for monitoring config checks"
  exit 1
fi

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Checking Prometheus config syntax..."
docker run --rm \
  -v "${root_dir}/infra/monitoring/prometheus:/etc/prometheus" \
  -v "${root_dir}/infra/monitoring/prometheus/alerts:/etc/prometheus/rules:ro" \
  --entrypoint promtool \
  prom/prometheus:v2.54.1 \
  check config /etc/prometheus/prometheus.yml

echo "Checking Prometheus rule syntax..."
docker run --rm \
  -v "${root_dir}/infra/monitoring/prometheus/alerts:/rules:ro" \
  --entrypoint promtool \
  prom/prometheus:v2.54.1 \
  check rules /rules/outcomes-slo-alerts.yml

echo "Checking Alertmanager config syntax..."
docker run --rm \
  -v "${root_dir}/infra/monitoring/alertmanager:/etc/alertmanager:ro" \
  --entrypoint amtool \
  prom/alertmanager:v0.27.0 \
  check-config /etc/alertmanager/alertmanager.yml

echo "monitoring config checks passed"
