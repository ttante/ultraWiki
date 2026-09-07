import { readFile } from 'node:fs/promises';
import path from 'node:path';
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

  it('keeps the quiz retake migration backfill for existing attempts', async () => {
    const migration = await readFile(
      path.resolve(process.cwd(), '../infra/sql/migrations/0020_quiz_retakes_mastery.sql'),
      'utf8'
    );

    expect(migration).toContain('ROW_NUMBER() OVER');
    expect(migration).toContain('PARTITION BY user_id, pack_id');
    expect(migration).toContain('ORDER BY submitted_at ASC, id ASC');
    expect(migration).toContain('LAG(accuracy) OVER');
    expect(migration).toContain('SET attempt_number = sequenced.attempt_number');
    expect(migration).toContain('previous_accuracy = sequenced.previous_accuracy');
  });

  it('extends lifecycle retention to identity, share, and learning review data', async () => {
    const migration = await readFile(
      path.resolve(process.cwd(), '../infra/sql/migrations/0022_lifecycle_identity_learning_retention.sql'),
      'utf8'
    );

    expect(migration).toContain('p_profile_days INT DEFAULT 730');
    expect(migration).toContain('p_share_days INT DEFAULT 90');
    expect(migration).toContain('p_learning_review_days INT DEFAULT 365');
    expect(migration).toContain('DELETE FROM share_links');
    expect(migration).toContain('DELETE FROM flashcard_reviews');
    expect(migration).toContain('DELETE FROM learning_sessions');
    expect(migration).toContain('DELETE FROM quiz_attempts');
    expect(migration).toContain('DELETE FROM user_profiles');
    expect(migration).toContain('share_links_pruned');
    expect(migration).toContain('flashcard_reviews_pruned');
    expect(migration).toContain('learning_sessions_pruned');
    expect(migration).toContain('quiz_attempts_pruned');
  });

  it('keeps generation feedback isolated from trusted evaluation artifacts', async () => {
    const migration = await readFile(
      path.resolve(process.cwd(), '../infra/sql/migrations/0023_generation_feedback.sql'),
      'utf8'
    );
    const rollback = await readFile(
      path.resolve(process.cwd(), '../infra/sql/migrations/0023_down.sql'),
      'utf8'
    );

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS generation_feedback');
    expect(migration).toContain('REFERENCES user_profiles(user_id) ON DELETE CASCADE');
    expect(migration).toContain('REFERENCES study_packs(id) ON DELETE CASCADE');
    expect(migration).toContain('trusted_artifact BOOLEAN NOT NULL DEFAULT FALSE');
    expect(migration).toContain('CHECK (trusted_artifact = FALSE)');
    expect(migration).toContain('eval_candidate BOOLEAN NOT NULL DEFAULT TRUE');
    expect(migration).toContain('idx_generation_feedback_pack_created');
    expect(migration).toContain('idx_generation_feedback_user_created');
    expect(rollback).toContain('DROP TABLE IF EXISTS generation_feedback');
  });

  it('adds indexes for bounded library, share, progress, analytics, and ops queries', async () => {
    const migration = await readFile(
      path.resolve(process.cwd(), '../infra/sql/migrations/0024_query_limit_indexes.sql'),
      'utf8'
    );
    const rollback = await readFile(
      path.resolve(process.cwd(), '../infra/sql/migrations/0024_down.sql'),
      'utf8'
    );

    const requiredIndexes = [
      'idx_generation_jobs_session_updated',
      'idx_generation_jobs_pack_updated',
      'idx_share_links_owner_pack_active',
      'idx_flashcard_reviews_user_reviewed',
      'idx_learning_sessions_user_activity',
      'idx_quiz_attempts_user_submitted',
      'idx_generation_outcomes_recorded_status',
      'idx_stage_cost_events_recorded_filters'
    ];

    for (const indexName of requiredIndexes) {
      expect(migration).toContain(`CREATE INDEX IF NOT EXISTS ${indexName}`);
      expect(rollback).toContain(`DROP INDEX IF EXISTS ${indexName}`);
    }
    expect(migration).toContain('COALESCE(completed_at, started_at)');
    expect(migration).toContain('WHERE revoked_at IS NULL');
  });

  it('adds saved-pack organization metadata with rollback coverage', async () => {
    const migration = await readFile(
      path.resolve(process.cwd(), '../infra/sql/migrations/0025_saved_pack_organization.sql'),
      'utf8'
    );
    const rollback = await readFile(
      path.resolve(process.cwd(), '../infra/sql/migrations/0025_down.sql'),
      'utf8'
    );

    expect(migration).toContain('ADD COLUMN IF NOT EXISTS tags TEXT[]');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS collection TEXT');
    expect(migration).toContain('idx_saved_packs_user_collection');
    expect(migration).toContain('idx_saved_packs_tags_gin');
    expect(rollback).toContain('DROP INDEX IF EXISTS idx_saved_packs_tags_gin');
    expect(rollback).toContain('DROP COLUMN IF EXISTS collection');
    expect(rollback).toContain('DROP COLUMN IF EXISTS tags');
  });
});
