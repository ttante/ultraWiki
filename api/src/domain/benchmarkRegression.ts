import type { BenchmarkHarnessResult } from './benchmarkHarness.js';

export type BenchmarkBaseline = {
  version: number;
  runtimeProfile: string;
  maxStageLatencyRatio: number;
  minThroughputRatio: number;
  maxFailureRate: number;
  minMemoryHeadroomMb: number;
  metrics: {
    throughputPacksPerSec: number;
    stageLatencyMs: {
      summarizationAvgMs: number;
      activeRecallAvgMs: number;
      knowledgeStructureAvgMs: number;
    };
  };
};

export type BenchmarkWaiver = {
  id: string;
  reason: string;
  approvedBy: string;
  createdAt: string;
  expiresAt: string;
  followUpIssue: string;
};

export type BenchmarkRegressionResult = {
  pass: boolean;
  waived: boolean;
  failures: string[];
};

const hasValidDate = (value: string): boolean => Number.isFinite(Date.parse(value));

const isExpired = (expiresAt: string, nowIso: string): boolean => Date.parse(expiresAt) <= Date.parse(nowIso);

const isFollowUpTicket = (value: string): boolean => /^#\d+$/.test(value) || /^T\d+\.\d+$/.test(value);

export const validateBenchmarkWaiver = (waiver: BenchmarkWaiver, nowIso: string): string[] => {
  const failures: string[] = [];
  if (!hasValidDate(waiver.createdAt)) failures.push(`waiver=${waiver.id} invalid createdAt`);
  if (!hasValidDate(waiver.expiresAt)) failures.push(`waiver=${waiver.id} invalid expiresAt`);
  if (waiver.reason.trim().length < 10) failures.push(`waiver=${waiver.id} reason too short`);
  if (!isFollowUpTicket(waiver.followUpIssue)) failures.push(`waiver=${waiver.id} followUpIssue invalid`);
  if (failures.length === 0 && isExpired(waiver.expiresAt, nowIso)) {
    failures.push(`waiver=${waiver.id} expired at ${waiver.expiresAt}`);
  }
  return failures;
};

export const evaluateBenchmarkRegression = (
  current: BenchmarkHarnessResult,
  baseline: BenchmarkBaseline,
  nowIso: string,
  waiver?: BenchmarkWaiver
): BenchmarkRegressionResult => {
  const failures: string[] = [];

  if (current.throughputPacksPerSec < baseline.metrics.throughputPacksPerSec * baseline.minThroughputRatio) {
    failures.push(
      `throughput regression current=${current.throughputPacksPerSec.toFixed(4)} baseline=${baseline.metrics.throughputPacksPerSec.toFixed(4)}`
    );
  }

  const stagePairs: Array<[string, number, number]> = [
    ['summarization', current.stageLatencyMs.summarizationAvgMs, baseline.metrics.stageLatencyMs.summarizationAvgMs],
    ['active_recall', current.stageLatencyMs.activeRecallAvgMs, baseline.metrics.stageLatencyMs.activeRecallAvgMs],
    [
      'knowledge_structure',
      current.stageLatencyMs.knowledgeStructureAvgMs,
      baseline.metrics.stageLatencyMs.knowledgeStructureAvgMs
    ]
  ];
  for (const [stage, currentMs, baselineMs] of stagePairs) {
    if (currentMs > baselineMs * baseline.maxStageLatencyRatio) {
      failures.push(`latency regression stage=${stage} current=${currentMs.toFixed(4)}ms baseline=${baselineMs.toFixed(4)}ms`);
    }
  }

  if (current.failureRate > baseline.maxFailureRate) {
    failures.push(`failure rate regression current=${current.failureRate.toFixed(4)} max=${baseline.maxFailureRate.toFixed(4)}`);
  }

  if (current.memoryHeadroomMb < baseline.minMemoryHeadroomMb) {
    failures.push(`memory headroom below minimum current=${current.memoryHeadroomMb.toFixed(2)}mb min=${baseline.minMemoryHeadroomMb}`);
  }

  if (failures.length === 0) {
    return { pass: true, waived: false, failures: [] };
  }

  if (!waiver) {
    return { pass: false, waived: false, failures };
  }

  const waiverFailures = validateBenchmarkWaiver(waiver, nowIso);
  if (waiverFailures.length > 0) {
    return { pass: false, waived: false, failures: [...failures, ...waiverFailures] };
  }

  return { pass: true, waived: true, failures };
};
