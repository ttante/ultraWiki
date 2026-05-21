export type MigrationPair = {
  id: string;
  upName: string;
  upSql: string;
  downName: string;
  downSql: string;
};

export type MigrationSafetyResult = {
  pass: boolean;
  failures: string[];
};

const migrationIdToInt = (id: string): number => Number.parseInt(id, 10);

const extractCreatedTables = (sql: string): string[] => {
  const out: string[] = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    out.push(m[1].toLowerCase());
  }
  return out;
};

const extractCreatedFunctions = (sql: string): string[] => {
  const out: string[] = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_][a-z0-9_]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    out.push(m[1].toLowerCase());
  }
  return out;
};

export const evaluateMigrationSafety = (pairs: MigrationPair[]): MigrationSafetyResult => {
  const failures: string[] = [];
  const sorted = [...pairs].sort((a, b) => migrationIdToInt(a.id) - migrationIdToInt(b.id));

  for (let i = 0; i < sorted.length; i += 1) {
    const expectedId = String(i + 1).padStart(4, '0');
    if (sorted[i].id !== expectedId) {
      failures.push(`migration ids must be contiguous starting at 0001 (expected ${expectedId}, got ${sorted[i].id})`);
    }
  }

  for (const pair of sorted) {
    if (pair.upSql.trim().length === 0) {
      failures.push(`up migration empty: ${pair.upName}`);
    }
    if (pair.downSql.trim().length === 0) {
      failures.push(`down migration empty: ${pair.downName}`);
    }

    const downSqlLower = pair.downSql.toLowerCase();
    for (const table of extractCreatedTables(pair.upSql)) {
      if (!downSqlLower.includes(`drop table if exists ${table}`)) {
        failures.push(`down migration ${pair.downName} missing DROP TABLE for ${table}`);
      }
    }
    for (const fn of extractCreatedFunctions(pair.upSql)) {
      if (!downSqlLower.includes(`drop function if exists ${fn}`)) {
        failures.push(`down migration ${pair.downName} missing DROP FUNCTION for ${fn}`);
      }
    }
  }

  return { pass: failures.length === 0, failures };
};
