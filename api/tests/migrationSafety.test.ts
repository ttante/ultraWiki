import { describe, expect, it } from 'vitest';
import { evaluateMigrationSafety } from '../src/domain/migrationSafety.js';

describe('evaluateMigrationSafety', () => {
  it('passes contiguous migration pairs with rollback coverage', () => {
    const result = evaluateMigrationSafety([
      {
        id: '0001',
        upName: '0001_init.sql',
        upSql: 'CREATE TABLE IF NOT EXISTS study_packs (id UUID PRIMARY KEY);',
        downName: '0001_down.sql',
        downSql: 'DROP TABLE IF EXISTS study_packs;'
      },
      {
        id: '0002',
        upName: '0002_retention.sql',
        upSql: 'CREATE OR REPLACE FUNCTION run_retention() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN END; $$;',
        downName: '0002_down.sql',
        downSql: 'DROP FUNCTION IF EXISTS run_retention;'
      }
    ]);
    expect(result.pass).toBe(true);
  });

  it('fails missing rollback objects or non-contiguous ids', () => {
    const result = evaluateMigrationSafety([
      {
        id: '0001',
        upName: '0001_init.sql',
        upSql: 'CREATE TABLE IF NOT EXISTS study_packs (id UUID PRIMARY KEY);',
        downName: '0001_down.sql',
        downSql: '-- forgot table drop'
      },
      {
        id: '0003',
        upName: '0003_retention.sql',
        upSql: 'CREATE OR REPLACE FUNCTION run_retention() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN END; $$;',
        downName: '0003_down.sql',
        downSql: '-- forgot function drop'
      }
    ]);
    expect(result.pass).toBe(false);
    expect(result.failures.join(' ')).toContain('contiguous');
    expect(result.failures.join(' ')).toContain('DROP TABLE');
    expect(result.failures.join(' ')).toContain('DROP FUNCTION');
  });
});
