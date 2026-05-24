import { describe, expect, it } from 'vitest';
import {
  requiredReadinessCommands,
  validateReleaseReadinessReport,
  type ReleaseReadinessReport
} from '../src/domain/releaseReadiness.js';

const tickets = [
  '### T1.1 Platform',
  'Priority: P0',
  '- Acceptance Criteria:',
  '  - [x] Works.',
  '',
  '### T2.1 Optional',
  'Priority: P2',
  '- Acceptance Criteria:',
  '  - [ ] Later.',
  '',
  '### T3.1 Release',
  'Priority: P1',
  '- Acceptance Criteria:',
  '  - [x] Works.'
].join('\n');

const validReport: ReleaseReadinessReport = {
  version: '1.0.0',
  release_candidate: 'mvp-local',
  generated_at: '2026-05-23T00:00:00Z',
  status: 'ready',
  required_gates: [...requiredReadinessCommands],
  evidence_groups: [
    {
      id: 'platform',
      ticket_ids: ['T1.1'],
      evidence: [{ label: 'smoke', command: 'npm run smoke' }]
    },
    {
      id: 'release',
      ticket_ids: ['T3.1'],
      evidence: [{ label: 'readiness doc', artifact: 'docs/release-readiness.md' }]
    }
  ]
};

describe('validateReleaseReadinessReport', () => {
  it('accepts readiness evidence that covers all P0/P1 tickets', () => {
    const result = validateReleaseReadinessReport(validReport, tickets);
    expect(result.valid).toBe(true);
    expect(result.coveredTickets).toBe(2);
  });

  it('rejects missing gates and missing P0/P1 ticket coverage', () => {
    const result = validateReleaseReadinessReport(
      {
        ...validReport,
        required_gates: ['npm run test'],
        evidence_groups: [validReport.evidence_groups[0]]
      },
      tickets
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('required_gates missing command: npm run lint');
    expect(result.errors.join(' ')).toContain('P0/P1 ticket missing readiness evidence: T3.1');
  });

  it('rejects blocked reports or unknown ticket references', () => {
    const result = validateReleaseReadinessReport(
      {
        ...validReport,
        status: 'blocked',
        evidence_groups: [
          ...validReport.evidence_groups,
          {
            id: 'unknown',
            ticket_ids: ['T9.9'],
            evidence: [{ label: '', command: 'npm run test' }]
          }
        ]
      },
      tickets
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('release status must be ready');
    expect(result.errors.join(' ')).toContain('unknown or non-P0/P1 ticket: T9.9');
    expect(result.errors.join(' ')).toContain('unlabeled evidence');
  });
});
