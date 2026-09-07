#!/usr/bin/env bash
set -euo pipefail

npm exec -w @ultrawiki/api -- vitest run tests/reliability.test.ts --coverage.enabled=false
