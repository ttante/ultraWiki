#!/usr/bin/env bash
set -euo pipefail

changed_files=""
if git rev-parse --verify HEAD^ >/dev/null 2>&1; then
  changed_files="$(git diff --name-only HEAD^..HEAD)"
fi

CHANGE_GATING_CHANGED_FILES="$changed_files" node --import tsx api/scripts/change-gating-policy.ts
