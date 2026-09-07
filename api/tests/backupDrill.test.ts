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
              restored_table_groups: {
                core: ['study_packs', 'saved_packs'],
                identity: ['user_profiles'],
                sharing: ['share_links'],
                learning: ['flashcard_reviews', 'learning_sessions', 'quiz_attempts', 'study_goals', 'generation_feedback'],
                analytics: [
                  'generation_outcomes',
                  'outcomes_daily_rollups',
                  'outcomes_maintenance_runs',
                  'stage_cost_events'
                ]
              },
              spot_check_identity_restore: true,
              spot_check_share_restore: true,
              spot_check_learning_restore: true,
              spot_check_analytics_restore: true,
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

  it('requires the newest drill to cover profile, share, learning, and analytics restore data', () => {
    const result = validateBackupDrillFile(
      {
        version: '1.0.0',
        schedule_cron: '11 4 * * 1',
        max_drill_age_days: 35,
        drills: [
          {
            id: 'drill-old',
            executed_at: '2026-05-20T00:00:00Z',
            outcome: 'passed',
            operator: 'oncall',
            backup_artifact: 'infra/ops/reports/drill-old.md',
            verification: {
              restored_tables_match: true,
              spot_check_pack_restore: true,
              notes: 'Legacy drill validated core table restore before identity coverage.'
            }
          },
          {
            id: 'drill-new',
            executed_at: '2026-05-21T00:00:00Z',
            outcome: 'passed',
            operator: 'oncall',
            backup_artifact: 'infra/ops/reports/drill-new.md',
            verification: {
              restored_tables_match: true,
              spot_check_pack_restore: true,
              restored_table_groups: {
                core: ['study_packs'],
                identity: [],
                sharing: ['share_links'],
                learning: ['flashcard_reviews'],
                analytics: ['outcomes_daily_rollups']
              },
              spot_check_identity_restore: false,
              spot_check_share_restore: true,
              spot_check_learning_restore: false,
              spot_check_analytics_restore: true,
              notes: 'Incomplete newest drill coverage should fail validation.'
            }
          }
        ]
      },
      '2026-05-22T00:00:00Z'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('group=identity table=user_profiles');
    expect(result.errors.join(' ')).toContain('group=learning table=learning_sessions');
    expect(result.errors.join(' ')).toContain('group=learning table=generation_feedback');
    expect(result.errors.join(' ')).toContain('group=analytics table=generation_outcomes');
    expect(result.errors.join(' ')).toContain('missing identity restore spot check');
    expect(result.errors.join(' ')).toContain('missing learning restore spot check');
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
              restored_table_groups: {
                core: ['study_packs', 'saved_packs'],
                identity: ['user_profiles'],
                sharing: ['share_links'],
                learning: ['flashcard_reviews', 'learning_sessions', 'quiz_attempts', 'study_goals', 'generation_feedback'],
                analytics: [
                  'generation_outcomes',
                  'outcomes_daily_rollups',
                  'outcomes_maintenance_runs',
                  'stage_cost_events'
                ]
              },
              spot_check_identity_restore: true,
              spot_check_share_restore: true,
              spot_check_learning_restore: true,
              spot_check_analytics_restore: true,
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
