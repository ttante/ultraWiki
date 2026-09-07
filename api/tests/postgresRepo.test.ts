import { describe, expect, it, vi } from 'vitest';
import { activeShareTokenVersion, createShareTokenHash } from '../src/domain/shareLinks.js';
import { PostgresRepo, type PgClient } from '../src/repo/postgres.js';

describe('PostgresRepo outcomes persistence', () => {
  it('reads and writes source cache records with ttl filtering in SQL', async () => {
    const query = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({
        rows: [
          {
            cache_key: 'wikipedia:en:ada lovelace',
            source_title: 'Ada Lovelace',
            source_revision_id: 'rev-1',
            parser_version: 'parser@1.0.0',
            language: 'en',
            sections: [{ heading: 'Overview', content: 'content' }],
            outgoing_links: [{ title: 'Analytical Engine', url: 'https://en.wikipedia.org/wiki/Analytical_Engine', sourceHeading: 'Overview' }],
            cached_at: '2026-01-01T00:00:00.000Z',
            expires_at: '2026-01-08T00:00:00.000Z'
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const repo = new PostgresRepo({ query });
    const cached = await repo.getCachedSource('wikipedia:en:ada lovelace', 'parser@1.0.0');
    await repo.saveCachedSource({
      cacheKey: 'wikipedia:en:ada lovelace',
      sourceTitle: 'Ada Lovelace',
      sourceRevisionId: 'rev-1',
      parserVersion: 'parser@1.0.0',
      language: 'en',
      sections: [{ heading: 'Overview', content: 'content' }],
      outgoingLinks: [],
      cachedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-08T00:00:00.000Z'
    });

    expect(cached?.sourceRevisionId).toBe('rev-1');
    expect(String(query.mock.calls[0]?.[0])).toContain('expires_at > NOW()');
    expect(String(query.mock.calls[1]?.[0])).toContain('INSERT INTO source_cache');
  });

  it('reads and writes artifact cache records and provenance events', async () => {
    const query = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({
        rows: [
          {
            cache_key: 'summaries:rev-1:summary@1.0.0:1.0.0',
            kind: 'summaries',
            source_revision_id: 'rev-1',
            prompt_version: 'summary@1.0.0',
            taxonomy_version: '1.0.0',
            payload: { summaries: [] },
            cached_at: '2026-01-01T00:00:00.000Z',
            expires_at: '2026-01-08T00:00:00.000Z'
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const repo = new PostgresRepo({ query });
    const cached = await repo.getCachedArtifact('summaries', 'rev-1', 'summary@1.0.0', '1.0.0');
    await repo.saveCachedArtifact({
      cacheKey: 'summaries:rev-1:summary@1.0.0:1.0.0',
      kind: 'summaries',
      sourceRevisionId: 'rev-1',
      promptVersion: 'summary@1.0.0',
      taxonomyVersion: '1.0.0',
      payload: { summaries: [] },
      cachedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-08T00:00:00.000Z'
    });
    await repo.recordCacheEvent('pack-1', {
      stage: 'summaries',
      cacheKey: 'summaries:rev-1:summary@1.0.0:1.0.0',
      hit: true,
      sourceRevisionId: 'rev-1',
      promptVersion: 'summary@1.0.0',
      taxonomyVersion: '1.0.0'
    });

    expect(cached?.payload).toEqual({ summaries: [] });
    expect(String(query.mock.calls[0]?.[0])).toContain('artifact_cache');
    expect(String(query.mock.calls[1]?.[0])).toContain('INSERT INTO artifact_cache');
    expect(String(query.mock.calls[2]?.[0])).toContain('INSERT INTO pack_cache_events');
  });

  it('summarizes and invalidates stale cache records for admin repair', async () => {
    const query = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({ rows: [{ total: 2, fresh: 1, expired: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ total: 3, fresh: 1, expired: 2 }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          { kind: 'active_recall', total: 1, expired: 1 },
          { kind: 'summaries', total: 2, expired: 1 }
        ],
        rowCount: 2
      })
      .mockResolvedValueOnce({
        rows: [
          {
            cache_key: 'wikipedia:en:stale',
            source_title: 'Stale Source',
            source_revision_id: 'rev-stale',
            parser_version: 'parser@1.0.0',
            expires_at: '2026-01-02T00:00:00.000Z'
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            cache_key: 'summaries:rev-stale:summary@1.0.0:1.0.0',
            kind: 'summaries',
            source_revision_id: 'rev-stale',
            prompt_version: 'summary@1.0.0',
            taxonomy_version: '1.0.0',
            expires_at: '2026-01-02T00:00:00.000Z'
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [{ count: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ count: 2 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 });

    const repo = new PostgresRepo({ query });
    const snapshot = await repo.getCacheAdminSnapshot('2026-01-10T00:00:00.000Z');
    const result = await repo.invalidateCache({
      target: 'expired',
      dryRun: false,
      requestedAt: '2026-01-10T00:00:00.000Z',
      reason: 'ops_stale_artifact_repair'
    });

    expect(snapshot).toMatchObject({
      source: { total: 2, fresh: 1, expired: 1 },
      artifacts: { total: 3, fresh: 1, expired: 2 },
      repairCandidates: 3
    });
    expect(snapshot.staleSources[0]?.cacheKey).toBe('wikipedia:en:stale');
    expect(snapshot.staleArtifacts[0]?.kind).toBe('summaries');
    expect(result).toMatchObject({
      target: 'expired',
      dryRun: false,
      matchedSource: 1,
      matchedArtifacts: 2,
      deletedSource: 1,
      deletedArtifacts: 2,
      reason: 'ops_stale_artifact_repair'
    });
    expect(String(query.mock.calls[0]?.[0])).toContain('FROM source_cache');
    expect(String(query.mock.calls[3]?.[0])).toContain('ORDER BY expires_at ASC');
    expect(String(query.mock.calls[5]?.[0])).toContain('FROM source_cache WHERE expires_at <= $1');
    expect(String(query.mock.calls[7]?.[0])).toContain('DELETE FROM source_cache WHERE expires_at <= $1');
    expect(query.mock.calls[7]?.[1]).toEqual(['2026-01-10T00:00:00.000Z']);
    expect(query.mock.calls[8]?.[1]).toEqual(['2026-01-10T00:00:00.000Z']);
  });

  it('persists source links during ingestion', async () => {
    const query = vi.fn<PgClient['query']>().mockResolvedValue({ rows: [], rowCount: 1 });
    const repo = new PostgresRepo({ query });

    await repo.saveIngestedPack('pack-1', 'Ada Lovelace', {
      revisionId: 'rev-1',
      title: 'Ada Lovelace',
      sections: [{ heading: 'Overview', content: 'Ada Lovelace wrote about the Analytical Engine.' }],
      outgoingLinks: [
        {
          title: 'Analytical Engine',
          url: 'https://en.wikipedia.org/wiki/Analytical_Engine',
          sourceHeading: 'Overview'
        }
      ]
    });

    expect(query).toHaveBeenCalledTimes(7);
    expect(String(query.mock.calls[2]?.[0])).toContain('DELETE FROM source_sections');
    expect(String(query.mock.calls[3]?.[0])).toContain('DELETE FROM source_links');
    expect(String(query.mock.calls[5]?.[0])).toContain('INSERT INTO source_links');
    expect(query.mock.calls[5]?.[1]).toEqual([
      'pack-1',
      'Analytical Engine',
      'https://en.wikipedia.org/wiki/Analytical_Engine',
      'Overview'
    ]);
  });

  it('saves quiz attempts using persisted quiz artifacts', async () => {
    const query = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [
          { id: 1, correct_index: 0 },
          { id: 2, correct_index: 2 }
        ],
        rowCount: 2
      })
      .mockResolvedValueOnce({
        rows: [{ attempt_number: 1, accuracy: 0.25, mastery_score: 0.4 }],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'attempt-1',
            user_id: 'user-1',
            pack_id: 'pack-1',
            attempt_number: 2,
            selected_indices: [0, 1],
            total_questions: 2,
            correct_answers: 1,
            accuracy: 0.5,
            previous_accuracy: 0.25,
            accuracy_delta: 0.25,
            card_mastery_score: 0.75,
            mastery_score: 0.625,
            mastery_delta: 0.225,
            submitted_at: '2026-01-01T00:00:00.000Z'
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'attempt-1',
            user_id: 'user-1',
            pack_id: 'pack-1',
            attempt_number: 2,
            selected_indices: [0, 1],
            total_questions: 2,
            correct_answers: 1,
            accuracy: 0.5,
            previous_accuracy: 0.25,
            accuracy_delta: 0.25,
            card_mastery_score: 0.75,
            mastery_score: 0.625,
            mastery_delta: 0.225,
            submitted_at: '2026-01-01T00:00:00.000Z'
          }
        ],
        rowCount: 1
      });

    const repo = new PostgresRepo({ query });
    const attempt = await repo.saveQuizAttempt('user-1', 'pack-1', [0, 1], 0.75);
    const attempts = await repo.listQuizAttempts('user-1', 'pack-1', 5);

    expect(attempt?.id).toBe('attempt-1');
    expect(attempt?.userId).toBe('user-1');
    expect(attempt?.attemptNumber).toBe(2);
    expect(attempt?.selectedIndices).toEqual([0, 1]);
    expect(attempt?.correctAnswers).toBe(1);
    expect(attempt?.accuracy).toBe(0.5);
    expect(attempt?.accuracyDelta).toBe(0.25);
    expect(attempt?.masteryScore).toBe(0.625);
    expect(attempts).toHaveLength(1);
    expect(String(query.mock.calls[3]?.[0])).toContain('INSERT INTO quiz_attempts');
    expect(String(query.mock.calls[5]?.[0])).toContain('FROM quiz_attempts');
    expect(query.mock.calls[5]?.[1]).toEqual(['user-1', 'pack-1', 5]);
    expect(query).toHaveBeenCalledTimes(6);
  });

  it('clamps direct repo query limits for attempts, shares, history, and cost drilldowns', async () => {
    const query = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [
          {
            events: 0,
            estimated_tokens: 0,
            total_estimated_usd: 0,
            avg_estimated_usd: 0,
            avg_latency_ms: 0,
            distinct_packs: 0
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const repo = new PostgresRepo({ query });

    await repo.listQuizAttempts('user-1', 'pack-1', 500);
    await repo.listShareLinksForOwner('user-1', 'pack-1', 500);
    await repo.listRecentPacksForSession('session-1', 0);
    await repo.listSavedPacksForUser('user-1', Number.NaN);
    const drilldown = await repo.getCostDrilldownSnapshot(24, { limit: 500 });

    expect(query.mock.calls[0]?.[1]).toEqual(['user-1', 'pack-1', 50]);
    expect(query.mock.calls[1]?.[1]).toEqual(['user-1', 'pack-1', 50]);
    expect(query.mock.calls[2]?.[1]).toEqual(['session-1', 1]);
    expect(query.mock.calls[3]?.[1]).toEqual(['user-1', null]);
    expect(query.mock.calls[4]?.[1]).toEqual(['user-1', null, 'all', 'all', 'saved_desc', null, null, 12]);
    expect(String(query.mock.calls[6]?.[0])).toContain('LIMIT $2');
    expect(query.mock.calls[6]?.[1]).toEqual([24, 50]);
    expect(drilldown.filters.limit).toBe(50);
  });

  it('returns persisted outcome aggregates', async () => {
    const query = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({
        rows: [
          {
            completed: 3,
            failed: 1,
            avg_duration_ms: 1000,
            avg_citation_rate: 0.9,
            avg_flashcards: 15,
            avg_quiz_questions: 10
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [{ attempts: 4, retakes: 2, avg_accuracy: 0.75, avg_mastery_score: 0.7, avg_mastery_delta: 0.12 }],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            stage: 'summarization',
            events: 3,
            avg_tokens: 1400,
            avg_latency_ms: 3100,
            total_estimated_usd: 0.042,
            avg_estimated_usd: 0.014
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [{ total_estimated_usd: 0.09, distinct_packs: 3 }],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [{ p95_time_to_first_artifact_ms: 18000, p95_full_pack_completion_ms: 42000 }],
        rowCount: 1
      });

    const repo = new PostgresRepo({ query });
    const snapshot = await repo.getOutcomesSnapshot();

    expect(snapshot.jobs.completed).toBe(3);
    expect(snapshot.jobs.failed).toBe(1);
    expect(snapshot.jobs.completionRate).toBe(0.75);
    expect(snapshot.quality.avgCitationRate).toBe(0.9);
    expect(snapshot.learning.attempts).toBe(4);
    expect(snapshot.learning.retakes).toBe(2);
    expect(snapshot.learning.avgAccuracy).toBe(0.75);
    expect(snapshot.learning.avgMasteryScore).toBe(0.7);
    expect(snapshot.learning.avgMasteryDelta).toBe(0.12);
    expect(snapshot.slo.p95TimeToFirstArtifactMs).toBe(18000);
    expect(snapshot.slo.p95FullPackCompletionMs).toBe(42000);
    expect(snapshot.slo.jobSuccessRate).toBe(0.75);
    expect(snapshot.slo.citationCoverageRate).toBe(0.9);
    expect(snapshot.cost.totalEstimatedUsd).toBe(0.09);
    expect(snapshot.cost.avgEstimatedUsdPerPack).toBeCloseTo(0.03, 6);
    expect(snapshot.cost.byStage[0].stage).toBe('summarization');
    expect(snapshot.cost.byStage[0].events).toBe(3);
  });

  it('applies outcome snapshot windows to outcome, learning, cost, and SLO queries', async () => {
    const query = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({
        rows: [{ completed: 0, failed: 0, avg_duration_ms: 0, avg_citation_rate: 0, avg_flashcards: 0, avg_quiz_questions: 0 }],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [{ attempts: 0, retakes: 0, avg_accuracy: 0, avg_mastery_score: 0, avg_mastery_delta: 0 }],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ total_estimated_usd: 0, distinct_packs: 0 }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ p95_time_to_first_artifact_ms: 0, p95_full_pack_completion_ms: 0 }],
        rowCount: 1
      });

    const repo = new PostgresRepo({ query });
    await repo.getOutcomesSnapshot(24);

    expect(query).toHaveBeenCalledTimes(5);
    for (const call of query.mock.calls) {
      expect(call[1]).toEqual([24]);
    }
    expect(String(query.mock.calls[0]?.[0])).toContain('recorded_at > NOW()');
    expect(String(query.mock.calls[1]?.[0])).toContain('submitted_at > NOW()');
    expect(String(query.mock.calls[2]?.[0])).toContain('recorded_at > NOW()');
    expect(String(query.mock.calls[4]?.[0])).toContain('recorded_at > NOW()');
  });

  it('returns latest outcomes maintenance snapshot', async () => {
    const query = vi.fn<PgClient['query']>().mockResolvedValueOnce({
      rows: [
        {
          finished_at: '2026-01-01T00:00:00.000Z',
          duration_ms: 3210,
          outcomes_pruned: 11,
          quiz_attempts_pruned: 9,
          rollups_refreshed: 8
        }
      ],
      rowCount: 1
    });

    const repo = new PostgresRepo({ query });
    const snapshot = await repo.getOutcomesMaintenanceSnapshot();

    expect(snapshot.lastRunAt).toBe('2026-01-01T00:00:00.000Z');
    expect(snapshot.durationMs).toBe(3210);
    expect(snapshot.outcomesPruned).toBe(11);
    expect(snapshot.quizAttemptsPruned).toBe(9);
    expect(snapshot.rollupsRefreshed).toBe(8);
  });

  it('returns operational metrics for degradation and cache health', async () => {
    const query = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({
        rows: [{ completed_jobs: 10, partial_jobs: 2 }],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [{ events: 20, hits: 15 }],
        rowCount: 1
      });

    const repo = new PostgresRepo({ query });
    const snapshot = await repo.getOperationalMetricsSnapshot();

    expect(snapshot.degradation.completedJobs).toBe(10);
    expect(snapshot.degradation.partialJobs).toBe(2);
    expect(snapshot.degradation.partialRate).toBe(0.2);
    expect(snapshot.cache.events).toBe(20);
    expect(snapshot.cache.hits).toBe(15);
    expect(snapshot.cache.misses).toBe(5);
    expect(snapshot.cache.hitRate).toBe(0.75);
  });

  it('returns cost trend snapshots with stage, pack, and prompt/model breakdowns', async () => {
    const query = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({
        rows: [
          {
            stage: 'summarization',
            events: 2,
            avg_tokens: 1200,
            avg_latency_ms: 3000,
            total_estimated_usd: 0.04,
            avg_estimated_usd: 0.02
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [{ total_estimated_usd: 0.09, distinct_packs: 3 }],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            pack_id: 'pack-1',
            events: 3,
            estimated_tokens: 2500,
            total_estimated_usd: 0.05,
            avg_estimated_usd: 0.016667
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            prompt_version: 'summary-by-level@1.0.0',
            model: 'local-rule-based',
            events: 2,
            avg_latency_ms: 3000,
            estimated_tokens: 2400,
            total_estimated_usd: 0.04
          }
        ],
        rowCount: 1
      });

    const repo = new PostgresRepo({ query });
    const snapshot = await repo.getCostTrendSnapshot(24);

    expect(snapshot.windowHours).toBe(24);
    expect(snapshot.totalEstimatedUsd).toBe(0.09);
    expect(snapshot.avgEstimatedUsdPerPack).toBeCloseTo(0.03, 6);
    expect(snapshot.byStage[0].stage).toBe('summarization');
    expect(snapshot.byPack[0].packId).toBe('pack-1');
    expect(snapshot.byPromptModel[0]).toMatchObject({
      promptVersion: 'summary-by-level@1.0.0',
      model: 'local-rule-based',
      events: 2
    });
    expect(String(query.mock.calls[0]?.[0])).toContain('recorded_at > NOW()');
  });

  it('returns filtered cost drilldown snapshots', async () => {
    const query = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({
        rows: [
          {
            events: 2,
            estimated_tokens: 2400,
            total_estimated_usd: 0.04,
            avg_estimated_usd: 0.02,
            avg_latency_ms: 3000,
            distinct_packs: 1
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            pack_id: 'pack-1',
            prompt_version: 'summary-by-level@1.0.0',
            model: 'local-rule-based',
            stage: 'summarization',
            events: 2,
            estimated_tokens: 2400,
            avg_tokens: 1200,
            avg_latency_ms: 3000,
            total_estimated_usd: 0.04,
            avg_estimated_usd: 0.02,
            first_recorded_at: '2026-05-23T00:00:00.000Z',
            last_recorded_at: '2026-05-23T00:05:00.000Z'
          }
        ],
        rowCount: 1
      });

    const repo = new PostgresRepo({ query });
    const snapshot = await repo.getCostDrilldownSnapshot(168, {
      packId: 'pack-1',
      promptVersion: 'summary-by-level@1.0.0',
      model: 'local-rule-based',
      stage: 'summarization',
      limit: 25
    });

    expect(snapshot.windowHours).toBe(168);
    expect(snapshot.totalEvents).toBe(2);
    expect(snapshot.totalEstimatedTokens).toBe(2400);
    expect(snapshot.avgLatencyMs).toBe(3000);
    expect(snapshot.rows[0]).toMatchObject({
      packId: 'pack-1',
      promptVersion: 'summary-by-level@1.0.0',
      model: 'local-rule-based',
      stage: 'summarization',
      events: 2,
      avgTokens: 1200,
      firstRecordedAt: '2026-05-23T00:00:00.000Z',
      lastRecordedAt: '2026-05-23T00:05:00.000Z'
    });
    expect(String(query.mock.calls[0]?.[0])).toContain('pack_id = $2');
    expect(String(query.mock.calls[0]?.[0])).toContain('prompt_version = $3');
    expect(String(query.mock.calls[0]?.[0])).toContain('model = $4');
    expect(String(query.mock.calls[0]?.[0])).toContain('stage = $5');
    expect(String(query.mock.calls[1]?.[0])).toContain('GROUP BY pack_id, prompt_version, model, stage');
    expect(String(query.mock.calls[1]?.[0])).toContain('LIMIT $6');
    expect(query.mock.calls[1]?.[1]).toEqual([
      168,
      'pack-1',
      'summary-by-level@1.0.0',
      'local-rule-based',
      'summarization',
      25
    ]);
  });

  it('persists stage cost telemetry', async () => {
    const query = vi.fn<PgClient['query']>().mockResolvedValue({ rows: [], rowCount: 1 });
    const repo = new PostgresRepo({ query });

    await repo.recordStageCost({
      jobId: 'job-1',
      packId: 'pack-1',
      stage: 'summarization',
      estimatedTokens: 1800,
      latencyMs: 2500,
      estimatedCostUsd: 0.021,
      promptVersion: 'summary-by-level@1.0.0',
      model: 'local-rule-based'
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0]?.[0])).toContain('INSERT INTO stage_cost_events');
  });

  it('persists active recall misconception checks and glossary artifacts', async () => {
    const query = vi.fn<PgClient['query']>().mockResolvedValue({ rows: [], rowCount: 1 });
    const repo = new PostgresRepo({ query });

    await repo.saveActiveRecall(
      'pack-1',
      [{ question: 'q', answer: 'a', citation: 'c', promptVersion: 'active-recall@1.0.0', model: 'm' }],
      [
        {
          question: 'quiz',
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
          misconceptions: ['a is cited', 'b is wrong', 'c is wrong', 'd is wrong'],
          explanation: 'because',
          citation: 'c',
          promptVersion: 'active-recall@1.0.0',
          model: 'm'
        }
      ]
    );
    await repo.saveGlossary('pack-1', [
      {
        term: 'Computation',
        definition: 'A source-grounded definition.',
        citation: 'c',
        promptVersion: 'glossary@1.0.0',
        model: 'm'
      }
    ]);

    expect(String(query.mock.calls[4]?.[0])).toContain('misconceptions');
    expect(query.mock.calls[4]?.[1]).toContain(JSON.stringify(['a is cited', 'b is wrong', 'c is wrong', 'd is wrong']));
    expect(String(query.mock.calls[8]?.[0])).toContain('INSERT INTO glossary_artifacts');
  });

  it('lists recent packs for a session with readiness counts', async () => {
    const query = vi.fn<PgClient['query']>().mockResolvedValueOnce({
      rows: [
        {
          id: 'pack-1',
          input: 'Ada Lovelace',
          source_revision_id: 'rev-1',
          created_at: '2026-01-01T00:00:00.000Z',
          job_id: 'job-1',
          status: 'completed',
          stage: 'done',
          progress: 100,
          degradation_state: 'none',
          degradation_reason: null,
          updated_at: '2026-01-01T00:01:00.000Z',
          summary_count: 3,
          graph_node_count: 1,
          graph_edge_count: 0,
          timeline_count: 1,
          glossary_count: 8,
          flashcard_count: 15,
          quiz_count: 10
        }
      ],
      rowCount: 1
    });
    const repo = new PostgresRepo({ query });

    const history = await repo.listRecentPacksForSession('s1', 5);

    expect(history[0]).toMatchObject({
      id: 'pack-1',
      input: 'Ada Lovelace',
      sourceRevisionId: 'rev-1',
      readiness: {
        status: 'full',
        missingArtifacts: [],
        canResume: false
      }
    });
    expect(String(query.mock.calls[0]?.[0])).toContain('WITH latest_jobs');
    expect(String(query.mock.calls[0]?.[0])).toContain('bounded_latest_jobs');
    expect(String(query.mock.calls[0]?.[0])).toContain('FROM bounded_latest_jobs lj');
  });

  it('saves and lists cross-device user library packs', async () => {
    const query = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            total_count: 1,
            readiness_full: 1,
            readiness_partial: 0,
            progress_due: 1,
            progress_reviewed: 0,
            progress_not_started: 1,
            tags: [],
            collections: []
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'pack-1',
            input: 'Ada Lovelace',
            source_revision_id: 'rev-1',
            created_at: '2026-01-01T00:00:00.000Z',
            saved_at: '2026-01-01T00:02:00.000Z',
            tags: [],
            collection: null,
            job_id: 'job-1',
            status: 'completed',
            stage: 'done',
            progress: 100,
            degradation_state: 'none',
            degradation_reason: null,
            updated_at: '2026-01-01T00:01:00.000Z',
            summary_count: 3,
            graph_node_count: 1,
            graph_edge_count: 0,
            timeline_count: 1,
            glossary_count: 8,
            flashcard_count: 15,
            quiz_count: 10,
            reviewed_cards: 0,
            due_cards: 15,
            mastery_score: 0,
            next_due_at: null
          }
        ],
        rowCount: 1
      });
    const repo = new PostgresRepo({ query });

    await repo.savePackForUser('user-shared', 'pack-1');
    const library = await repo.listSavedPacksForUser('user-shared', 5);

    expect(String(query.mock.calls[0]?.[0])).toContain('INSERT INTO saved_packs');
    expect(query.mock.calls[0]?.[1]).toEqual(['user-shared', 'pack-1']);
    expect(String(query.mock.calls[1]?.[0])).toContain('WITH candidate_saved');
    expect(String(query.mock.calls[1]?.[0])).toContain('FROM saved_packs saved');
    expect(String(query.mock.calls[1]?.[0])).toContain('COUNT(*)::int AS total_count');
    expect(query.mock.calls[1]?.[1]).toEqual(['user-shared', null]);
    expect(String(query.mock.calls[2]?.[0])).toContain('LIMIT $8');
    expect(query.mock.calls[2]?.[1]).toEqual(['user-shared', null, 'all', 'all', 'saved_desc', null, null, 5]);
    expect(library[0]).toMatchObject({
      id: 'pack-1',
      input: 'Ada Lovelace',
      readiness: {
        status: 'full',
        missingArtifacts: [],
        canResume: false
      }
    });
  });

  it('searches, filters, sorts, and facets saved library rows', async () => {
    const query = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({
        rows: [
          {
            total_count: 2,
            readiness_full: 1,
            readiness_partial: 1,
            progress_due: 1,
            progress_reviewed: 1,
            progress_not_started: 1,
            tags: [
              { tag: 'history', count: 1 },
              { tag: 'math', count: 1 }
            ],
            collections: [{ collection: 'STEM', count: 1 }]
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            input: 'Ada Complete',
            source_revision_id: 'rev-ada-complete',
            created_at: '2026-01-01T00:00:00.000Z',
            saved_at: '2026-01-03T00:00:00.000Z',
            tags: ['math', 'history'],
            collection: 'STEM',
            job_id: 'job-ada',
            status: 'completed',
            stage: 'done',
            progress: 100,
            degradation_state: 'none',
            degradation_reason: null,
            updated_at: '2026-01-03T00:00:00.000Z',
            summary_count: 1,
            graph_node_count: 1,
            graph_edge_count: 0,
            timeline_count: 0,
            glossary_count: 1,
            flashcard_count: 2,
            quiz_count: 1,
            reviewed_cards: 1,
            due_cards: 1,
            mastery_score: 0.375,
            next_due_at: '2099-01-03T00:00:00.000Z'
          }
        ],
        rowCount: 1
      });
    const repo = new PostgresRepo({ query });

    const library = await repo.listSavedLibraryForUser('user-library', {
      limit: 8,
      search: 'ada',
      readiness: 'full',
      progress: 'due',
      tag: 'math',
      collection: 'STEM',
      sort: 'title_asc'
    });

    expect(String(query.mock.calls[0]?.[0])).toContain('WITH candidate_saved');
    expect(String(query.mock.calls[0]?.[0])).toContain('LOWER(sp.input) LIKE $2');
    expect(String(query.mock.calls[0]?.[0])).toContain('COUNT(*)::int AS total_count');
    expect(query.mock.calls[0]?.[1]).toEqual(['user-library', '%ada%']);
    expect(String(query.mock.calls[1]?.[0])).toContain('DISTINCT ON (fr.pack_id, fr.card_index)');
    expect(String(query.mock.calls[1]?.[0])).toContain('LOWER(COALESCE(saved.collection');
    expect(String(query.mock.calls[1]?.[0])).toContain('$6 = ANY(tags)');
    expect(String(query.mock.calls[1]?.[0])).toContain('LIMIT $8');
    expect(query.mock.calls[1]?.[1]).toEqual(['user-library', '%ada%', 'full', 'due', 'title_asc', 'math', 'STEM', 8]);
    expect(library.facets).toEqual({
      total: 2,
      readiness: { full: 1, partial: 1 },
      progress: { due: 1, reviewed: 1, notStarted: 1 },
      tags: [
        { tag: 'history', count: 1 },
        { tag: 'math', count: 1 }
      ],
      collections: [{ collection: 'STEM', count: 1 }]
    });
    expect(library.items).toHaveLength(1);
    expect(library.items[0]).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      input: 'Ada Complete',
      savedAt: '2026-01-03T00:00:00.000Z',
      progress: { totalCards: 2, reviewedCards: 1, dueCards: 1 },
      organization: { tags: ['math', 'history'], collection: 'STEM' }
    });
  });

  it('updates saved-pack tags and collection metadata', async () => {
    const query = vi.fn<PgClient['query']>().mockResolvedValueOnce({
      rows: [{ tags: ['math', 'history'], collection: 'STEM' }],
      rowCount: 1
    });
    const repo = new PostgresRepo({ query });

    const organization = await repo.updateSavedPackOrganization('user-library', '11111111-1111-4111-8111-111111111111', {
      tags: [' Math ', 'history', 'math'],
      collection: ' STEM '
    });

    expect(String(query.mock.calls[0]?.[0])).toContain('UPDATE saved_packs');
    expect(String(query.mock.calls[0]?.[0])).toContain('SET tags = $3::text[]');
    expect(query.mock.calls[0]?.[1]).toEqual(['user-library', '11111111-1111-4111-8111-111111111111', ['math', 'history'], 'STEM']);
    expect(organization).toEqual({ tags: ['math', 'history'], collection: 'STEM' });
  });

  it('queries saved-pack version history by matching saved pack input', async () => {
    const query = vi.fn<PgClient['query']>().mockResolvedValueOnce({
      rows: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          input: 'Ada Lovelace',
          source_revision_id: 'rev-new',
          created_at: '2026-01-03T00:00:00.000Z',
          saved_at: '2026-01-04T00:00:00.000Z',
          job_id: null,
          status: null,
          stage: null,
          progress: null,
          degradation_state: null,
          degradation_reason: null,
          updated_at: null,
          summary_count: 1,
          graph_node_count: 1,
          graph_edge_count: 0,
          timeline_count: 0,
          glossary_count: 1,
          flashcard_count: 3,
          quiz_count: 1
        },
        {
          id: '11111111-1111-4111-8111-111111111111',
          input: 'Ada Lovelace',
          source_revision_id: 'rev-old',
          created_at: '2026-01-01T00:00:00.000Z',
          saved_at: '2026-01-02T00:00:00.000Z',
          job_id: null,
          status: null,
          stage: null,
          progress: null,
          degradation_state: null,
          degradation_reason: null,
          updated_at: null,
          summary_count: 1,
          graph_node_count: 1,
          graph_edge_count: 0,
          timeline_count: 0,
          glossary_count: 1,
          flashcard_count: 1,
          quiz_count: 1
        }
      ],
      rowCount: 2
    });
    const repo = new PostgresRepo({ query });

    const history = await repo.getSavedPackVersionHistory('user-library', '22222222-2222-4222-8222-222222222222', 8);

    expect(String(query.mock.calls[0]?.[0])).toContain('WITH current_pack AS');
    expect(String(query.mock.calls[0]?.[0])).toContain('LOWER(TRIM(sp.input)) = LOWER(TRIM(current.input))');
    expect(String(query.mock.calls[0]?.[0])).toContain('COUNT(DISTINCT fa.id)::int AS flashcard_count');
    expect(query.mock.calls[0]?.[1]).toEqual(['user-library', '22222222-2222-4222-8222-222222222222', 8]);
    expect(history?.versions.map((item) => item.id)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111'
    ]);
    expect(history?.compare).toMatchObject({
      baselinePackId: '11111111-1111-4111-8111-111111111111',
      baselineSourceRevisionId: 'rev-old',
      sourceRevisionChanged: true,
      artifactDeltas: { flashcards: 2, quizQuestions: 0 }
    });
  });

  it('does not truncate saved library candidates before filters and sorting', async () => {
    const query = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({
        rows: [
          {
            total_count: 51,
            readiness_full: 1,
            readiness_partial: 50,
            progress_due: 1,
            progress_reviewed: 1,
            progress_not_started: 50,
            tags: [],
            collections: []
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            input: 'Old Due Pack',
            source_revision_id: 'rev-old-due',
            created_at: '2025-12-01T00:00:00.000Z',
            saved_at: '2025-12-01T00:00:00.000Z',
            tags: [],
            collection: null,
            job_id: 'job-old-due',
            status: 'completed',
            stage: 'done',
            progress: 100,
            degradation_state: 'none',
            degradation_reason: null,
            updated_at: '2025-12-01T00:00:00.000Z',
            summary_count: 1,
            graph_node_count: 1,
            graph_edge_count: 0,
            timeline_count: 0,
            glossary_count: 1,
            flashcard_count: 2,
            quiz_count: 1,
            reviewed_cards: 1,
            due_cards: 2,
            mastery_score: 0.2,
            next_due_at: '2025-12-02T00:00:00.000Z'
          }
        ],
        rowCount: 1
      });
    const repo = new PostgresRepo({ query });

    const library = await repo.listSavedLibraryForUser('user-library', {
      limit: 8,
      readiness: 'full',
      progress: 'due',
      sort: 'saved_asc'
    });
    const itemSql = String(query.mock.calls[1]?.[0]);

    expect(String(query.mock.calls[0]?.[0])).not.toContain('ORDER BY saved.saved_at DESC');
    expect(itemSql).not.toContain('ORDER BY saved.saved_at DESC');
    expect(itemSql).toContain('WHERE ($3::text =');
    expect(itemSql).toContain('LIMIT $8');
    expect(query.mock.calls[1]?.[1]).toEqual(['user-library', null, 'full', 'due', 'saved_asc', null, null, 8]);
    expect(library.facets).toMatchObject({
      total: 51,
      readiness: { full: 1, partial: 50 },
      progress: { due: 1, reviewed: 1, notStarted: 50 },
      tags: [],
      collections: []
    });
    expect(library.items).toHaveLength(1);
    expect(library.items[0]).toMatchObject({
      id: '33333333-3333-4333-8333-333333333333',
      input: 'Old Due Pack',
      progress: { totalCards: 2, reviewedCards: 1, dueCards: 2 }
    });
  });

  it('persists user profiles and share links', async () => {
    const shareId = '11111111-1111-4111-8111-111111111111';
    const tokenHash = createShareTokenHash(shareId, 'test-secret');
    const query = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: 'user-1',
            display_name: 'Tyler',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z'
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: 'user-1',
            display_name: 'Tyler',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z'
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [{ exists: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            share_id: shareId,
            pack_id: 'pack-1',
            owner_user_id: 'user-1',
            role: 'viewer',
            created_at: '2026-01-01T00:00:00.000Z',
            token_hash: tokenHash,
            token_version: activeShareTokenVersion,
            expires_at: '2026-01-08T00:00:00.000Z',
            revoked_at: null
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            share_id: shareId,
            pack_id: 'pack-1',
            owner_user_id: 'user-1',
            role: 'viewer',
            created_at: '2026-01-01T00:00:00.000Z',
            token_hash: tokenHash,
            token_version: activeShareTokenVersion,
            expires_at: '2026-01-08T00:00:00.000Z',
            revoked_at: null
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            share_id: shareId,
            pack_id: 'pack-1',
            owner_user_id: 'user-1',
            role: 'viewer',
            created_at: '2026-01-01T00:00:00.000Z',
            token_hash: tokenHash,
            token_version: activeShareTokenVersion,
            expires_at: '2026-01-08T00:00:00.000Z',
            revoked_at: null
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            share_id: shareId,
            pack_id: 'pack-1',
            owner_user_id: 'user-1',
            role: 'viewer',
            created_at: '2026-01-01T00:00:00.000Z',
            token_hash: tokenHash,
            token_version: activeShareTokenVersion,
            expires_at: '2026-01-08T00:00:00.000Z',
            revoked_at: '2026-01-02T00:00:00.000Z'
          }
        ],
        rowCount: 1
      });
    const repo = new PostgresRepo({ query });

    const profile = await repo.upsertUserProfile('user-1', 'Tyler');
    const loadedProfile = await repo.getUserProfile('user-1');
    const share = await repo.createShareLink('user-1', 'pack-1', 'viewer', {
      shareId,
      tokenHash,
      tokenVersion: activeShareTokenVersion,
      expiresAt: '2026-01-08T00:00:00.000Z'
    });
    const loadedShare = await repo.getShareLink(shareId, tokenHash);
    const listedShares = await repo.listShareLinksForOwner('user-1', 'pack-1', 10);
    const revokedShare = await repo.revokeShareLink('user-1', 'pack-1', shareId, tokenHash);

    expect(profile.displayName).toBe('Tyler');
    expect(loadedProfile?.userId).toBe('user-1');
    expect(share).toMatchObject({ packId: 'pack-1', ownerUserId: 'user-1', role: 'viewer' });
    expect(loadedShare?.shareId).toBe(shareId);
    expect(loadedShare?.tokenHash).toBe(tokenHash);
    expect(listedShares).toEqual([expect.objectContaining({ shareId, tokenHash })]);
    expect(revokedShare?.shareId).toBe(shareId);
    expect(revokedShare?.revokedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(String(query.mock.calls[0]?.[0])).toContain('INSERT INTO user_profiles');
    expect(String(query.mock.calls[3]?.[0])).toContain('INSERT INTO share_links');
    expect(String(query.mock.calls[3]?.[0])).toContain('token_hash');
    expect(query.mock.calls[3]?.[1]).toEqual([shareId, 'pack-1', 'user-1', 'viewer', tokenHash, activeShareTokenVersion, '2026-01-08T00:00:00.000Z']);
    expect(String(query.mock.calls[4]?.[0])).toContain('token_hash = $2');
    expect(String(query.mock.calls[4]?.[0])).toContain('revoked_at IS NULL');
    expect(query.mock.calls[4]?.[1]).toEqual([shareId, tokenHash]);
    expect(String(query.mock.calls[5]?.[0])).toContain('ORDER BY created_at DESC');
    expect(String(query.mock.calls[5]?.[0])).toContain('revoked_at IS NULL');
    expect(query.mock.calls[5]?.[1]).toEqual(['user-1', 'pack-1', 10]);
    expect(String(query.mock.calls[6]?.[0])).toContain('UPDATE share_links');
    expect(String(query.mock.calls[6]?.[0])).toContain('revoked_at = COALESCE');
    expect(query.mock.calls[6]?.[1]).toEqual(['user-1', 'pack-1', shareId, tokenHash]);
  });

  it('exports user-owned profile, library, share, learning, quiz, and goal rows', async () => {
    const query = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: 'user-1',
            display_name: 'Tyler',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-02T00:00:00.000Z'
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [{ pack_id: 'pack-1', saved_at: '2026-01-03T00:00:00.000Z', tags: ['math'], collection: 'STEM' }],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            share_id: 'share-1',
            pack_id: 'pack-1',
            owner_user_id: 'user-1',
            role: 'viewer',
            created_at: '2026-01-04T00:00:00.000Z',
            token_hash: 'sha256:share',
            token_version: activeShareTokenVersion,
            expires_at: '2026-01-08T00:00:00.000Z',
            revoked_at: '2026-01-05T00:00:00.000Z'
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'review-1',
            user_id: 'user-1',
            pack_id: 'pack-1',
            card_index: 0,
            rating: 'good',
            reviewed_at: '2026-01-06T00:00:00.000Z',
            next_due_at: '2026-01-09T00:00:00.000Z'
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'session-1',
            user_id: 'user-1',
            pack_id: 'pack-1',
            status: 'completed',
            started_at: '2026-01-06T00:00:00.000Z',
            completed_at: '2026-01-07T00:00:00.000Z',
            baseline_due_cards: 1,
            baseline_mastery_score: 0,
            reviewed_count: 1,
            outcome: { completedCards: 1, remainingCards: 0, masteryScore: 1, masteryDelta: 1 }
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'attempt-1',
            user_id: 'user-1',
            pack_id: 'pack-1',
            attempt_number: 1,
            selected_indices: [0],
            total_questions: 1,
            correct_answers: 1,
            accuracy: 1,
            previous_accuracy: null,
            accuracy_delta: 0,
            card_mastery_score: 1,
            mastery_score: 1,
            mastery_delta: 0,
            submitted_at: '2026-01-08T00:00:00.000Z'
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: 'user-1',
            daily_target_reviews: 5,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-08T00:00:00.000Z'
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'feedback-1',
            user_id: 'user-1',
            pack_id: 'pack-1',
            artifact_type: 'quiz',
            artifact_id: 'question-0',
            rating: 2,
            signal: 'incorrect',
            comment: 'Answer key looked wrong.',
            prompt_version: 'active-recall@1.0.0',
            model: 'local-rule-based',
            created_at: '2026-01-09T00:00:00.000Z'
          }
        ],
        rowCount: 1
      });
    const repo = new PostgresRepo({ query });

    const exported = await repo.exportUserData('user-1');

    expect(exported.profile).toMatchObject({ displayName: 'Tyler' });
    expect(exported.library).toEqual([
      { packId: 'pack-1', savedAt: '2026-01-03T00:00:00.000Z', organization: { tags: ['math'], collection: 'STEM' } }
    ]);
    expect(exported.shares).toEqual([expect.objectContaining({ shareId: 'share-1', revokedAt: '2026-01-05T00:00:00.000Z' })]);
    expect(exported.flashcardReviews).toEqual([expect.objectContaining({ id: 'review-1', rating: 'good' })]);
    expect(exported.learningSessions).toEqual([expect.objectContaining({ id: 'session-1', status: 'completed' })]);
    expect(exported.quizAttempts).toEqual([expect.objectContaining({ id: 'attempt-1', attemptNumber: 1 })]);
    expect(exported.studyGoal).toMatchObject({ dailyTargetReviews: 5 });
    expect(exported.generationFeedback).toEqual([
      expect.objectContaining({ id: 'feedback-1', artifactType: 'quiz', trustedArtifact: false, evalCandidate: true })
    ]);
    expect(query).toHaveBeenCalledTimes(8);
    expect(String(query.mock.calls[1]?.[0])).toContain('FROM saved_packs');
    expect(String(query.mock.calls[2]?.[0])).toContain('FROM share_links');
    expect(String(query.mock.calls[4]?.[0])).toContain('FROM learning_sessions');
    expect(String(query.mock.calls[7]?.[0])).toContain('FROM generation_feedback');
    expect(query.mock.calls.every((call) => call[1]?.[0] === 'user-1')).toBe(true);
  });

  it('deletes user-owned data in one transaction and reports counts', async () => {
    const transactionQuery = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 3 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 4 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const query = vi.fn<PgClient['query']>();
    const release = vi.fn();
    const connect = vi.fn(async () => ({ query: transactionQuery, release }));
    const repo = new PostgresRepo({ query, connect });

    const deleted = await repo.deleteUserData('user-1');

    expect(deleted.deleted).toEqual({
      profile: true,
      library: 2,
      shares: 1,
      flashcardReviews: 3,
      learningSessions: 1,
      quizAttempts: 4,
      studyGoals: 1,
      generationFeedback: 2
    });
    expect(query).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(transactionQuery.mock.calls.map((call) => String(call[0]).trim().split(/\s+/).slice(0, 3).join(' '))).toEqual([
      'BEGIN',
      'DELETE FROM saved_packs',
      'DELETE FROM share_links',
      'DELETE FROM flashcard_reviews',
      'DELETE FROM learning_sessions',
      'DELETE FROM quiz_attempts',
      'DELETE FROM study_goals',
      'DELETE FROM generation_feedback',
      'DELETE FROM user_profiles',
      'COMMIT'
    ]);
    expect(transactionQuery.mock.calls.slice(1, 9).every((call) => call[1]?.[0] === 'user-1')).toBe(true);
  });

  it('persists and summarizes untrusted generation feedback as eval candidates', async () => {
    const query = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'feedback-1',
            user_id: 'user-1',
            pack_id: 'pack-1',
            artifact_type: 'quiz',
            artifact_id: 'question-0',
            rating: 2,
            signal: 'incorrect',
            comment: 'Answer key looked wrong.',
            prompt_version: 'active-recall@1.0.0',
            model: 'local-rule-based',
            created_at: '2026-01-09T00:00:00.000Z'
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            total_feedback: 1,
            negative_feedback: 1,
            average_rating: 2,
            latest_feedback_at: '2026-01-09T00:00:00.000Z'
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            artifact_type: 'quiz',
            total_feedback: 1,
            negative_feedback: 1,
            average_rating: 2,
            latest_feedback_at: '2026-01-09T00:00:00.000Z'
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [{ artifact_type: 'quiz', signal: 'incorrect', count: 1 }],
        rowCount: 1
      });
    const repo = new PostgresRepo({ query });

    const feedback = await repo.recordGenerationFeedback({
      userId: 'user-1',
      packId: 'pack-1',
      artifactType: 'quiz',
      artifactId: 'question-0',
      rating: 2,
      signal: 'incorrect',
      comment: 'Answer key looked wrong.',
      promptVersion: 'active-recall@1.0.0',
      model: 'local-rule-based'
    });
    const summary = await repo.getGenerationFeedbackSummary();

    expect(feedback).toMatchObject({ id: 'feedback-1', trustedArtifact: false, evalCandidate: true });
    expect(summary).toMatchObject({
      dataset: 'user_feedback',
      trustedArtifact: false,
      contaminatesGoldenSet: false,
      requiresHumanReview: true,
      totalFeedback: 1,
      negativeFeedback: 1,
      averageRating: 2
    });
    expect(summary.byArtifact).toEqual([
      expect.objectContaining({ artifactType: 'quiz', signals: [{ signal: 'incorrect', count: 1 }] })
    ]);
    expect(String(query.mock.calls[0]?.[0])).toContain('INSERT INTO generation_feedback');
    expect(String(query.mock.calls[0]?.[0])).toContain('FALSE');
    expect(String(query.mock.calls[0]?.[0])).toContain('TRUE');
    expect(String(query.mock.calls[1]?.[0])).toContain('FROM generation_feedback');
  });

  it('persists flashcard reviews and derives learning progress', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const query = vi
        .fn<PgClient['query']>()
        .mockResolvedValueOnce({ rows: [{ count: 2 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'review-1',
              user_id: 'user-1',
              pack_id: 'pack-1',
              card_index: 0,
              rating: 'good',
              reviewed_at: '2026-01-01T00:00:00.000Z',
              next_due_at: '2026-01-04T00:00:00.000Z'
            }
          ],
          rowCount: 1
        })
        .mockResolvedValueOnce({ rows: [{ count: 2 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'review-1',
              user_id: 'user-1',
              pack_id: 'pack-1',
              card_index: 0,
              rating: 'good',
              reviewed_at: '2026-01-01T00:00:00.000Z',
              next_due_at: '2999-01-04T00:00:00.000Z'
            }
          ],
          rowCount: 1
        });
      const repo = new PostgresRepo({ query });

      const review = await repo.recordFlashcardReview('user-1', 'pack-1', 0, 'good');
      const progress = await repo.getLearningProgress('user-1', 'pack-1');

      expect(review).toMatchObject({ userId: 'user-1', packId: 'pack-1', cardIndex: 0, rating: 'good' });
      expect(progress).toMatchObject({
        userId: 'user-1',
        packId: 'pack-1',
        totalCards: 2,
        reviewedCards: 1,
        dueCards: 1
      });
      expect(progress?.cards[0]).toMatchObject({ cardIndex: 0, reviewed: true, due: false });
      expect(String(query.mock.calls[1]?.[0])).toContain('INSERT INTO flashcard_reviews');
      expect(query.mock.calls[1]?.[1]?.slice(5)).toEqual(['2026-01-01T00:00:00.000Z', '2026-01-04T00:00:00.000Z']);
      expect(String(query.mock.calls[3]?.[0])).toContain('SELECT DISTINCT ON (card_index)');
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists learning session timestamps, reviewed counts, and outcomes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const query = vi
        .fn<PgClient['query']>()
        .mockResolvedValueOnce({ rows: [{ exists: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'session-1',
              user_id: 'user-1',
              pack_id: 'pack-1',
              status: 'active',
              started_at: '2026-01-01T00:00:00.000Z',
              completed_at: null,
              baseline_due_cards: 2,
              baseline_mastery_score: 0,
              reviewed_count: 0,
              outcome: { completedCards: 0, remainingCards: 2, masteryScore: 0, masteryDelta: 0 }
            }
          ],
          rowCount: 1
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'session-1',
              user_id: 'user-1',
              pack_id: 'pack-1',
              status: 'completed',
              started_at: '2026-01-01T00:00:00.000Z',
              completed_at: '2026-01-01T00:00:00.000Z',
              baseline_due_cards: 2,
              baseline_mastery_score: 0,
              reviewed_count: 2,
              outcome: { completedCards: 2, remainingCards: 0, masteryScore: 0.875, masteryDelta: 0.875 }
            }
          ],
          rowCount: 1
        });
      const repo = new PostgresRepo({ query });

      const created = await repo.createLearningSession('user-1', 'pack-1', 2, 0, {
        status: 'active',
        reviewedCount: 0,
        outcome: { completedCards: 0, remainingCards: 2, masteryScore: 0, masteryDelta: 0 }
      });
      const completed = await repo.updateLearningSessionProgress('user-1', 'pack-1', 'session-1', {
        status: 'completed',
        reviewedCount: 2,
        outcome: { completedCards: 2, remainingCards: 0, masteryScore: 0.875, masteryDelta: 0.875 }
      });

      expect(created).toMatchObject({
        id: 'session-1',
        status: 'active',
        startedAt: '2026-01-01T00:00:00.000Z',
        reviewedCount: 0
      });
      expect(completed).toMatchObject({
        id: 'session-1',
        status: 'completed',
        completedAt: '2026-01-01T00:00:00.000Z',
        reviewedCount: 2,
        outcome: { completedCards: 2, remainingCards: 0, masteryScore: 0.875, masteryDelta: 0.875 }
      });
      expect(String(query.mock.calls[1]?.[0])).toContain('INSERT INTO learning_sessions');
      expect(query.mock.calls[1]?.[1]?.slice(3, 10)).toEqual([
        'active',
        '2026-01-01T00:00:00.000Z',
        null,
        2,
        0,
        0,
        JSON.stringify({ completedCards: 0, remainingCards: 2, masteryScore: 0, masteryDelta: 0 })
      ]);
      expect(String(query.mock.calls[2]?.[0])).toContain('UPDATE learning_sessions');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns per-user learning analytics from saved learning data', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-03T09:00:00.000Z'));
    try {
      const query = vi
        .fn<PgClient['query']>()
        .mockResolvedValueOnce({
          rows: [{ pack_id: 'pack-1', total_cards: 2 }],
          rowCount: 1
        })
        .mockResolvedValueOnce({
          rows: [
            {
              pack_id: 'pack-1',
              card_index: 0,
              rating: 'good',
              reviewed_at: '2026-01-01T09:00:00.000Z',
              next_due_at: '2026-01-04T09:00:00.000Z'
            }
          ],
          rowCount: 1
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'attempt-1',
              user_id: 'user-1',
              pack_id: 'pack-1',
              attempt_number: 1,
              selected_indices: [0, 1],
              total_questions: 2,
              correct_answers: 2,
              accuracy: 1,
              previous_accuracy: null,
              accuracy_delta: 0,
              card_mastery_score: 0.375,
              mastery_score: 0.6875,
              mastery_delta: 0.6875,
              submitted_at: '2026-01-02T09:00:00.000Z'
            }
          ],
          rowCount: 1
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'session-1',
              user_id: 'user-1',
              pack_id: 'pack-1',
              status: 'completed',
              started_at: '2026-01-01T08:00:00.000Z',
              completed_at: '2026-01-01T09:00:00.000Z',
              baseline_due_cards: 2,
              baseline_mastery_score: 0,
              reviewed_count: 1,
              outcome: { completedCards: 1, remainingCards: 1, masteryScore: 0.375, masteryDelta: 0.375 }
            }
          ],
          rowCount: 1
        })
        .mockResolvedValueOnce({
          rows: [
            {
              user_id: 'user-1',
              daily_target_reviews: 3,
              created_at: '2026-01-01T08:00:00.000Z',
              updated_at: '2026-01-01T08:00:00.000Z'
            }
          ],
          rowCount: 1
        });
      const repo = new PostgresRepo({ query });

      const analytics = await repo.getLearningAnalytics('user-1');

      expect(analytics).toMatchObject({
        userId: 'user-1',
        totalCards: 2,
        reviewedCards: 1,
        dueCards: 1,
        streak: { currentDays: 2, longestDays: 2 },
        goal: {
          dailyTargetReviews: 3,
          reviewsToday: 0,
          remainingToday: 3,
          targetMet: false
        },
        retention: {
          reviewedCards: 1,
          retainedCards: 1,
          dueReviewedCards: 0,
          retentionRate: 1
        },
        accuracy: {
          attempts: 1,
          averageAccuracy: 1,
          latestAccuracy: 1
        }
      });
      expect(analytics.mastery.trend.map((point) => point.source)).toEqual(['session', 'quiz']);
      expect(analytics.packs[0]).toMatchObject({ packId: 'pack-1', masteryScore: 0.375, quizAttempts: 1 });
      expect(String(query.mock.calls[0]?.[0])).toContain('FROM saved_packs saved');
      expect(String(query.mock.calls[1]?.[0])).toContain('FROM flashcard_reviews fr');
      expect(String(query.mock.calls[2]?.[0])).toContain('FROM quiz_attempts qa');
      expect(String(query.mock.calls[3]?.[0])).toContain('FROM learning_sessions ls');
      expect(String(query.mock.calls[4]?.[0])).toContain('FROM study_goals');
      expect(query.mock.calls.map((call) => call[1])).toEqual([['user-1'], ['user-1'], ['user-1'], ['user-1'], ['user-1']]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('upserts and reads study goals', async () => {
    const query = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: 'user-goal',
            daily_target_reviews: 5,
            created_at: '2026-01-01T08:00:00.000Z',
            updated_at: '2026-01-02T08:00:00.000Z'
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: 'user-goal',
            daily_target_reviews: 5,
            created_at: '2026-01-01T08:00:00.000Z',
            updated_at: '2026-01-02T08:00:00.000Z'
          }
        ],
        rowCount: 1
      });
    const repo = new PostgresRepo({ query });

    await expect(repo.upsertStudyGoal('user-goal', 5)).resolves.toMatchObject({
      userId: 'user-goal',
      dailyTargetReviews: 5
    });
    await expect(repo.getStudyGoal('user-goal')).resolves.toMatchObject({
      userId: 'user-goal',
      dailyTargetReviews: 5
    });
    expect(String(query.mock.calls[0]?.[0])).toContain('INSERT INTO study_goals');
    expect(String(query.mock.calls[1]?.[0])).toContain('FROM study_goals');
  });
});
