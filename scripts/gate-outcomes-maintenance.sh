#!/usr/bin/env bash
set -euo pipefail

migration_file="infra/sql/migrations/0007_maintenance_telemetry.sql"
maintenance_script="api/scripts/outcomes-maintenance.ts"
alert_file="infra/monitoring/prometheus/alerts/outcomes-slo-alerts.yml"
runbook_file="infra/monitoring/runbooks/outcomes-slo-alerts.md"

if [[ ! -f "$migration_file" ]]; then
  echo "missing migration file: $migration_file"
  exit 1
fi

if [[ ! -f "$maintenance_script" ]]; then
  echo "missing maintenance script: $maintenance_script"
  exit 1
fi

if [[ ! -f "$alert_file" ]]; then
  echo "missing alert rules file: $alert_file"
  exit 1
fi

if [[ ! -f "$runbook_file" ]]; then
  echo "missing runbook file: $runbook_file"
  exit 1
fi

if ! rg -q "CREATE OR REPLACE FUNCTION run_outcomes_maintenance_stats" "$migration_file"; then
  echo "run_outcomes_maintenance_stats function missing in $migration_file"
  exit 1
fi

if ! rg -q "CREATE TABLE IF NOT EXISTS outcomes_maintenance_runs" "$migration_file"; then
  echo "outcomes_maintenance_runs table missing in $migration_file"
  exit 1
fi

if ! rg -q "rollups_refreshed" "$migration_file"; then
  echo "rollups_refreshed telemetry fields missing in $migration_file"
  exit 1
fi

required_alerts=(
  UltraWikiOutcomesMaintenanceNeverRun
  UltraWikiOutcomesMaintenanceStale
  UltraWikiOutcomesMaintenanceDurationHigh
  UltraWikiOutcomesMaintenanceDurationSpike
  UltraWikiOutcomesMaintenancePruneSpike
)

for alert in "${required_alerts[@]}"; do
  if ! rg -q "alert: ${alert}" "$alert_file"; then
    echo "missing maintenance anomaly alert: ${alert}"
    exit 1
  fi

  anchor=$(printf '%s' "$alert" | tr '[:upper:]' '[:lower:]')
  if ! rg -q "#${anchor}" "$alert_file"; then
    echo "missing runbook link anchor for ${alert} in $alert_file"
    exit 1
  fi
  if ! rg -q "^### ${alert}$" "$runbook_file"; then
    echo "missing runbook section for ${alert} in $runbook_file"
    exit 1
  fi
done

if ! rg -q "avg_over_time\(ultrawiki_outcomes_maintenance_duration_ms\[7d\]\)" "$alert_file"; then
  echo "maintenance runtime spike alert must compare against 7-day baseline"
  exit 1
fi

if ! rg -q "ultrawiki_outcomes_maintenance_pruned_generation_outcomes_total > 50000" "$alert_file"; then
  echo "maintenance prune spike threshold missing for generation outcomes"
  exit 1
fi

if ! rg -q "time\(\) - ultrawiki_outcomes_maintenance_last_run_timestamp_seconds > 129600" "$alert_file"; then
  echo "maintenance stale-run threshold missing"
  exit 1
fi

echo "Running outcomes maintenance dry-run..."
OUTCOMES_MAINTENANCE_DRY_RUN=1 node --import tsx api/scripts/outcomes-maintenance.ts

echo "outcomes maintenance checks passed"
