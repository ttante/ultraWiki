import { describe, expect, it } from 'vitest';
import { evaluateChangeGate, type ChangeGatingPolicy, type EmergencyOverride } from '../src/domain/changeGatingPolicy.js';

const policy: ChangeGatingPolicy = {
  requiredChecks: ['gate:quality-scoring', 'gate:golden-set', 'gate:prompt-regression', 'gate:bench-regression'],
  protectedPathPrefixes: [
    'infra/prompts/',
    'infra/evaluation/quality-',
    'infra/evaluation/prompt-',
    'infra/evaluation/benchmark-',
    'api/benchmarks/',
    'api/scripts/prompt-eval.ts',
    'api/scripts/bench.ts',
    'api/src/domain/',
    'api/src/routes/',
    'api/src/config.ts'
  ],
  maxOverrideTtlDays: 7
};

const nowIso = '2026-05-20T12:00:00.000Z';

const validOverride: EmergencyOverride = {
  id: 'ovr-001',
  reason: 'Golden set gate is flaky due to unrelated infra outage.',
  requestedBy: 'release-manager',
  createdAt: '2026-05-20T00:00:00.000Z',
  expiresAt: '2026-05-22T00:00:00.000Z',
  followUpIssue: '#123'
};

describe('evaluateChangeGate', () => {
  it('passes when protected changes have required gates in workflow', () => {
    const result = evaluateChangeGate({
      changedFiles: ['infra/prompts/registry.json'],
      workflowChecks: [
        'gate:contracts',
        'gate:quality-scoring',
        'gate:golden-set',
        'gate:prompt-regression',
        'gate:bench-regression'
      ],
      nowIso,
      policy,
      overrides: []
    });
    expect(result.pass).toBe(true);
    expect(result.requiresQualityGates).toBe(true);
  });

  it('fails when protected changes are missing required quality gates', () => {
    const result = evaluateChangeGate({
      changedFiles: ['api/src/config.ts'],
      workflowChecks: ['gate:contracts', 'gate:quality-scoring', 'gate:golden-set'],
      nowIso,
      policy,
      overrides: []
    });
    expect(result.pass).toBe(false);
    expect(result.failures.join(' ')).toContain('gate:prompt-regression');
    expect(result.failures.join(' ')).toContain('gate:bench-regression');
  });

  it('requires quality and benchmark gates for runtime performance changes', () => {
    const result = evaluateChangeGate({
      changedFiles: ['api/benchmarks/baseline.json', 'infra/evaluation/benchmark-waivers.json'],
      workflowChecks: ['gate:quality-scoring', 'gate:golden-set', 'gate:prompt-regression'],
      nowIso,
      policy,
      overrides: []
    });
    expect(result.pass).toBe(false);
    expect(result.requiresQualityGates).toBe(true);
    expect(result.failures).toEqual(['missing required checks for protected changes: gate:bench-regression']);
  });

  it('allows missing checks when a valid emergency override is used', () => {
    const result = evaluateChangeGate({
      changedFiles: ['api/src/domain/summary.ts'],
      workflowChecks: ['gate:contracts'],
      overrideId: 'ovr-001',
      nowIso,
      policy,
      overrides: [validOverride]
    });
    expect(result.pass).toBe(true);
    expect(result.usedOverride).toBe(true);
  });

  it('fails when override is expired or missing follow-up ticket', () => {
    const result = evaluateChangeGate({
      changedFiles: ['api/src/domain/summary.ts'],
      workflowChecks: ['gate:contracts'],
      overrideId: 'ovr-expired',
      nowIso,
      policy,
      overrides: [
        {
          id: 'ovr-expired',
          reason: 'Need a temporary bypass.',
          requestedBy: 'release-manager',
          createdAt: '2026-05-01T00:00:00.000Z',
          expiresAt: '2026-05-10T00:00:00.000Z',
          followUpIssue: 'none'
        }
      ]
    });
    expect(result.pass).toBe(false);
    expect(result.failures.join(' ')).toContain('expired');
    expect(result.failures.join(' ')).toContain('followUpIssue');
  });
});
