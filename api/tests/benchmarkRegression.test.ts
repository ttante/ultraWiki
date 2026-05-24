import { describe, expect, it } from 'vitest';
import {
  evaluateBenchmarkRegression,
  validateBenchmarkWaiver,
  validateBenchmarkWaiverFile
} from '../src/domain/benchmarkRegression.js';
import type { BenchmarkHarnessResult } from '../src/domain/benchmarkHarness.js';

const baseline = {
  version: 2,
  runtimeProfile: 'rtx4080_qwen14b_safe',
  maxStageLatencyRatio: 3,
  minThroughputRatio: 0.5,
  maxFailureRate: 0.01,
  minMemoryHeadroomMb: 256,
  metrics: {
    throughputPacksPerSec: 100,
    stageLatencyMs: {
      summarizationAvgMs: 1,
      activeRecallAvgMs: 1,
      knowledgeStructureAvgMs: 1
    }
  }
} as const;

const currentPassing: BenchmarkHarnessResult = {
  schemaVersion: 1,
  generatedAt: '2026-05-20T00:00:00.000Z',
  runtimeProfile: 'rtx4080_qwen14b_safe',
  promptVersions: {
    summarization: 'summary-by-level@1.0.0',
    activeRecall: 'active-recall@1.0.0',
    knowledgeStructure: 'knowledge-structure-rules@1.0.0'
  },
  promptMetadata: [
    { stage: 'summarization', promptVersion: 'summary-by-level@1.0.0', model: 'local-rule-based' },
    { stage: 'active_recall', promptVersion: 'active-recall@1.0.0', model: 'local-rule-based' },
    { stage: 'knowledge_structure', promptVersion: 'knowledge-structure-rules@1.0.0', model: 'local-rule-based' }
  ],
  model: 'local-rule-based',
  iterations: 10,
  successfulIterations: 10,
  failedIterations: 0,
  totalDurationMs: 125,
  throughputPacksPerSec: 80,
  failureRate: 0,
  peakHeapMb: 100,
  memoryHeadroomMb: 2048,
  stageLatencyMs: {
    summarizationAvgMs: 1.5,
    summarizationP95Ms: 2,
    activeRecallAvgMs: 1.8,
    activeRecallP95Ms: 2.3,
    knowledgeStructureAvgMs: 1.6,
    knowledgeStructureP95Ms: 2.1
  }
};

describe('benchmark regression gate', () => {
  it('fails synthetic regressions without waiver', () => {
    const result = evaluateBenchmarkRegression(
      {
        ...currentPassing,
        throughputPacksPerSec: 20,
        stageLatencyMs: {
          ...currentPassing.stageLatencyMs,
          summarizationAvgMs: 4.2
        }
      },
      baseline,
      '2026-05-20T00:00:00.000Z'
    );
    expect(result.pass).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it('allows temporary bypass with a valid non-expired waiver', () => {
    const result = evaluateBenchmarkRegression(
      {
        ...currentPassing,
        throughputPacksPerSec: 20
      },
      baseline,
      '2026-05-20T00:00:00.000Z',
      {
        id: 'waiver-1',
        reason: 'Temporary CI host contention impacting benchmark throughput.',
        approvedBy: 'perf-owner',
        createdAt: '2026-05-20T00:00:00.000Z',
        expiresAt: '2026-05-22T00:00:00.000Z',
        followUpIssue: '#555'
      }
    );
    expect(result.pass).toBe(true);
    expect(result.waived).toBe(true);
  });

  it('rejects expired, overlong, or incomplete benchmark waivers', () => {
    expect(
      validateBenchmarkWaiver(
        {
          id: 'waiver-bad',
          reason: 'Too short.',
          approvedBy: '',
          createdAt: '2026-05-01T00:00:00.000Z',
          expiresAt: '2026-05-20T00:00:00.000Z',
          followUpIssue: 'none'
        },
        '2026-05-10T00:00:00.000Z',
        7
      )
    ).toEqual([
      'waiver=waiver-bad approvedBy required',
      'waiver=waiver-bad followUpIssue invalid'
    ]);

    expect(
      validateBenchmarkWaiver(
        {
          id: 'waiver-long',
          reason: 'Temporary external benchmark host contention.',
          approvedBy: 'perf-owner',
          createdAt: '2026-05-01T00:00:00.000Z',
          expiresAt: '2026-05-20T00:00:00.000Z',
          followUpIssue: '#555'
        },
        '2026-05-10T00:00:00.000Z',
        7
      )
    ).toContain('waiver=waiver-long ttl_days=19.00 exceeds max=7');

    expect(
      validateBenchmarkWaiver(
        {
          id: 'waiver-expired',
          reason: 'Temporary external benchmark host contention.',
          approvedBy: 'perf-owner',
          createdAt: '2026-05-01T00:00:00.000Z',
          expiresAt: '2026-05-02T00:00:00.000Z',
          followUpIssue: '#555'
        },
        '2026-05-10T00:00:00.000Z',
        7
      )
    ).toContain('waiver=waiver-expired expired at 2026-05-02T00:00:00.000Z');
  });

  it('fails waiver files with duplicate ids or stale waivers', () => {
    const failures = validateBenchmarkWaiverFile(
      {
        version: '1.0.0',
        maxWaiverTtlDays: 7,
        waivers: [
          {
            id: 'dup',
            reason: 'Temporary external benchmark host contention.',
            approvedBy: 'perf-owner',
            createdAt: '2026-05-01T00:00:00.000Z',
            expiresAt: '2026-05-02T00:00:00.000Z',
            followUpIssue: '#555'
          },
          {
            id: 'dup',
            reason: 'Temporary external benchmark host contention.',
            approvedBy: 'perf-owner',
            createdAt: '2026-05-03T00:00:00.000Z',
            expiresAt: '2026-05-04T00:00:00.000Z',
            followUpIssue: '#556'
          }
        ]
      },
      '2026-05-10T00:00:00.000Z'
    );

    expect(failures).toContain('duplicate waiver id: dup');
    expect(failures).toContain('waiver=dup expired at 2026-05-02T00:00:00.000Z');
    expect(failures).toContain('waiver=dup expired at 2026-05-04T00:00:00.000Z');
  });
});
