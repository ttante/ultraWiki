DROP FUNCTION IF EXISTS run_outcomes_maintenance(INT, INT);
DROP FUNCTION IF EXISTS apply_outcomes_retention(INT, INT);
DROP FUNCTION IF EXISTS refresh_outcomes_daily_rollups(DATE, DATE);
DROP TABLE IF EXISTS outcomes_daily_rollups;
