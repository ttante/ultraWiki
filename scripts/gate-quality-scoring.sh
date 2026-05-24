#!/usr/bin/env bash
set -euo pipefail

node --import tsx api/scripts/quality-scoring.ts
