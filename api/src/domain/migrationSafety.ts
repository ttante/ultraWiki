export type MigrationPair = {
  id: string;
  upName: string;
  upSql: string;
  downName: string;
  downSql: string;
};

export type CriticalTableSpec = {
  table: string;
  columns: string[];
};

export type MigrationSafetyOptions = {
  rollbackWindowMigrations?: number;
  criticalTables?: CriticalTableSpec[];
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

const stripSqlComments = (sql: string): string => sql.replace(/--.*$/gm, '');

const extractCreateTableColumns = (sql: string, table: string): string[] => {
  const cleanSql = stripSqlComments(sql);
  const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${escapedTable}\\s*\\(([\\s\\S]*?)\\);`,
    'i'
  );
  const match = cleanSql.match(re);
  if (!match) {
    return [];
  }

  return match[1]
    .split(/[\n,]/)
    .map((line) => line.trim().replace(/,$/, ''))
    .filter((line) => line.length > 0)
    .filter((line) => !/^(primary|foreign|unique|constraint|check)\b/i.test(line))
    .map((line) => line.match(/^"?([a-z_][a-z0-9_]*)"?\s+/i)?.[1].toLowerCase())
    .filter((column): column is string => Boolean(column));
};

const extractAlterTableColumns = (sql: string, table: string): string[] => {
  const cleanSql = stripSqlComments(sql);
  const out: string[] = [];
  const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `ALTER\\s+TABLE\\s+${escapedTable}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?([a-z_][a-z0-9_]*)`,
    'gi'
  );
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleanSql)) !== null) {
    out.push(match[1].toLowerCase());
  }
  return out;
};

const extractKnownColumns = (sql: string, table: string): Set<string> => {
  return new Set([
    ...extractCreateTableColumns(sql, table),
    ...extractAlterTableColumns(sql, table)
  ]);
};

export const evaluateMigrationSafety = (
  pairs: MigrationPair[],
  options: MigrationSafetyOptions = {}
): MigrationSafetyResult => {
  const failures: string[] = [];
  const sorted = [...pairs].sort((a, b) => migrationIdToInt(a.id) - migrationIdToInt(b.id));

  if (options.rollbackWindowMigrations !== undefined) {
    if (!Number.isInteger(options.rollbackWindowMigrations) || options.rollbackWindowMigrations < 1) {
      failures.push('rollbackWindowMigrations must be an integer >= 1');
    } else if (options.rollbackWindowMigrations > sorted.length) {
      failures.push(
        `rollbackWindowMigrations=${options.rollbackWindowMigrations} exceeds migration pair count=${sorted.length}`
      );
    }
  }

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

  if (options.criticalTables && options.criticalTables.length > 0) {
    const allUpSql = sorted.map((pair) => pair.upSql).join('\n');
    const seenTables = new Set(extractCreatedTables(allUpSql));
    for (const spec of options.criticalTables) {
      const table = spec.table.toLowerCase();
      if (!seenTables.has(table)) {
        failures.push(`critical table missing from migrations: ${table}`);
        continue;
      }

      const knownColumns = extractKnownColumns(allUpSql, table);
      for (const column of spec.columns) {
        if (!knownColumns.has(column.toLowerCase())) {
          failures.push(`critical table ${table} missing required column: ${column}`);
        }
      }
    }
  }

  return { pass: failures.length === 0, failures };
};
