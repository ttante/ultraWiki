import { describe, expect, it } from 'vitest';
import { LlmTelemetry } from '../src/telemetry/llm.js';

describe('LlmTelemetry', () => {
  it('aggregates model calls, fallback reasons, error types, and latency percentiles', () => {
    const telemetry = new LlmTelemetry();

    telemetry.record({
      provider: 'openai_compatible',
      model: 'qwen2.5-14b-instruct-q4_k_m',
      stage: 'summaries',
      schemaName: 'summaries',
      status: 'success',
      attemptedModelCall: true,
      latencyMs: 100
    });
    telemetry.record({
      provider: 'openai_compatible',
      model: 'qwen2.5-14b-instruct-q4_k_m',
      stage: 'summaries',
      schemaName: 'summaries',
      status: 'fallback',
      attemptedModelCall: true,
      latencyMs: 300,
      fallbackReason: 'invalid_response'
    });
    telemetry.record({
      provider: 'openai_compatible',
      model: 'qwen2.5-14b-instruct-q4_k_m',
      stage: 'active_recall',
      schemaName: 'active_recall',
      status: 'fallback',
      attemptedModelCall: true,
      latencyMs: 5000,
      fallbackReason: 'client_error',
      error: 'This operation was aborted',
      errorName: 'AbortError'
    });
    telemetry.record({
      provider: 'rule_based',
      model: 'local-rule-based',
      stage: 'knowledge_structure',
      schemaName: 'knowledge_structure',
      status: 'fallback',
      attemptedModelCall: false,
      latencyMs: 0,
      fallbackReason: 'missing_client'
    });

    const snapshot = telemetry.getSnapshot();
    expect(snapshot.calls).toEqual({
      attempted: 3,
      succeeded: 1,
      fallback: 3,
      invalidResponses: 1,
      timeouts: 1,
      timeoutRate: 1 / 3
    });
    expect(snapshot.byStageModel).toEqual(
      expect.arrayContaining([
        {
          provider: 'openai_compatible',
          model: 'qwen2.5-14b-instruct-q4_k_m',
          stage: 'summaries',
          attempted: 2,
          succeeded: 1,
          fallback: 1,
          avgLatencyMs: 200,
          p95LatencyMs: 300
        },
        {
          provider: 'rule_based',
          model: 'local-rule-based',
          stage: 'knowledge_structure',
          attempted: 0,
          succeeded: 0,
          fallback: 1,
          avgLatencyMs: 0,
          p95LatencyMs: 0
        }
      ])
    );
    expect(snapshot.fallbacksByReason).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'summaries', reason: 'invalid_response', events: 1 }),
        expect.objectContaining({ stage: 'active_recall', reason: 'client_error', events: 1 }),
        expect.objectContaining({ stage: 'knowledge_structure', reason: 'missing_client', events: 1 })
      ])
    );
    expect(snapshot.errorsByType).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'summaries', errorType: 'invalid_response', events: 1 }),
        expect.objectContaining({ stage: 'active_recall', errorType: 'timeout', events: 1 })
      ])
    );
  });

  it('can reset accumulated events for isolated tests or process lifecycle hooks', () => {
    const telemetry = new LlmTelemetry();
    telemetry.record({
      provider: 'rule_based',
      model: 'local-rule-based',
      stage: 'summaries',
      schemaName: 'summaries',
      status: 'fallback',
      attemptedModelCall: false,
      latencyMs: 0,
      fallbackReason: 'missing_client'
    });

    telemetry.reset();

    expect(telemetry.getSnapshot().calls).toEqual({
      attempted: 0,
      succeeded: 0,
      fallback: 0,
      invalidResponses: 0,
      timeouts: 0,
      timeoutRate: 0
    });
  });
});
