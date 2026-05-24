import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BackupDrillFile, validateBackupDrillFile } from '../src/domain/backupDrill.js';

const quotedCron = (cron: string): string[] => [`cron: "${cron}"`, `cron: '${cron}'`];

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '../..');
  const drillPath = path.resolve(root, 'infra/ops/backup-drills.json');
  const workflowPath = path.resolve(root, '.github/workflows/backup-restore-drill.yml');
  const drillFile = JSON.parse(await readFile(drillPath, 'utf8')) as BackupDrillFile;
  const workflow = await readFile(workflowPath, 'utf8');
  const nowIso = process.env.BACKUP_DRILL_NOW_ISO ?? new Date().toISOString();
  let failed = 0;
  const baseValidation = validateBackupDrillFile(drillFile, nowIso);
  for (const error of baseValidation.errors) {
    failed += 1;
    console.error(`FAIL ${error}`);
  }

  if (!quotedCron(drillFile.schedule_cron).some((needle) => workflow.includes(needle))) {
    failed += 1;
    console.error(`FAIL workflow schedule does not match schedule_cron=${drillFile.schedule_cron}`);
  }

  const newestDrillId = baseValidation.newestDrillId ?? '';
  for (const drill of drillFile.drills) {
    const reportPath = path.resolve(root, drill.backup_artifact);
    try {
      const report = await readFile(reportPath, 'utf8');
      if (!report.includes(drill.id)) {
        failed += 1;
        console.error(`FAIL drill=${drill.id} report does not reference drill id`);
      }
      if (!/Outcome:\s*`passed`/i.test(report)) {
        failed += 1;
        console.error(`FAIL drill=${drill.id} report does not record passed outcome`);
      }
      if (!/Restored tables match.*`true`/i.test(report)) {
        failed += 1;
        console.error(`FAIL drill=${drill.id} report missing restored table verification`);
      }
      if (!/Spot-check pack restore.*`true`/i.test(report)) {
        failed += 1;
        console.error(`FAIL drill=${drill.id} report missing pack restore verification`);
      }
    } catch {
      failed += 1;
      console.error(`FAIL drill=${drill.id} report missing at ${drill.backup_artifact}`);
    }
  }

  if (failed > 0) {
    process.exit(1);
  }

  console.log(
    `Backup/restore drill validation passed: drills=${drillFile.drills.length} newest=${newestDrillId} max_age_days=${drillFile.max_drill_age_days}`
  );
};

void run();
