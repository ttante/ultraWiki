import type { LlmFallbackReason, LlmGenerationEvent } from '../domain/llmProvider.js';

export type LlmMetricStage = 'summaries' | 'active_recall' | 'knowledge_structure' | string;

export type LlmTelemetryRecord = LlmGenerationEvent & {
  provider: 'rule_based' | 'openai_compatible';
  model: string;
  stage: LlmMetricStage;
};

export type LlmMetricsSnapshot = {
  calls: {
    attempted: number;
    succeeded: number;
    fallback: number;
    invalidResponses: number;
    timeouts: number;
    timeoutRate: number;
  };
  byStageModel: Array<{
    provider: string;
    model: string;
    stage: string;
    attempted: number;
    succeeded: number;
    fallback: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  }>;
  fallbacksByReason: Array<{
    provider: string;
    model: string;
    stage: string;
    reason: LlmFallbackReason;
    events: number;
  }>;
  errorsByType: Array<{
    provider: string;
    model: string;
    stage: string;
    errorType: string;
    events: number;
  }>;
};

type Aggregate = {
  provider: string;
  model: string;
  stage: string;
  attempted: number;
  succeeded: number;
  fallback: number;
  latencies: number[];
};

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

const classifyError = (event: LlmTelemetryRecord): string => {
  if (event.fallbackReason === 'invalid_response') return 'invalid_response';
  if (event.errorName === 'AbortError' || event.error?.toLowerCase().includes('abort')) return 'timeout';
  if (event.error?.startsWith('llm_http_')) return event.error;
  return event.error ? 'client_error' : event.fallbackReason ?? 'none';
};

export class LlmTelemetry {
  private records: LlmTelemetryRecord[] = [];

  reset(): void {
    this.records = [];
  }

  record(event: LlmTelemetryRecord): void {
    this.records.push({ ...event });
  }

  getSnapshot(): LlmMetricsSnapshot {
    const attempted = this.records.filter((event) => event.attemptedModelCall).length;
    const succeeded = this.records.filter((event) => event.status === 'success').length;
    const fallback = this.records.filter((event) => event.status === 'fallback').length;
    const invalidResponses = this.records.filter((event) => event.fallbackReason === 'invalid_response').length;
    const timeouts = this.records.filter((event) => classifyError(event) === 'timeout').length;

    const byStage = Array.from(
      this.records.reduce((acc, event) => {
        const key = `${event.provider}\u0000${event.model}\u0000${event.stage}`;
        const current = acc.get(key) ?? {
          provider: event.provider,
          model: event.model,
          stage: event.stage,
          attempted: 0,
          succeeded: 0,
          fallback: 0,
          latencies: [] as number[]
        };
        if (event.attemptedModelCall) {
          current.attempted += 1;
          current.latencies.push(event.latencyMs);
        }
        if (event.status === 'success') current.succeeded += 1;
        if (event.status === 'fallback') current.fallback += 1;
        acc.set(key, current);
        return acc;
      }, new Map<string, Aggregate>())
    ).map(([, entry]) => ({
      provider: entry.provider,
      model: entry.model,
      stage: entry.stage,
      attempted: entry.attempted,
      succeeded: entry.succeeded,
      fallback: entry.fallback,
      avgLatencyMs: average(entry.latencies),
      p95LatencyMs: percentile(entry.latencies, 95)
    }));

    const fallbacksByReason = Array.from(
      this.records
        .filter((event) => event.status === 'fallback' && event.fallbackReason)
        .reduce((acc, event) => {
          const reason = event.fallbackReason as LlmFallbackReason;
          const key = `${event.provider}\u0000${event.model}\u0000${event.stage}\u0000${reason}`;
          const current = acc.get(key) ?? {
            provider: event.provider,
            model: event.model,
            stage: event.stage,
            reason,
            events: 0
          };
          current.events += 1;
          acc.set(key, current);
          return acc;
        }, new Map<string, { provider: string; model: string; stage: string; reason: LlmFallbackReason; events: number }>())
    ).map(([, entry]) => entry);

    const errorsByType = Array.from(
      this.records
        .filter((event) => event.status === 'fallback' && event.fallbackReason !== 'missing_client')
        .reduce((acc, event) => {
          const errorType = classifyError(event);
          const key = `${event.provider}\u0000${event.model}\u0000${event.stage}\u0000${errorType}`;
          const current = acc.get(key) ?? {
            provider: event.provider,
            model: event.model,
            stage: event.stage,
            errorType,
            events: 0
          };
          current.events += 1;
          acc.set(key, current);
          return acc;
        }, new Map<string, { provider: string; model: string; stage: string; errorType: string; events: number }>())
    ).map(([, entry]) => entry);

    return {
      calls: {
        attempted,
        succeeded,
        fallback,
        invalidResponses,
        timeouts,
        timeoutRate: attempted === 0 ? 0 : timeouts / attempted
      },
      byStageModel: byStage,
      fallbacksByReason,
      errorsByType
    };
  }
}

export const llmTelemetry = new LlmTelemetry();
