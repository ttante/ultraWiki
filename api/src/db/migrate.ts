import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { logger } from '../logger.js';

const isUpMigration = (file: string): boolean => /^\d+_.*\.sql$/.test(file) && !file.includes('_down.');

export const runMigrations = async (databaseUrl: string, migrationsDir: string): Promise<void> => {
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );

    const files = (await readdir(migrationsDir)).filter(isUpMigration).sort();

    for (const file of files) {
      const exists = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
      if (exists.rowCount && exists.rowCount > 0) {
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await pool.query('BEGIN');
      try {
        await pool.query(sql);
        await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await pool.query('COMMIT');
        logger.info({ file }, 'applied migration');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await pool.end();
  }
};
