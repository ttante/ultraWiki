export type LlmChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LlmJsonRequest = {
  messages: LlmChatMessage[];
  schemaName: string;
};

export type LlmJsonClient = {
  generateJson(request: LlmJsonRequest): Promise<unknown>;
};

export type LlmFallbackReason = 'missing_client' | 'invalid_response' | 'client_error';

export type LlmFallbackEvent = {
  schemaName: string;
  reason: LlmFallbackReason;
  error?: string;
};

export type LlmGenerationEvent = {
  schemaName: string;
  status: 'success' | 'fallback';
  attemptedModelCall: boolean;
  latencyMs: number;
  fallbackReason?: LlmFallbackReason;
  error?: string;
  errorName?: string;
};

export type OpenAiCompatibleLlmConfig = {
  baseUrl: string;
  model: string;
  timeoutMs: number;
};

export const extractJsonPayload = (content: string): unknown => {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenced?.[1] ?? trimmed;
  return JSON.parse(jsonText) as unknown;
};

export class OpenAiCompatibleLlmClient implements LlmJsonClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: OpenAiCompatibleLlmConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.model = config.model;
    this.timeoutMs = config.timeoutMs;
  }

  async generateJson(request: LlmJsonRequest): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `Return only valid JSON for schema ${request.schemaName}. Do not include markdown prose.`
            },
            ...request.messages
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`llm_http_${response.status}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('llm_empty_response');
      }
      return extractJsonPayload(content);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const generateJsonWithFallback = async <T>({
  client,
  request,
  validate,
  fallback,
  onFallback,
  onEvent
}: {
  client: LlmJsonClient | undefined;
  request: LlmJsonRequest;
  validate: (value: unknown) => T | null;
  fallback: () => T;
  onFallback?: (event: LlmFallbackEvent) => void;
  onEvent?: (event: LlmGenerationEvent) => void;
}): Promise<T> => {
  if (!client) {
    onFallback?.({ schemaName: request.schemaName, reason: 'missing_client' });
    onEvent?.({
      schemaName: request.schemaName,
      status: 'fallback',
      attemptedModelCall: false,
      latencyMs: 0,
      fallbackReason: 'missing_client'
    });
    return fallback();
  }

  const startedAt = Date.now();
  try {
    const value = await client.generateJson(request);
    const latencyMs = Date.now() - startedAt;
    const validated = validate(value);
    if (validated) {
      onEvent?.({
        schemaName: request.schemaName,
        status: 'success',
        attemptedModelCall: true,
        latencyMs
      });
      return validated;
    }
    onFallback?.({ schemaName: request.schemaName, reason: 'invalid_response' });
    onEvent?.({
      schemaName: request.schemaName,
      status: 'fallback',
      attemptedModelCall: true,
      latencyMs,
      fallbackReason: 'invalid_response'
    });
    return fallback();
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    onFallback?.({
      schemaName: request.schemaName,
      reason: 'client_error',
      error: error instanceof Error ? error.message : String(error)
    });
    onEvent?.({
      schemaName: request.schemaName,
      status: 'fallback',
      attemptedModelCall: true,
      latencyMs,
      fallbackReason: 'client_error',
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : undefined
    });
    return fallback();
  }
};
