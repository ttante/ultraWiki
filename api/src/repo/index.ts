import { Pool } from 'pg';
import { memoryRepo } from './memoryRepo.js';
import { PostgresRepo } from './postgres.js';
import type { AppRepo } from './types.js';
import { logger } from '../logger.js';

let singleton: AppRepo | null = null;

export const getRepo = (): AppRepo => {
  if (singleton) {
    return singleton;
  }

  if (process.env.USE_MEMORY_REPO === '1' || !process.env.DATABASE_URL) {
    singleton = memoryRepo;
    logger.info({ repo: 'memory' }, 'using memory repo');
    return singleton;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  singleton = new PostgresRepo(pool);
  logger.info({ repo: 'postgres' }, 'using postgres repo');
  return singleton;
};
