#!/usr/bin/env bash
set -euo pipefail

npm exec -w @ultrawiki/api -- vitest run --testNamePattern "runs the full critical-flow smoke through API routes" tests/routes.test.ts --coverage.enabled=false
npm exec -w @ultrawiki/web -- vitest run --testNamePattern "runs the full critical-flow smoke in the app shell" tests/study-pack-app.test.tsx --coverage.enabled=false
