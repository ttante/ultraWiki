#!/usr/bin/env bash
set -euo pipefail

npm exec -w @ultrawiki/api vitest run tests/contracts.test.ts --coverage.enabled=false
