# Benchmark Waiver Policy

## Purpose
Allow short-lived bypasses for benchmark regressions caused by known, external, temporary conditions while preserving accountability.

## Default Rule
- `npm run gate:bench-regression` must pass.
- Regressions fail CI by default.

## Temporary Waiver
Set `BENCH_WAIVER_ID=<id>` for a matching entry in `infra/evaluation/benchmark-waivers.json`.

Required waiver fields:
- `id`
- `reason` (actionable)
- `approvedBy`
- `createdAt`
- `expiresAt`
- `followUpIssue` (`#<issue>` or ticket id like `T17.3`)

Validation:
- `infra/evaluation/benchmark-waivers.json` sets `maxWaiverTtlDays`; default policy is 7 days.
- Invalid or expired waivers fail the gate.
- Duplicate waiver IDs fail the gate.
- Waivers with TTL longer than `maxWaiverTtlDays` fail the gate.
- Expired waivers fail the gate even when not selected, so stale bypasses cannot remain in-repo.
- Waivers are for temporary risk acceptance and must include a follow-up fix ticket.

## Usage
- Standard: `npm run gate:bench-regression`
- With waiver: `BENCH_WAIVER_ID=<id> npm run gate:bench-regression`
