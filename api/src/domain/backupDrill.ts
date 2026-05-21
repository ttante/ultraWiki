export type BackupDrill = {
  id: string;
  executed_at: string;
  outcome: 'passed' | 'failed';
  operator: string;
  backup_artifact: string;
  verification: {
    restored_tables_match: boolean;
    spot_check_pack_restore: boolean;
    notes: string;
  };
};

export type BackupDrillFile = {
  version: string;
  schedule_cron: string;
  max_drill_age_days: number;
  drills: BackupDrill[];
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const validateBackupDrillFile = (
  file: BackupDrillFile,
  nowIso: string
): { valid: boolean; errors: string[]; newestDrillId: string | null } => {
  const errors: string[] = [];
  const nowMs = Date.parse(nowIso);
  const cronFields = file.schedule_cron.trim().split(/\s+/);

  if (!file.schedule_cron || cronFields.length !== 5) {
    errors.push('schedule_cron missing or invalid');
  }

  if (!Number.isInteger(file.max_drill_age_days) || file.max_drill_age_days < 1) {
    errors.push('max_drill_age_days must be an integer >= 1');
  }

  if (file.drills.length === 0) {
    errors.push('no drills recorded');
    return { valid: false, errors, newestDrillId: null };
  }

  let newestDrillMs = 0;
  let newestDrillId: string | null = null;

  for (const drill of file.drills) {
    const executedMs = Date.parse(drill.executed_at);
    if (!Number.isFinite(executedMs)) {
      errors.push(`drill=${drill.id} invalid executed_at`);
      continue;
    }
    if (executedMs > newestDrillMs) {
      newestDrillMs = executedMs;
      newestDrillId = drill.id;
    }
    if (drill.outcome !== 'passed') {
      errors.push(`drill=${drill.id} outcome=${drill.outcome}`);
    }
    if (!drill.verification.restored_tables_match || !drill.verification.spot_check_pack_restore) {
      errors.push(`drill=${drill.id} restore verification failed`);
    }
    if (drill.verification.notes.trim().length < 10) {
      errors.push(`drill=${drill.id} verification notes too short`);
    }
  }

  if (newestDrillMs > 0) {
    const ageDays = (nowMs - newestDrillMs) / MS_PER_DAY;
    if (ageDays > file.max_drill_age_days) {
      errors.push(`newest drill stale: age_days=${ageDays.toFixed(2)} max=${file.max_drill_age_days}`);
    }
  }

  return { valid: errors.length === 0, errors, newestDrillId };
};
