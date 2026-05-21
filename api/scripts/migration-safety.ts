import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateMigrationSafety, type MigrationPair } from '../src/domain/migrationSafety.js';

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const migrationDir = path.resolve(scriptDir, '../../infra/sql/migrations');
  const files = (await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort();

  const ups = files.filter((name) => /^\d{4}_.+\.sql$/.test(name) && !name.endsWith('_down.sql'));
  const downs = new Set(files.filter((name) => /^\d{4}_down\.sql$/.test(name)));
  const pairs: MigrationPair[] = [];
  const failures: string[] = [];

  for (const up of ups) {
    const id = up.slice(0, 4);
    const down = `${id}_down.sql`;
    if (!downs.has(down)) {
      failures.push(`missing down migration for ${up} (expected ${down})`);
      continue;
    }

    const [upSql, downSql] = await Promise.all([
      readFile(path.resolve(migrationDir, up), 'utf8'),
      readFile(path.resolve(migrationDir, down), 'utf8')
    ]);
    pairs.push({ id, upName: up, upSql, downName: down, downSql });
  }

  const result = evaluateMigrationSafety(pairs);
  const allFailures = [...failures, ...result.failures];
  if (allFailures.length > 0) {
    for (const failure of allFailures) {
      console.error(`FAIL ${failure}`);
    }
    process.exit(1);
  }

  console.log(`Migration safety suite passed: ${pairs.length} migration pairs`);
};

void run();
