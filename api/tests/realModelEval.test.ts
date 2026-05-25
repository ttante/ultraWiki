import { describe, expect, it } from 'vitest';
import type { BenchmarkHarnessResult } from '../src/domain/benchmarkHarness.js';
import {
  evaluateRealModelEval,
  validateRealModelEvalThresholds,
  type RealModelEvalThresholds
} from '../src/domain/realModelEval.js';

const thresholds: RealModelEvalThresholds = {
  version: '1.0.0',
  runtime_profile: 'rtx4080_qwen14b_safe',
  model: 'qwen2.5-14b-instruct-q4_k_m',
  max_total_duration_ms: 180_000,
  max_failure_rate: 0,
  min_memory_headroom_mb: 256,
  min_citation_rate: 0.5,
  min_summaries: 3,
  min_flashcards: 10,
  min_quiz_questions: 5,
  min_graph_nodes: 1,
  min_graph_edges: 0,
  min_timeline_events: 1,
  max_stage_p95_ms: {
    summarization: 60_000,
    active_recall: 90_000,
    knowledge_structure: 60_000
  }
};

const benchmark: BenchmarkHarnessResult = {
  schemaVersion: 1,
  generatedAt: '2026-05-24T00:00:00.000Z',
  runtimeProfile: 'rtx4080_qwen14b_safe',
  promptVersions: {
    summarization: 'summary-by-level@1.0.0',
    activeRecall: 'active-recall@1.0.0',
    knowledgeStructure: 'knowledge-structure-rules@1.0.0'
  },
  promptMetadata: [],
  model: 'qwen2.5-14b-instruct-q4_k_m',
  iterations: 1,
  successfulIterations: 1,
  failedIterations: 0,
  totalDurationMs: 75_000,
  throughputPacksPerSec: 0.013,
  failureRate: 0,
  peakHeapMb: 128,
  memoryHeadroomMb: 12_000,
  stageLatencyMs: {
    summarizationAvgMs: 20_000,
    summarizationP95Ms: 20_000,
    activeRecallAvgMs: 35_000,
    activeRecallP95Ms: 35_000,
    knowledgeStructureAvgMs: 20_000,
    knowledgeStructureP95Ms: 20_000
  }
};

describe('real model evaluation', () => {
  it('accepts Qwen eval outputs that meet quality and performance thresholds', () => {
    const result = evaluateRealModelEval({
      expectedModel: 'qwen2.5-14b-instruct-q4_k_m',
      benchmark,
      fallbackEvents: [],
      summaries: [
        { level: 'beginner', text: 'a', citations: ['source'], promptVersion: 'p', model: benchmark.model },
        { level: 'intermediate', text: 'b', citations: ['source'], promptVersion: 'p', model: benchmark.model },
        { level: 'advanced', text: 'c', citations: ['source'], promptVersion: 'p', model: benchmark.model }
      ],
      flashcards: Array.from({ length: 10 }, (_, i) => ({
        question: `q${i}`,
        answer: `a${i}`,
        citation: 'source',
        promptVersion: 'p',
        model: benchmark.model
      })),
      quizQuestions: Array.from({ length: 5 }, (_, i) => ({
        question: `q${i}`,
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 0,
        misconceptions: ['a is cited', 'b is wrong', 'c is wrong', 'd is wrong'],
        explanation: 'because',
        citation: 'source',
        promptVersion: 'p',
        model: benchmark.model
      })),
      graphNodes: [{ id: 'alan', label: 'Alan Turing', type: 'person', citation: 'source' }],
      graphEdges: [],
      timelineEvents: [{ year: 1950, dateLabel: '1950', description: 'event', citation: 'source' }],
      citationRate: 1,
      thresholds
    });

    expect(result.pass).toBe(true);
    expect(result.metrics.fallbackEvents).toBe(0);
  });

  it('rejects fallback use and threshold regressions', () => {
    const result = evaluateRealModelEval({
      expectedModel: 'qwen2.5-14b-instruct-q4_k_m',
      benchmark: {
        ...benchmark,
        totalDurationMs: 250_000,
        failureRate: 0.5,
        memoryHeadroomMb: 12,
        stageLatencyMs: { ...benchmark.stageLatencyMs, activeRecallP95Ms: 100_000 }
      },
      fallbackEvents: [{ schemaName: 'summaries', reason: 'invalid_response' }],
      summaries: [],
      flashcards: [],
      quizQuestions: [],
      graphNodes: [],
      graphEdges: [],
      timelineEvents: [],
      citationRate: 0,
      thresholds
    });

    expect(result.pass).toBe(false);
    expect(result.failures.join(' ')).toContain('real model fallback used');
    expect(result.failures.join(' ')).toContain('total_duration_ms');
    expect(result.failures.join(' ')).toContain('active_recall_p95_ms');
    expect(result.failures.join(' ')).toContain('summaries current=0');
  });

  it('validates threshold files before runtime use', () => {
    const errors = validateRealModelEvalThresholds({
      ...thresholds,
      model: '',
      max_total_duration_ms: 0,
      min_citation_rate: 2,
      max_stage_p95_ms: { ...thresholds.max_stage_p95_ms, summarization: 0 }
    });
    expect(errors.join(' ')).toContain('model is required');
    expect(errors.join(' ')).toContain('max_total_duration_ms must be positive');
    expect(errors.join(' ')).toContain('min_citation_rate must be between 0 and 1');
    expect(errors.join(' ')).toContain('max_stage_p95_ms.summarization must be positive');
  });
});
