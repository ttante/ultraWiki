import { describe, expect, it } from 'vitest';
import { evaluateMigrationSafety } from '../src/domain/migrationSafety.js';

describe('evaluateMigrationSafety', () => {
  it('passes contiguous migration pairs with rollback coverage', () => {
    const result = evaluateMigrationSafety(
      [
        {
          id: '0001',
          upName: '0001_init.sql',
          upSql: 'CREATE TABLE IF NOT EXISTS study_packs (id UUID PRIMARY KEY, input TEXT NOT NULL);',
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
      ],
      {
        rollbackWindowMigrations: 2,
        criticalTables: [{ table: 'study_packs', columns: ['id', 'input'] }]
      }
    );
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

  it('fails missing critical tables or critical columns', () => {
    const result = evaluateMigrationSafety(
      [
        {
          id: '0001',
          upName: '0001_init.sql',
          upSql: 'CREATE TABLE IF NOT EXISTS study_packs (id UUID PRIMARY KEY);',
          downName: '0001_down.sql',
          downSql: 'DROP TABLE IF EXISTS study_packs;'
        }
      ],
      {
        rollbackWindowMigrations: 2,
        criticalTables: [
          { table: 'study_packs', columns: ['id', 'input'] },
          { table: 'generation_jobs', columns: ['id', 'status'] }
        ]
      }
    );
    expect(result.pass).toBe(false);
    expect(result.failures.join(' ')).toContain('rollbackWindowMigrations=2 exceeds');
    expect(result.failures.join(' ')).toContain('critical table study_packs missing required column: input');
    expect(result.failures.join(' ')).toContain('critical table missing from migrations: generation_jobs');
  });

  it('recognizes critical columns added by ALTER TABLE', () => {
    const result = evaluateMigrationSafety(
      [
        {
          id: '0001',
          upName: '0001_init.sql',
          upSql: 'CREATE TABLE IF NOT EXISTS generation_jobs (id UUID PRIMARY KEY, status TEXT NOT NULL);',
          downName: '0001_down.sql',
          downSql: 'DROP TABLE IF EXISTS generation_jobs;'
        },
        {
          id: '0002',
          upName: '0002_generation_job_reason.sql',
          upSql: 'ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS degradation_reason TEXT;',
          downName: '0002_down.sql',
          downSql: 'ALTER TABLE generation_jobs DROP COLUMN IF EXISTS degradation_reason;'
        }
      ],
      {
        rollbackWindowMigrations: 2,
        criticalTables: [{ table: 'generation_jobs', columns: ['id', 'status', 'degradation_reason'] }]
      }
    );
    expect(result.pass).toBe(true);
  });
});
