import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { validateLifecycleRetentionPolicy, type LifecycleRetentionPolicy } from '../src/domain/lifecycleRetention.js';

const dryRun = process.argv.includes('--dry-run') || process.env.LIFECYCLE_MAINTENANCE_DRY_RUN === '1';

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const policyPath = path.resolve(scriptDir, '../../infra/retention/lifecycle-policy.json');
  const policy = JSON.parse(await readFile(policyPath, 'utf8')) as LifecycleRetentionPolicy;
  const validation = validateLifecycleRetentionPolicy(policy);

  if (!validation.valid) {
    for (const error of validation.errors) {
      console.error(`FAIL policy ${error}`);
    }
    process.exit(1);
  }

  const days = policy.retention_days;

  if (dryRun) {
    const externalControls = policy.enforcement
      .filter((control) => control.mode === 'external_control')
      .map((control) => control.scope)
      .join(',');
    console.log(
      `Lifecycle maintenance dry-run OK (idempotency=${days.idempotency_keys}d jobs=${days.jobs_failed_or_quarantined}d artifacts=${days.artifacts_and_packs}d telemetry=${days.cost_telemetry}d external_controls=${externalControls})`
    );
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
      'SELECT duration_ms, idempotency_pruned, jobs_pruned, packs_pruned, stage_cost_events_pruned FROM run_lifecycle_retention_stats($1, $2, $3, $4)',
      [days.idempotency_keys, days.jobs_failed_or_quarantined, days.artifacts_and_packs, days.cost_telemetry]
    );
    const row = result.rows[0] ?? {};
    console.log(
      JSON.stringify({
        msg: 'Lifecycle maintenance complete',
        duration_ms: Number(row.duration_ms ?? 0),
        idempotency_pruned: Number(row.idempotency_pruned ?? 0),
        jobs_pruned: Number(row.jobs_pruned ?? 0),
        packs_pruned: Number(row.packs_pruned ?? 0),
        stage_cost_events_pruned: Number(row.stage_cost_events_pruned ?? 0)
      })
    );
  } finally {
    await pool.end();
  }
};

void run();
