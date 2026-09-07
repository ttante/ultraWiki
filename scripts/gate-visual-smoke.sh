#!/usr/bin/env bash
set -euo pipefail

npm exec -w @ultrawiki/web -- vitest run --testNamePattern "keeps critical UI visual smoke landmarks covered" tests/study-pack-app.test.tsx --coverage.enabled=false
