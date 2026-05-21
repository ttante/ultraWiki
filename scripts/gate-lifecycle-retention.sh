#!/usr/bin/env bash
set -euo pipefail

policy_file="infra/retention/lifecycle-policy.json"
migration_file="infra/sql/migrations/0009_lifecycle_retention.sql"
runner_script="api/scripts/lifecycle-maintenance.ts"

if [[ ! -f "$policy_file" ]]; then
  echo "missing policy file: $policy_file"
  exit 1
fi

if [[ ! -f "$migration_file" ]]; then
  echo "missing migration file: $migration_file"
  exit 1
fi

if [[ ! -f "$runner_script" ]]; then
  echo "missing lifecycle maintenance script: $runner_script"
  exit 1
fi

if ! rg -q "run_lifecycle_retention_stats" "$migration_file"; then
  echo "run_lifecycle_retention_stats function missing in $migration_file"
  exit 1
fi

if ! rg -q "lifecycle_maintenance_runs" "$migration_file"; then
  echo "lifecycle_maintenance_runs table missing in $migration_file"
  exit 1
fi

echo "Running lifecycle maintenance dry-run..."
LIFECYCLE_MAINTENANCE_DRY_RUN=1 node --import tsx api/scripts/lifecycle-maintenance.ts

echo "lifecycle retention checks passed"
