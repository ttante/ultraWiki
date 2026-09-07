import type { QueryResult } from 'pg';
import { describe, expect, it } from 'vitest';
import { computeQuizMasteryTrend } from '../src/domain/masteryTrend.js';
import { applyDataRepairs, collectDataRepairDryRun } from '../scripts/data-repair.js';

class FakeQueryable {
  readonly sql: string[] = [];
  private readonly results: Array<QueryResult<Record<string, unknown>>>;

  constructor(results: Array<QueryResult<Record<string, unknown>>>) {
    this.results = [...results];
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string): Promise<QueryResult<T>> {
    this.sql.push(sql);
    const result = this.results.shift();
    if (!result) {
      throw new Error(`unexpected query: ${sql}`);
    }
    return result as QueryResult<T>;
  }
}

const countResult = (count: number): QueryResult<Record<string, unknown>> => ({
  command: 'SELECT',
  rowCount: 1,
  oid: 0,
  fields: [],
  rows: [{ count }]
});

const writeResult = (rows: number): QueryResult<Record<string, unknown>> => ({
  command: 'UPDATE',
  rowCount: rows,
  oid: 0,
  fields: [],
  rows: Array.from({ length: rows }, (_, index) => ({ id: `row-${index}` }))
});

describe('data repair script helpers', () => {
  it('dry-runs repair counts without issuing repair writes', async () => {
    const fake = new FakeQueryable([countResult(2), countResult(3), countResult(1), countResult(4)]);

    const report = await collectDataRepairDryRun(fake);

    expect(report.dryRun).toBe(true);
    expect(report.totalRows).toBe(10);
    expect(report.items).toEqual([
      expect.objectContaining({ scope: 'profile_records', rows: 2 }),
      expect.objectContaining({ scope: 'learning_saved_packs', rows: 3 }),
      expect.objectContaining({ scope: 'share_link_tokens', rows: 1 }),
      expect.objectContaining({ scope: 'quiz_attempt_sequences', rows: 4 })
    ]);
    expect(fake.sql.join('\n')).not.toMatch(/\bINSERT INTO\b|\bUPDATE\s+(share_links|quiz_attempts)\b/i);
  });

  it('applies profile, learning saved-pack, share token, and quiz sequence repairs', async () => {
    const fake = new FakeQueryable([writeResult(2), writeResult(3), writeResult(1), writeResult(4)]);

    const report = await applyDataRepairs(fake);

    expect(report.dryRun).toBe(false);
    expect(report.totalRows).toBe(10);
    expect(report.items.map((item) => [item.scope, item.rows])).toEqual([
      ['profile_records', 2],
      ['learning_saved_packs', 3],
      ['share_link_tokens', 1],
      ['quiz_attempt_sequences', 4]
    ]);
    expect(fake.sql.join('\n')).toContain('INSERT INTO user_profiles');
    expect(fake.sql.join('\n')).toContain('INSERT INTO saved_packs');
    expect(fake.sql.join('\n')).toContain('UPDATE share_links');
    expect(fake.sql.join('\n')).toContain('UPDATE quiz_attempts');
    expect(fake.sql.join('\n')).toContain("'legacy-md5:' || md5(share_id::text)");
    expect(fake.sql.join('\n')).toContain('ROW_NUMBER() OVER');
    expect(fake.sql.join('\n')).toContain('card_mastery_score');
    expect(fake.sql.join('\n')).toContain('expected_previous_mastery_score');
    expect(fake.sql.join('\n')).toContain('COALESCE(expected_previous_mastery_score');
    expect(fake.sql.join('\n')).toContain('LAG(expected_mastery_score) OVER');
    expect(fake.sql.join('\n')).not.toContain('LAG(mastery_score)');
  });

  it('keeps the quiz repair SQL aligned with the production mastery trend formula', async () => {
    const trend = computeQuizMasteryTrend({
      accuracy: 0.5,
      cardMasteryScore: 0.8,
      previousAccuracy: 0.25,
      previousMasteryScore: 0.6
    });
    expect(trend).toEqual({
      accuracyDelta: 0.25,
      masteryScore: 0.65,
      masteryDelta: 0.05
    });

    const fake = new FakeQueryable([writeResult(0), writeResult(0), writeResult(0), writeResult(0)]);
    await applyDataRepairs(fake);
    const sql = fake.sql.join('\n');

    expect(sql).toContain(
      '((LEAST(1, GREATEST(0, accuracy)) + LEAST(1, GREATEST(0, card_mastery_score))) / 2)'
    );
    expect(sql).toContain(
      'expected_mastery_score - COALESCE(expected_previous_mastery_score, expected_normalized_card_mastery)'
    );
    expect(sql).not.toContain('quiz_attempts.accuracy AS expected_mastery_score');
  });

  it('uses repaired previous mastery, not corrupt stored mastery, for retake deltas', async () => {
    const firstExpected = computeQuizMasteryTrend({
      accuracy: 0.5,
      cardMasteryScore: 1
    });
    const secondExpected = computeQuizMasteryTrend({
      accuracy: 0.75,
      cardMasteryScore: 1,
      previousAccuracy: 0.5,
      previousMasteryScore: firstExpected.masteryScore
    });

    expect(firstExpected.masteryScore).toBe(0.75);
    expect(secondExpected.masteryDelta).toBe(0.125);

    const fake = new FakeQueryable([writeResult(0), writeResult(0), writeResult(0), writeResult(0)]);
    await applyDataRepairs(fake);
    const sql = fake.sql.join('\n');

    expect(sql).toContain('scored_with_previous AS');
    expect(sql).toContain('LAG(expected_mastery_score) OVER');
    expect(sql).not.toContain('LAG(mastery_score)');
  });
});
