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
  trustProxy: boolean;
  authSessionSecret: string;
  authSessionTtlSeconds: number;
  authAllowHeaderUser: boolean;
  shareTokenSecret: string;
  shareLinkTtlSeconds: number;
  shareReadRateLimitWindowSeconds: number;
  shareReadRateLimitMax: number;
  shareReadFailedRateLimitMax: number;
  generationRateLimitWindowSeconds: number;
  generationRateLimitMax: number;
  authRateLimitWindowSeconds: number;
  authRateLimitMax: number;
  analyticsRateLimitWindowSeconds: number;
  analyticsRateLimitMax: number;
  oidcIssuer: string;
  oidcAuthorizationUrl?: string;
  oidcTokenUrl?: string;
  oidcUserinfoUrl?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcRedirectUri?: string;
  oidcScope: string;
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
  securityAlertWindowSeconds: toInt(process.env.SECURITY_ALERT_WINDOW_SECONDS, 300),
  trustProxy: process.env.TRUST_PROXY === '1',
  authSessionSecret: process.env.AUTH_SESSION_SECRET ?? 'dev-only-ultrawiki-session-secret',
  authSessionTtlSeconds: toInt(process.env.AUTH_SESSION_TTL_SECONDS, 86_400),
  authAllowHeaderUser: (process.env.AUTH_ALLOW_HEADER_USER ?? (process.env.NODE_ENV === 'production' ? '0' : '1')) === '1',
  shareTokenSecret: process.env.SHARE_TOKEN_SECRET ?? process.env.AUTH_SESSION_SECRET ?? 'dev-only-ultrawiki-share-token-secret',
  shareLinkTtlSeconds: toInt(process.env.SHARE_LINK_TTL_SECONDS, 604_800),
  shareReadRateLimitWindowSeconds: toInt(process.env.SHARE_READ_RATE_LIMIT_WINDOW_SECONDS, 60),
  shareReadRateLimitMax: toInt(process.env.SHARE_READ_RATE_LIMIT_MAX, 120),
  shareReadFailedRateLimitMax: toInt(process.env.SHARE_READ_FAILED_RATE_LIMIT_MAX, 20),
  generationRateLimitWindowSeconds: toInt(process.env.GENERATION_RATE_LIMIT_WINDOW_SECONDS, 60),
  generationRateLimitMax: toInt(process.env.GENERATION_RATE_LIMIT_MAX, 30),
  authRateLimitWindowSeconds: toInt(process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS, 60),
  authRateLimitMax: toInt(process.env.AUTH_RATE_LIMIT_MAX, 120),
  analyticsRateLimitWindowSeconds: toInt(process.env.ANALYTICS_RATE_LIMIT_WINDOW_SECONDS, 60),
  analyticsRateLimitMax: toInt(process.env.ANALYTICS_RATE_LIMIT_MAX, 240),
  oidcIssuer: process.env.OIDC_ISSUER ?? 'local-oidc',
  oidcAuthorizationUrl: process.env.OIDC_AUTHORIZATION_URL,
  oidcTokenUrl: process.env.OIDC_TOKEN_URL,
  oidcUserinfoUrl: process.env.OIDC_USERINFO_URL,
  oidcClientId: process.env.OIDC_CLIENT_ID,
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET,
  oidcRedirectUri: process.env.OIDC_REDIRECT_URI,
  oidcScope: process.env.OIDC_SCOPE ?? 'openid profile email'
});

export { defaultRuntimePresetId };
