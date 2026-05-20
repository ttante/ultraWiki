import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../src/db/migrate.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultMigrationsDir = path.resolve(scriptDir, '../../infra/sql/migrations');
const migrationsDir = process.env.MIGRATIONS_DIR ?? defaultMigrationsDir;

const run = async (): Promise<void> => {
  await runMigrations(databaseUrl, migrationsDir);
  console.log(`Migrations complete (${migrationsDir})`);
};

void run();
