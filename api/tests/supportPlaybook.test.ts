import { describe, expect, it } from 'vitest';
import { validateSupportPlaybook, type TabletopFile } from '../src/domain/supportPlaybook.js';

const playbook = [
  '# UltraWiki Support Playbook',
  '## Common Failure: Timeouts',
  '## Common Failure: Malformed Pages',
  '## Common Failure: Model Overload',
  '## Escalation Procedure',
  '## Rollback Procedure'
].join('\n');

const validTabletop: TabletopFile = {
  version: '1.0.0',
  exercises: [
    {
      id: 'tabletop-timeouts',
      scenario: 'timeouts',
      executed_at: '2026-05-20T15:00:00Z',
      outcome: 'passed',
      facilitator: 'support-lead',
      notes: 'Validated timeout triage, escalation, and rollback checklist.'
    },
    {
      id: 'tabletop-malformed',
      scenario: 'malformed_pages',
      executed_at: '2026-05-20T16:00:00Z',
      outcome: 'passed',
      facilitator: 'support-lead',
      notes: 'Validated parser quarantine and malformed page recovery steps.'
    },
    {
      id: 'tabletop-model',
      scenario: 'model_overload',
      executed_at: '2026-05-20T17:00:00Z',
      outcome: 'passed',
      facilitator: 'support-lead',
      notes: 'Validated runtime rollback and degradation messaging flow.'
    }
  ]
};

describe('validateSupportPlaybook', () => {
  it('passes complete playbook and tabletop coverage', () => {
    const result = validateSupportPlaybook(playbook, validTabletop, '2026-05-21T00:00:00Z');
    expect(result.valid).toBe(true);
    expect(result.passedCount).toBe(3);
  });

  it('fails missing headings and scenario coverage', () => {
    const result = validateSupportPlaybook(
      playbook.replace('## Common Failure: Malformed Pages', ''),
      {
        version: '1.0.0',
        exercises: validTabletop.exercises.filter((entry) => entry.scenario !== 'malformed_pages')
      },
      '2026-05-21T00:00:00Z'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('playbook missing heading');
    expect(result.errors.join(' ')).toContain('scenario=malformed_pages');
  });

  it('fails stale, future, and incomplete tabletop exercises', () => {
    const result = validateSupportPlaybook(
      playbook,
      {
        version: '1.0.0',
        exercises: [
          {
            id: 'tabletop-old-timeouts',
            scenario: 'timeouts',
            executed_at: '2026-01-01T00:00:00Z',
            outcome: 'passed',
            facilitator: '',
            notes: 'short'
          },
          {
            id: 'tabletop-future-malformed',
            scenario: 'malformed_pages',
            executed_at: '2026-05-22T00:00:00Z',
            outcome: 'passed',
            facilitator: 'support-lead',
            notes: 'Validated malformed page quarantine and parser rollback.'
          }
        ]
      },
      '2026-05-21T00:00:00Z'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('scenario=model_overload');
    expect(result.errors.join(' ')).toContain('future');
    expect(result.errors.join(' ')).toContain('facilitator is required');
    expect(result.errors.join(' ')).toContain('notes too short');
  });
});
