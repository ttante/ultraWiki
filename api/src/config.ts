import { defaultRuntimePresetId, resolveRuntimePreset } from './domain/runtimePreset.js';

export type AppConfig = {
  apiPort: number;
  wikipediaLang: string;
  runMigrations: boolean;
  migrationsDir: string;
  llmProvider: 'rule_based' | 'openai_compatible';
  llmBaseUrl: string;
  llmModel: string;
  llmTimeoutMs: number;
  runtimePreset: string;
  llmQuantization: string;
  llmContextWindow: number;
  llmChunkSize: number;
  llmConcurrency: number;
  idempotencyTtlSeconds: number;
  sessionConcurrencyLimit: number;
  globalConcurrencyLimit: number;
  maxQueueDepth: number;
  tokenBudgetPerJob: number;
  latencyBudgetMs: number;
  cacheTtlSeconds: number;
  securityAlertSignatureThreshold: number;
  securityAlertWindowSeconds: number;
};

const toInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const getConfig = (): AppConfig => ({
  ...(() => {
    const preset = resolveRuntimePreset(process.env.RUNTIME_PRESET);
    return {
      runtimePreset: preset.id,
      llmQuantization: process.env.LLM_QUANTIZATION ?? preset.quantization,
      llmContextWindow: toInt(process.env.LLM_CONTEXT_WINDOW, preset.contextWindow),
      llmChunkSize: toInt(process.env.LLM_CHUNK_SIZE, preset.chunkSize),
      llmConcurrency: toInt(process.env.LLM_CONCURRENCY, preset.concurrency),
      globalConcurrencyLimit: toInt(process.env.JOB_CONCURRENCY_LIMIT, preset.concurrency)
    };
  })(),
  apiPort: toInt(process.env.API_PORT, 4000),
  wikipediaLang: process.env.WIKIPEDIA_LANG ?? 'en',
  runMigrations: (process.env.RUN_MIGRATIONS ?? '1') === '1',
  migrationsDir: process.env.MIGRATIONS_DIR ?? '../infra/sql/migrations',
  llmProvider: process.env.LLM_PROVIDER === 'openai_compatible' ? 'openai_compatible' : 'rule_based',
  llmBaseUrl: process.env.LLM_BASE_URL ?? 'http://llm:8080/v1',
  llmModel: process.env.LLM_MODEL ?? 'qwen2.5-14b-instruct-q4_k_m',
  llmTimeoutMs: toInt(process.env.LLM_TIMEOUT_MS, 20_000),
  idempotencyTtlSeconds: toInt(process.env.IDEMPOTENCY_TTL_SECONDS, 3600),
  sessionConcurrencyLimit: toInt(process.env.SESSION_CONCURRENCY_LIMIT, 1),
  maxQueueDepth: toInt(process.env.MAX_QUEUE_DEPTH, 100),
  tokenBudgetPerJob: toInt(process.env.TOKEN_BUDGET_PER_JOB, 40_000),
  latencyBudgetMs: toInt(process.env.LATENCY_BUDGET_MS, 30_000),
  cacheTtlSeconds: toInt(process.env.CACHE_TTL_SECONDS, 604_800),
  securityAlertSignatureThreshold: toInt(process.env.SECURITY_ALERT_SIGNATURE_THRESHOLD, 3),
  securityAlertWindowSeconds: toInt(process.env.SECURITY_ALERT_WINDOW_SECONDS, 300)
});

export { defaultRuntimePresetId };
