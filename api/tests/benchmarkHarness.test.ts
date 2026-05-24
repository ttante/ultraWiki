import { describe, expect, it } from 'vitest';
import { runBenchmarkHarness } from '../src/domain/benchmarkHarness.js';

const sections = [
  {
    heading: 'Sample',
    content:
      'In 1950 Alan Turing influenced John McCarthy. In 1956 John McCarthy founded AI Laboratory. The Dartmouth Conference occurred in 1956. In 1969 ARPANET preceded modern Internet systems.'
  }
];

describe('benchmark harness', () => {
  it('captures throughput, stage latency, failure rate, memory headroom, and prompt metadata', () => {
    const result = runBenchmarkHarness({
      runtimeProfile: 'rtx4080_qwen14b_safe',
      promptVersions: {
        summarization: 'summary-by-level@1.0.0',
        activeRecall: 'active-recall@1.0.0',
        knowledgeStructure: 'knowledge-structure-rules@1.0.0'
      },
      sections,
      iterations: 8,
      memoryLimitMb: 12 * 1024,
      model: 'local-rule-based'
    });

    expect(result.promptVersions.summarization).toBe('summary-by-level@1.0.0');
    expect(result).toMatchObject({
      schemaVersion: 1,
      runtimeProfile: 'rtx4080_qwen14b_safe',
      model: 'local-rule-based',
      iterations: 8,
      successfulIterations: 8,
      failedIterations: 0
    });
    expect(Date.parse(result.generatedAt)).not.toBeNaN();
    expect(result.totalDurationMs).toBeGreaterThan(0);
    expect(result.promptMetadata).toEqual([
      { stage: 'summarization', promptVersion: 'summary-by-level@1.0.0', model: 'local-rule-based' },
      { stage: 'active_recall', promptVersion: 'active-recall@1.0.0', model: 'local-rule-based' },
      { stage: 'knowledge_structure', promptVersion: 'knowledge-structure-rules@1.0.0', model: 'local-rule-based' }
    ]);
    expect(result.throughputPacksPerSec).toBeGreaterThan(0);
    expect(result.failureRate).toBe(0);
    expect(result.memoryHeadroomMb).toBeGreaterThan(0);
    expect(result.stageLatencyMs.summarizationAvgMs).toBeGreaterThanOrEqual(0);
    expect(result.stageLatencyMs.activeRecallP95Ms).toBeGreaterThanOrEqual(0);
    expect(result.stageLatencyMs.knowledgeStructureP95Ms).toBeGreaterThanOrEqual(0);
  });

  it('is reasonably stable on repeated short runs', () => {
    const runA = runBenchmarkHarness({
      runtimeProfile: 'rtx4080_qwen14b_safe',
      promptVersions: {
        summarization: 'summary-by-level@1.0.0',
        activeRecall: 'active-recall@1.0.0',
        knowledgeStructure: 'knowledge-structure-rules@1.0.0'
      },
      sections,
      iterations: 6,
      memoryLimitMb: 12 * 1024,
      model: 'local-rule-based'
    });
    const runB = runBenchmarkHarness({
      runtimeProfile: 'rtx4080_qwen14b_safe',
      promptVersions: {
        summarization: 'summary-by-level@1.0.0',
        activeRecall: 'active-recall@1.0.0',
        knowledgeStructure: 'knowledge-structure-rules@1.0.0'
      },
      sections,
      iterations: 6,
      memoryLimitMb: 12 * 1024,
      model: 'local-rule-based'
    });

    const min = Math.min(runA.throughputPacksPerSec, runB.throughputPacksPerSec);
    const max = Math.max(runA.throughputPacksPerSec, runB.throughputPacksPerSec);
    expect(max / Math.max(0.0001, min)).toBeLessThan(20);
  });

  it('rejects invalid benchmark configurations', () => {
    expect(() =>
      runBenchmarkHarness({
        runtimeProfile: 'rtx4080_qwen14b_safe',
        promptVersions: {
          summarization: 'summary-by-level@1.0.0',
          activeRecall: 'active-recall@1.0.0',
          knowledgeStructure: 'knowledge-structure-rules@1.0.0'
        },
        sections,
        iterations: 0,
        memoryLimitMb: 12 * 1024,
        model: 'local-rule-based'
      })
    ).toThrow('Benchmark iterations must be a positive integer');
  });
});
