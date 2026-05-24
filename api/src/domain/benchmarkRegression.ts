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

export type BenchmarkWaiverFile = {
  version: string;
  maxWaiverTtlDays: number;
  waivers: BenchmarkWaiver[];
};

export type BenchmarkRegressionResult = {
  pass: boolean;
  waived: boolean;
  failures: string[];
};

const hasValidDate = (value: string): boolean => Number.isFinite(Date.parse(value));

const isExpired = (expiresAt: string, nowIso: string): boolean => Date.parse(expiresAt) <= Date.parse(nowIso);

const isFollowUpTicket = (value: string): boolean => /^#\d+$/.test(value) || /^T\d+\.\d+$/.test(value);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const validateBenchmarkWaiver = (waiver: BenchmarkWaiver, nowIso: string, maxWaiverTtlDays = 7): string[] => {
  const failures: string[] = [];
  if (!hasValidDate(waiver.createdAt)) failures.push(`waiver=${waiver.id} invalid createdAt`);
  if (!hasValidDate(waiver.expiresAt)) failures.push(`waiver=${waiver.id} invalid expiresAt`);
  if (waiver.reason.trim().length < 10) failures.push(`waiver=${waiver.id} reason too short`);
  if (waiver.approvedBy.trim().length === 0) failures.push(`waiver=${waiver.id} approvedBy required`);
  if (!isFollowUpTicket(waiver.followUpIssue)) failures.push(`waiver=${waiver.id} followUpIssue invalid`);
  if (failures.length === 0) {
    const createdAtMs = Date.parse(waiver.createdAt);
    const expiresAtMs = Date.parse(waiver.expiresAt);
    const ttlDays = (expiresAtMs - createdAtMs) / MS_PER_DAY;
    if (ttlDays <= 0) {
      failures.push(`waiver=${waiver.id} expiresAt must be after createdAt`);
    } else if (ttlDays > maxWaiverTtlDays) {
      failures.push(`waiver=${waiver.id} ttl_days=${ttlDays.toFixed(2)} exceeds max=${maxWaiverTtlDays}`);
    }
    if (isExpired(waiver.expiresAt, nowIso)) {
      failures.push(`waiver=${waiver.id} expired at ${waiver.expiresAt}`);
    }
  }
  return failures;
};

export const validateBenchmarkWaiverFile = (file: BenchmarkWaiverFile, nowIso: string): string[] => {
  const failures: string[] = [];
  const seenIds = new Set<string>();

  if (!Number.isFinite(file.maxWaiverTtlDays) || file.maxWaiverTtlDays <= 0 || file.maxWaiverTtlDays > 14) {
    failures.push('maxWaiverTtlDays must be between 1 and 14');
  }

  for (const waiver of file.waivers) {
    if (seenIds.has(waiver.id)) {
      failures.push(`duplicate waiver id: ${waiver.id}`);
    }
    seenIds.add(waiver.id);
    failures.push(...validateBenchmarkWaiver(waiver, nowIso, file.maxWaiverTtlDays));
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
