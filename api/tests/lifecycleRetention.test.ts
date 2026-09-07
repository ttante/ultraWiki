import { describe, expect, it } from 'vitest';
import { validateLifecycleRetentionPolicy } from '../src/domain/lifecycleRetention.js';

describe('validateLifecycleRetentionPolicy', () => {
  it('accepts a valid policy with documented exceptions', () => {
    const result = validateLifecycleRetentionPolicy({
      version: '1.0.0',
      retention_days: {
        logs: 30,
        traces: 14,
        idempotency_keys: 30,
        jobs_failed_or_quarantined: 30,
        artifacts_and_packs: 365,
        cost_telemetry: 180,
        user_profiles: 730,
        share_links: 90,
        learning_reviews: 365
      },
      enforcement: [
        {
          scope: 'logs',
          mode: 'external_control',
          control: 'Deployment log sink retention policy set to 30 days.'
        },
        {
          scope: 'traces',
          mode: 'external_control',
          control: 'OpenTelemetry backend retention policy set to 14 days.'
        },
        {
          scope: 'idempotency_keys',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats idempotency_days argument'
        },
        {
          scope: 'jobs_failed_or_quarantined',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats job_days argument'
        },
        {
          scope: 'artifacts_and_packs',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats artifact_days argument'
        },
        {
          scope: 'cost_telemetry',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats telemetry_days argument'
        },
        {
          scope: 'user_profiles',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats profile_days argument'
        },
        {
          scope: 'share_links',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats share_days argument'
        },
        {
          scope: 'learning_reviews',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats learning_review_days argument'
        }
      ],
      exceptions: [
        {
          scope: 'security_events',
          retention_days: 365,
          reason: 'Keep long enough for incident response and forensic correlation.'
        }
      ]
    });
    expect(result.valid).toBe(true);
  });

  it('rejects invalid retention windows or missing exceptions', () => {
    const result = validateLifecycleRetentionPolicy({
      version: '1.0.0',
      retention_days: {
        logs: 0,
        traces: 14,
        idempotency_keys: 30,
        jobs_failed_or_quarantined: 40,
        artifacts_and_packs: 10,
        cost_telemetry: 180,
        user_profiles: 120,
        share_links: 90,
        learning_reviews: 365
      },
      enforcement: [],
      exceptions: []
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('retention_days.logs');
    expect(result.errors.join(' ')).toContain('at least one policy exception');
    expect(result.errors.join(' ')).toContain('artifacts_and_packs');
    expect(result.errors.join(' ')).toContain('user_profiles');
    expect(result.errors.join(' ')).toContain('retention enforcement controls');
  });

  it('requires database-backed scopes to use the lifecycle DB function', () => {
    const result = validateLifecycleRetentionPolicy({
      version: '1.0.0',
      retention_days: {
        logs: 30,
        traces: 14,
        idempotency_keys: 30,
        jobs_failed_or_quarantined: 30,
        artifacts_and_packs: 365,
        cost_telemetry: 180,
        user_profiles: 730,
        share_links: 90,
        learning_reviews: 365
      },
      enforcement: [
        {
          scope: 'logs',
          mode: 'external_control',
          control: 'Deployment log sink retention policy set to 30 days.'
        },
        {
          scope: 'traces',
          mode: 'external_control',
          control: 'OpenTelemetry backend retention policy set to 14 days.'
        },
        {
          scope: 'idempotency_keys',
          mode: 'external_control',
          control: 'Incorrectly delegated idempotency cleanup to an external system.'
        },
        {
          scope: 'jobs_failed_or_quarantined',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats job_days argument'
        },
        {
          scope: 'artifacts_and_packs',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats artifact_days argument'
        },
        {
          scope: 'cost_telemetry',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats telemetry_days argument'
        },
        {
          scope: 'user_profiles',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats profile_days argument'
        },
        {
          scope: 'share_links',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats share_days argument'
        },
        {
          scope: 'learning_reviews',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats learning_review_days argument'
        }
      ],
      exceptions: [
        {
          scope: 'security_events',
          retention_days: 365,
          reason: 'Keep long enough for incident response and forensic correlation.'
        }
      ]
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('enforcement.idempotency_keys must use db_function');
  });

  it('requires profile retention to cover dependent learning review data', () => {
    const result = validateLifecycleRetentionPolicy({
      version: '1.1.0',
      retention_days: {
        logs: 30,
        traces: 14,
        idempotency_keys: 30,
        jobs_failed_or_quarantined: 30,
        artifacts_and_packs: 365,
        cost_telemetry: 180,
        user_profiles: 30,
        share_links: 90,
        learning_reviews: 365
      },
      enforcement: [
        {
          scope: 'logs',
          mode: 'external_control',
          control: 'Deployment log sink retention policy set to 30 days.'
        },
        {
          scope: 'traces',
          mode: 'external_control',
          control: 'OpenTelemetry backend retention policy set to 14 days.'
        },
        {
          scope: 'idempotency_keys',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats idempotency_days argument'
        },
        {
          scope: 'jobs_failed_or_quarantined',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats job_days argument'
        },
        {
          scope: 'artifacts_and_packs',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats artifact_days argument'
        },
        {
          scope: 'cost_telemetry',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats telemetry_days argument'
        },
        {
          scope: 'user_profiles',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats profile_days argument'
        },
        {
          scope: 'share_links',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats share_days argument'
        },
        {
          scope: 'learning_reviews',
          mode: 'db_function',
          control: 'run_lifecycle_retention_stats learning_review_days argument'
        }
      ],
      exceptions: [
        {
          scope: 'security_events',
          retention_days: 365,
          reason: 'Keep long enough for incident response and forensic correlation.'
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('retention_days.user_profiles must be >=');
  });
});
