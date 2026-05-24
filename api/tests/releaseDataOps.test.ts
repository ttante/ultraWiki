import { describe, expect, it } from 'vitest';
import { validateReleaseDataOpsPlan, type ReleaseDataOpsPlan } from '../src/domain/releaseDataOps.js';

const validPlan: ReleaseDataOpsPlan = {
  version: '1.0.0',
  checks: [
    {
      id: 'migration-safety',
      gate: 'npm run gate:migration-safety',
      ticket_ids: ['T15.2', 'T10.2'],
      artifacts: ['infra/sql/migration-safety.json', 'api/scripts/migration-safety.ts']
    },
    {
      id: 'lifecycle-retention',
      gate: 'npm run gate:lifecycle-retention',
      ticket_ids: ['T19.1', 'T10.2'],
      artifacts: ['infra/retention/lifecycle-policy.json', 'api/scripts/lifecycle-maintenance.ts']
    },
    {
      id: 'backup-restore-drill',
      gate: 'npm run gate:backup-restore-drill',
      ticket_ids: ['T19.2', 'T10.2'],
      artifacts: ['infra/ops/backup-drills.json', 'infra/ops/reports/backup-restore-2026-05-20.md']
    }
  ]
};

describe('validateReleaseDataOpsPlan', () => {
  it('accepts the required migration, retention, and restore checks', () => {
    const result = validateReleaseDataOpsPlan(validPlan);
    expect(result.valid).toBe(true);
  });

  it('rejects missing required checks or ticket links', () => {
    const result = validateReleaseDataOpsPlan({
      version: '1.0.0',
      checks: [
        {
          id: 'migration-safety',
          gate: 'bash scripts/gate-migration-safety.sh',
          ticket_ids: ['T15.2'],
          artifacts: []
        }
      ]
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('gate must be an npm gate command');
    expect(result.errors.join(' ')).toContain('must link at least one artifact');
    expect(result.errors.join(' ')).toContain('missing ticket link: T10.2');
    expect(result.errors.join(' ')).toContain('missing required data-ops check: lifecycle-retention');
    expect(result.errors.join(' ')).toContain('missing required data-ops check: backup-restore-drill');
  });

  it('rejects duplicate check ids', () => {
    const result = validateReleaseDataOpsPlan({
      version: '1.0.0',
      checks: [validPlan.checks[0], validPlan.checks[0]]
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('duplicate check id');
  });
});
