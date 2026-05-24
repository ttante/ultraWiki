#!/usr/bin/env bash
set -euo pipefail

node --import tsx api/scripts/release-readiness.ts
