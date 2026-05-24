#!/usr/bin/env bash
set -euo pipefail

npm exec -w @ultrawiki/api vitest run tests/contracts.test.ts --coverage.enabled=false
npm exec -w @ultrawiki/api vitest run tests/contractSnapshots.test.ts --coverage.enabled=false
node --import tsx api/scripts/contract-snapshots.ts
