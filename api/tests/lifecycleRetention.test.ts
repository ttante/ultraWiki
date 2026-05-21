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
        cost_telemetry: 180
      },
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
        cost_telemetry: 180
      },
      exceptions: []
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('retention_days.logs');
    expect(result.errors.join(' ')).toContain('at least one policy exception');
    expect(result.errors.join(' ')).toContain('artifacts_and_packs');
  });
});
