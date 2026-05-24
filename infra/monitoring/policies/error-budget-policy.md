# Error Budget Release Policy

## Scope
This policy controls release risk based on SLO burn-rate signals.

## Inputs
- `burnRate5m`, `burnRate1h`
- `burnRate30m`, `burnRate6h`
- `requestsRate1h`, `requestsRate6h`

## Release Decisions
- `allow`: normal release and deploy throughput.
- `restricted`: only fixes and low-risk changes are allowed.
- `freeze`: block non-mitigation releases until burn returns below threshold.

## Change Classes
- `standard`: user-facing feature work, dependency upgrades, schema changes, and routine refactors.
- `low_risk`: small bug fixes, test-only changes, documentation, dashboard/query updates, and isolated operational fixes.
- `mitigation`: rollback, config clamp, hotfix, or runtime change intended to reduce active SLO burn.

## Thresholds
- Warning burn threshold: `6x` on both `30m` and `6h` windows.
- Critical burn threshold: `14.4x` on both `5m` and `1h` windows.
- Minimum traffic guard: require `> 0.01` req/s on matching window to avoid low-volume noise.

## Mapping
- `critical`: `burnRate5m > 14.4` AND `burnRate1h > 14.4` AND `requestsRate1h > 0.01` => `freeze`
- `warning`: `burnRate30m > 6` AND `burnRate6h > 6` AND `requestsRate6h > 0.01` => `restricted`
- otherwise => `allow`

## Release Gate Matrix
- `allow`: pass `standard`, `low_risk`, and `mitigation` changes.
- `restricted`: block `standard`; pass `low_risk` and `mitigation`.
- `freeze`: block `standard` and `low_risk`; pass only `mitigation`.

## CI Enforcement
- Gate command: `npm run gate:error-budget-policy`
- Simulated scenarios are stored in `infra/monitoring/fixtures/error-budget-policy-scenarios.json`.
- CI fails if thresholds, release rules, expected burn-rate decisions, or expected release-gate outcomes diverge from policy logic.
