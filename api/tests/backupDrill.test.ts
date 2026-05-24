import { describe, expect, it } from 'vitest';
import { validateBackupDrillFile } from '../src/domain/backupDrill.js';

describe('validateBackupDrillFile', () => {
  it('passes a fresh successful drill set', () => {
    const result = validateBackupDrillFile(
      {
        version: '1.0.0',
        schedule_cron: '11 4 * * 1',
        max_drill_age_days: 35,
        drills: [
          {
            id: 'drill-1',
            executed_at: '2026-05-20T00:00:00Z',
            outcome: 'passed',
            operator: 'oncall',
            backup_artifact: 'infra/ops/reports/drill-1.md',
            verification: {
              restored_tables_match: true,
              spot_check_pack_restore: true,
              notes: 'Validated restore table integrity and sample row retrieval.'
            }
          }
        ]
      },
      '2026-05-21T00:00:00Z'
    );
    expect(result.valid).toBe(true);
  });

  it('fails stale or unsuccessful drill entries', () => {
    const result = validateBackupDrillFile(
      {
        version: '1.0.0',
        schedule_cron: 'invalid',
        max_drill_age_days: 7,
        drills: [
          {
            id: 'drill-old',
            executed_at: '2026-04-01T00:00:00Z',
            outcome: 'failed',
            operator: '',
            backup_artifact: 'report.md',
            verification: {
              restored_tables_match: false,
              spot_check_pack_restore: true,
              notes: 'too short'
            }
          }
        ]
      },
      '2026-05-21T00:00:00Z'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('schedule_cron');
    expect(result.errors.join(' ')).toContain('outcome=failed');
    expect(result.errors.join(' ')).toContain('stale');
    expect(result.errors.join(' ')).toContain('operator is required');
    expect(result.errors.join(' ')).toContain('backup_artifact');
  });

  it('rejects drills dated in the future', () => {
    const result = validateBackupDrillFile(
      {
        version: '1.0.0',
        schedule_cron: '11 4 * * 1',
        max_drill_age_days: 35,
        drills: [
          {
            id: 'drill-future',
            executed_at: '2026-05-22T00:00:00Z',
            outcome: 'passed',
            operator: 'oncall',
            backup_artifact: 'infra/ops/reports/drill-future.md',
            verification: {
              restored_tables_match: true,
              spot_check_pack_restore: true,
              notes: 'Validated restore table integrity and sample row retrieval.'
            }
          }
        ]
      },
      '2026-05-21T00:00:00Z'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('future');
  });
});
