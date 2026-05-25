#!/usr/bin/env bash
set -euo pipefail

test -x scripts/doctor-local-llm.sh
node --import tsx api/scripts/local-llm-doctor.ts >/dev/null
node --import tsx api/scripts/local-llm-config.ts
