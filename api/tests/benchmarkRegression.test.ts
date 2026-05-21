import { describe, expect, it } from 'vitest';
import { evaluateBenchmarkRegression } from '../src/domain/benchmarkRegression.js';
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
  runtimeProfile: 'rtx4080_qwen14b_safe',
  promptVersions: {
    summarization: 'summary-by-level@1.0.0',
    activeRecall: 'active-recall@1.0.0',
    knowledgeStructure: 'knowledge-structure-rules@1.0.0'
  },
  iterations: 10,
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
});
