#!/usr/bin/env bash
set -euo pipefail

npm run gate:migration-safety
npm run gate:lifecycle-retention
npm run gate:backup-restore-drill

node --import tsx api/scripts/release-data-ops.ts
