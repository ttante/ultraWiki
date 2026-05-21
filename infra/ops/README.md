# Backup and Restore Drills

Drill log source: `infra/ops/backup-drills.json`.

## Schedule
- Weekly drill target: cron in drill log and workflow (`.github/workflows/backup-restore-drill.yml`).

## Validation
- CI/manual validation gate:
  - `npm run gate:backup-restore-drill`
- Checks include:
  - drill recency window,
  - successful outcome,
  - restore verification flags,
  - linked report artifact exists.

## Reports
- Store each drill report under `infra/ops/reports/`.
