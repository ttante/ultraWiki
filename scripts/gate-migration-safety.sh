#!/usr/bin/env bash
set -euo pipefail

migrations_dir="infra/sql/migrations"

if [[ ! -d "$migrations_dir" ]]; then
  echo "missing migrations directory: $migrations_dir"
  exit 1
fi

up_files=$(find "$migrations_dir" -maxdepth 1 -type f -name '*.sql' | sed 's#^.*/##' | grep -Ev '_down\.sql$' | sort)

for up in $up_files; do
  prefix="${up%%_*}"
  down="${prefix}_down.sql"
  if [[ ! -f "$migrations_dir/$down" ]]; then
    echo "missing down migration for $up (expected $down)"
    exit 1
  fi
done

echo "migration safety check passed"
