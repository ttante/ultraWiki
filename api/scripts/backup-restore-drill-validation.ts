import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BackupDrillFile, validateBackupDrillFile } from '../src/domain/backupDrill.js';

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '../..');
  const drillPath = path.resolve(root, 'infra/ops/backup-drills.json');
  const drillFile = JSON.parse(await readFile(drillPath, 'utf8')) as BackupDrillFile;
  const nowIso = process.env.BACKUP_DRILL_NOW_ISO ?? new Date().toISOString();
  let failed = 0;
  const baseValidation = validateBackupDrillFile(drillFile, nowIso);
  for (const error of baseValidation.errors) {
    failed += 1;
    console.error(`FAIL ${error}`);
  }

  const newestDrillId = baseValidation.newestDrillId ?? '';
  for (const drill of drillFile.drills) {
    const reportPath = path.resolve(root, drill.backup_artifact);
    try {
      await stat(reportPath);
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
