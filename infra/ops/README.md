# Backup and Restore Drills

Drill log source: `infra/ops/backup-drills.json`.

## Schedule
- Weekly drill target: cron in drill log and workflow (`.github/workflows/backup-restore-drill.yml`).

## Validation
- CI/manual validation gate:
  - `npm run gate:backup-restore-drill`
- Checks include:
  - drill recency window,
  - workflow cron matches `schedule_cron`,
  - successful outcome,
  - restore verification flags,
  - linked report artifact exists,
  - report references the drill id, passed outcome, restored-table check, and pack restore check,
  - newest drill covers profile, saved-library, share-link, learning review/session/goal, quiz attempt, and analytics rollup tables.

## Reports
- Store each drill report under `infra/ops/reports/`.
