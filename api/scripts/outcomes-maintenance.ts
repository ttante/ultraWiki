import { Pool } from 'pg';

const toInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const rawDays = toInt(process.env.OUTCOMES_RAW_RETENTION_DAYS, 90);
const rollupDays = toInt(process.env.OUTCOMES_ROLLUP_RETENTION_DAYS, 730);
const dryRun = process.argv.includes('--dry-run') || process.env.OUTCOMES_MAINTENANCE_DRY_RUN === '1';

if (rawDays < 1) {
  console.error('OUTCOMES_RAW_RETENTION_DAYS must be >= 1');
  process.exit(1);
}

if (rollupDays < rawDays) {
  console.error('OUTCOMES_ROLLUP_RETENTION_DAYS must be >= OUTCOMES_RAW_RETENTION_DAYS');
  process.exit(1);
}

const run = async (): Promise<void> => {
  if (dryRun) {
    console.log(`Outcomes maintenance dry-run OK (raw=${rawDays}d, rollup=${rollupDays}d)`);
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query(
      'SELECT duration_ms, outcomes_pruned, quiz_attempts_pruned, rollups_refreshed FROM run_outcomes_maintenance_stats($1, $2)',
      [rawDays, rollupDays]
    );
    const row = result.rows[0] ?? {};
    console.log(
      JSON.stringify({
        msg: 'Outcomes maintenance complete',
        raw_days: rawDays,
        rollup_days: rollupDays,
        duration_ms: Number(row.duration_ms ?? 0),
        outcomes_pruned: Number(row.outcomes_pruned ?? 0),
        quiz_attempts_pruned: Number(row.quiz_attempts_pruned ?? 0),
        rollups_refreshed: Number(row.rollups_refreshed ?? 0)
      })
    );
  } finally {
    await pool.end();
  }
};

void run();
