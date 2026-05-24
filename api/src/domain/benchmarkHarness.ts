import type { SourceSection } from './ingestion.js';
import { generateGroundedSummaries } from './summary.js';
import { generateActiveRecallArtifacts } from './activeRecall.js';
import { generateKnowledgeStructureArtifacts } from './knowledgeStructure.js';

export type BenchmarkPromptVersions = {
  summarization: string;
  activeRecall: string;
  knowledgeStructure: string;
};

export type BenchmarkStage = 'summarization' | 'active_recall' | 'knowledge_structure';

export type BenchmarkPromptMetadata = {
  stage: BenchmarkStage;
  promptVersion: string;
  model: string;
};

export type BenchmarkHarnessInput = {
  runtimeProfile: string;
  promptVersions: BenchmarkPromptVersions;
  sections: SourceSection[];
  iterations: number;
  memoryLimitMb: number;
  model: string;
};

export type StageLatencyMetrics = {
  summarizationAvgMs: number;
  summarizationP95Ms: number;
  activeRecallAvgMs: number;
  activeRecallP95Ms: number;
  knowledgeStructureAvgMs: number;
  knowledgeStructureP95Ms: number;
};

export type BenchmarkHarnessResult = {
  schemaVersion: 1;
  generatedAt: string;
  runtimeProfile: string;
  promptVersions: BenchmarkPromptVersions;
  promptMetadata: BenchmarkPromptMetadata[];
  model: string;
  iterations: number;
  successfulIterations: number;
  failedIterations: number;
  totalDurationMs: number;
  throughputPacksPerSec: number;
  failureRate: number;
  peakHeapMb: number;
  memoryHeadroomMb: number;
  stageLatencyMs: StageLatencyMetrics;
};

const nowMs = (): number => Number(process.hrtime.bigint()) / 1_000_000;

const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
};

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
};

const heapUsedMb = (): number => process.memoryUsage().heapUsed / (1024 * 1024);

const validateInput = (input: BenchmarkHarnessInput): void => {
  if (!input.runtimeProfile.trim()) {
    throw new Error('Benchmark runtimeProfile is required');
  }
  if (!input.model.trim()) {
    throw new Error('Benchmark model is required');
  }
  if (!Number.isInteger(input.iterations) || input.iterations <= 0) {
    throw new Error('Benchmark iterations must be a positive integer');
  }
  if (!Number.isFinite(input.memoryLimitMb) || input.memoryLimitMb <= 0) {
    throw new Error('Benchmark memoryLimitMb must be positive');
  }
  if (!Array.isArray(input.sections) || input.sections.length === 0) {
    throw new Error('Benchmark requires at least one source section');
  }
};

export const runBenchmarkHarness = (input: BenchmarkHarnessInput): BenchmarkHarnessResult => {
  validateInput(input);

  const summarizationMs: number[] = [];
  const activeRecallMs: number[] = [];
  const knowledgeStructureMs: number[] = [];
  let failures = 0;
  let peakHeapMb = heapUsedMb();

  const start = nowMs();
  for (let i = 0; i < input.iterations; i += 1) {
    try {
      const s0 = nowMs();
      generateGroundedSummaries(input.sections, input.promptVersions.summarization, input.model);
      summarizationMs.push(nowMs() - s0);

      const s1 = nowMs();
      generateActiveRecallArtifacts(input.sections, input.promptVersions.activeRecall, input.model);
      activeRecallMs.push(nowMs() - s1);

      const s2 = nowMs();
      generateKnowledgeStructureArtifacts(input.sections);
      knowledgeStructureMs.push(nowMs() - s2);
    } catch {
      failures += 1;
    } finally {
      peakHeapMb = Math.max(peakHeapMb, heapUsedMb());
    }
  }
  const totalMs = Math.max(1, nowMs() - start);
  const successfulIterations = input.iterations - failures;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runtimeProfile: input.runtimeProfile,
    promptVersions: input.promptVersions,
    promptMetadata: [
      { stage: 'summarization', promptVersion: input.promptVersions.summarization, model: input.model },
      { stage: 'active_recall', promptVersion: input.promptVersions.activeRecall, model: input.model },
      { stage: 'knowledge_structure', promptVersion: input.promptVersions.knowledgeStructure, model: input.model }
    ],
    model: input.model,
    iterations: input.iterations,
    successfulIterations,
    failedIterations: failures,
    totalDurationMs: totalMs,
    throughputPacksPerSec: successfulIterations / (totalMs / 1000),
    failureRate: input.iterations > 0 ? failures / input.iterations : 0,
    peakHeapMb,
    memoryHeadroomMb: input.memoryLimitMb - peakHeapMb,
    stageLatencyMs: {
      summarizationAvgMs: average(summarizationMs),
      summarizationP95Ms: percentile(summarizationMs, 95),
      activeRecallAvgMs: average(activeRecallMs),
      activeRecallP95Ms: percentile(activeRecallMs, 95),
      knowledgeStructureAvgMs: average(knowledgeStructureMs),
      knowledgeStructureP95Ms: percentile(knowledgeStructureMs, 95)
    }
  };
};
