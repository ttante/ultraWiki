# Change Gating Policy

## Purpose
Prevent unqualified quality regressions when prompt/model/runtime code changes.

## Protected Change Paths
Configured in `infra/evaluation/change-gating-policy.json` under `protected_path_prefixes`.

## Required Checks
For protected changes, CI must include:
- `gate:golden-set`
- `gate:prompt-regression`

## Emergency Override Process
Overrides are recorded in `infra/evaluation/emergency-overrides.json`.

Each override must include:
- unique `id`
- `reason` (minimum actionable detail)
- `requestedBy`
- `createdAt`
- `expiresAt` (must be after `createdAt`)
- `followUpIssue` (`#<issue>` or ticket id like `T20.3`)

Policy constraints:
- TTL cannot exceed `max_override_ttl_days` in policy config.
- Expired overrides fail the gate.
- Missing follow-up issue fails the gate.

## Local Simulation
You can run:
- `npm run gate:change-gating-policy`

Optional environment variables:
- `CHANGE_GATING_CHANGED_FILES` (newline- or comma-separated file list)
- `CHANGE_GATING_OVERRIDE_ID` (override id to activate)
- `CHANGE_GATING_NOW_ISO` (fixed clock for testing)
