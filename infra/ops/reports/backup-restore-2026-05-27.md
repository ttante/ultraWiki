# Backup Restore Drill Report - 2026-05-27

- Drill ID: `backup-restore-2026-05-27`
- Outcome: `passed`
- Operator: `platform-oncall`

## Procedure
1. Created a logical backup from the primary Postgres instance after seeding the drill rows.
2. Restored backup into an isolated verification database.
3. Verified required tables exist and are queryable.
4. Performed spot-check reads for a generated pack, local profile, share link, learning state, generation feedback row, and analytics rollup.

## Restored Table Coverage
- Core: `study_packs`, `saved_packs`
- Identity: `user_profiles`
- Sharing: `share_links`
- Learning: `flashcard_reviews`, `learning_sessions`, `quiz_attempts`, `study_goals`, `generation_feedback`
- Analytics: `generation_outcomes`, `outcomes_daily_rollups`, `outcomes_maintenance_runs`, `stage_cost_events`

## Verification Summary
- Restored tables match expected schema set: `true`
- Spot-check pack restore: `true`
- Identity profile restore: `true`
- Share link restore: `true`
- Learning data restore: `true`
- Generation feedback data restore: `true`
- Analytics rollup restore: `true`

## Follow-up
- No corrective action required.
