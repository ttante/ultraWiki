import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractJsonPayload,
  generateJsonWithFallback,
  OpenAiCompatibleLlmClient,
  type LlmGenerationEvent,
  type LlmJsonClient
} from '../src/domain/llmProvider.js';

describe('llm provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts plain or fenced JSON payloads', () => {
    expect(extractJsonPayload('{"ok":true}')).toEqual({ ok: true });
    expect(extractJsonPayload('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it('calls OpenAI-compatible chat completions and parses JSON content', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"answer":"ok"}' } }] })
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new OpenAiCompatibleLlmClient({
      baseUrl: 'http://localhost:8080/v1/',
      model: 'qwen2.5-14b-instruct-q4_k_m',
      timeoutMs: 1000
    });

    await expect(
      client.generateJson({ schemaName: 'test', messages: [{ role: 'user', content: 'Return JSON.' }] })
    ).resolves.toEqual({ answer: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('falls back when the client fails or returns invalid JSON', async () => {
    const events: string[] = [];
    const generationEvents: LlmGenerationEvent[] = [];
    const failingClient: LlmJsonClient = {
      generateJson: async () => {
        throw new Error('offline');
      }
    };
    const invalidClient: LlmJsonClient = {
      generateJson: async () => ({ bad: true })
    };
    const validate = (value: unknown): string | null =>
      value && typeof value === 'object' && 'ok' in value ? 'llm' : null;

    await expect(
      generateJsonWithFallback({
        client: failingClient,
        request: { schemaName: 'test', messages: [] },
        validate,
        fallback: () => 'fallback',
        onFallback: (event) => events.push(`${event.schemaName}:${event.reason}:${event.error ?? ''}`),
        onEvent: (event) => generationEvents.push(event)
      })
    ).resolves.toBe('fallback');
    await expect(
      generateJsonWithFallback({
        client: invalidClient,
        request: { schemaName: 'test', messages: [] },
        validate,
        fallback: () => 'fallback',
        onFallback: (event) => events.push(`${event.schemaName}:${event.reason}:${event.error ?? ''}`),
        onEvent: (event) => generationEvents.push(event)
      })
    ).resolves.toBe('fallback');
    expect(events).toEqual(['test:client_error:offline', 'test:invalid_response:']);
    expect(generationEvents).toEqual([
      expect.objectContaining({
        schemaName: 'test',
        status: 'fallback',
        attemptedModelCall: true,
        fallbackReason: 'client_error',
        error: 'offline',
        errorName: 'Error'
      }),
      expect.objectContaining({
        schemaName: 'test',
        status: 'fallback',
        attemptedModelCall: true,
        fallbackReason: 'invalid_response'
      })
    ]);
    expect(generationEvents.every((event) => event.latencyMs >= 0)).toBe(true);
  });

  it('records missing-client fallback events', async () => {
    const events: string[] = [];
    const generationEvents: LlmGenerationEvent[] = [];
    await expect(
      generateJsonWithFallback({
        client: undefined,
        request: { schemaName: 'missing', messages: [] },
        validate: () => null,
        fallback: () => 'fallback',
        onFallback: (event) => events.push(event.reason),
        onEvent: (event) => generationEvents.push(event)
      })
    ).resolves.toBe('fallback');
    expect(events).toEqual(['missing_client']);
    expect(generationEvents).toEqual([
      {
        schemaName: 'missing',
        status: 'fallback',
        attemptedModelCall: false,
        latencyMs: 0,
        fallbackReason: 'missing_client'
      }
    ]);
  });

  it('records successful model generation events', async () => {
    const generationEvents: LlmGenerationEvent[] = [];
    const client: LlmJsonClient = {
      generateJson: async () => ({ ok: true })
    };

    await expect(
      generateJsonWithFallback({
        client,
        request: { schemaName: 'success', messages: [] },
        validate: (value) => (value && typeof value === 'object' && 'ok' in value ? 'llm' : null),
        fallback: () => 'fallback',
        onEvent: (event) => generationEvents.push(event)
      })
    ).resolves.toBe('llm');

    expect(generationEvents).toEqual([
      expect.objectContaining({
        schemaName: 'success',
        status: 'success',
        attemptedModelCall: true
      })
    ]);
    expect(generationEvents[0]?.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
