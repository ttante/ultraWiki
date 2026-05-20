#!/usr/bin/env bash
set -euo pipefail

migration_file="infra/sql/migrations/0007_maintenance_telemetry.sql"
maintenance_script="api/scripts/outcomes-maintenance.ts"

if [[ ! -f "$migration_file" ]]; then
  echo "missing migration file: $migration_file"
  exit 1
fi

if [[ ! -f "$maintenance_script" ]]; then
  echo "missing maintenance script: $maintenance_script"
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

echo "Running outcomes maintenance dry-run..."
OUTCOMES_MAINTENANCE_DRY_RUN=1 node --import tsx api/scripts/outcomes-maintenance.ts

echo "outcomes maintenance checks passed"
