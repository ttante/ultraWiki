import path from 'node:path';
import { getConfig } from './config.js';
import { logger } from './logger.js';
import { buildApp } from './app.js';
import { runMigrations } from './db/migrate.js';

const start = async (): Promise<void> => {
  const config = getConfig();

  if (config.runMigrations && process.env.DATABASE_URL) {
    const migrationsDir = path.resolve(process.cwd(), config.migrationsDir);
    await runMigrations(process.env.DATABASE_URL, migrationsDir);
    logger.info({ migrationsDir }, 'migrations complete');
  }

  const app = buildApp();
  app.listen(config.apiPort, () => {
    logger.info({ port: config.apiPort }, 'api listening');
  });
};

start().catch((error: unknown) => {
  logger.error({ err: error }, 'startup failed');
  process.exit(1);
});
