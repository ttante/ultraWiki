export type AppConfig = {
  apiPort: number;
  wikipediaLang: string;
  runMigrations: boolean;
  migrationsDir: string;
  idempotencyTtlSeconds: number;
  sessionConcurrencyLimit: number;
  globalConcurrencyLimit: number;
  maxQueueDepth: number;
  tokenBudgetPerJob: number;
  latencyBudgetMs: number;
};

const toInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const getConfig = (): AppConfig => ({
  apiPort: toInt(process.env.API_PORT, 4000),
  wikipediaLang: process.env.WIKIPEDIA_LANG ?? 'en',
  runMigrations: (process.env.RUN_MIGRATIONS ?? '1') === '1',
  migrationsDir: process.env.MIGRATIONS_DIR ?? '../infra/sql/migrations',
  idempotencyTtlSeconds: toInt(process.env.IDEMPOTENCY_TTL_SECONDS, 3600),
  sessionConcurrencyLimit: toInt(process.env.SESSION_CONCURRENCY_LIMIT, 1),
  globalConcurrencyLimit: toInt(process.env.JOB_CONCURRENCY_LIMIT, 2),
  maxQueueDepth: toInt(process.env.MAX_QUEUE_DEPTH, 100),
  tokenBudgetPerJob: toInt(process.env.TOKEN_BUDGET_PER_JOB, 40_000),
  latencyBudgetMs: toInt(process.env.LATENCY_BUDGET_MS, 30_000)
});
