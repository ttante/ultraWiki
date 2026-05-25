import { describe, expect, it, vi } from 'vitest';
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
        rows: [
          {
            id: 'attempt-1',
            pack_id: 'pack-1',
            total_questions: 2,
            correct_answers: 1,
            accuracy: 0.5,
            submitted_at: '2026-01-01T00:00:00.000Z'
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    const repo = new PostgresRepo({ query });
    const attempt = await repo.saveQuizAttempt('pack-1', [0, 1]);

    expect(attempt?.id).toBe('attempt-1');
    expect(attempt?.correctAnswers).toBe(1);
    expect(attempt?.accuracy).toBe(0.5);
    expect(query).toHaveBeenCalledTimes(4);
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
        rows: [{ attempts: 4, avg_accuracy: 0.75 }],
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
    expect(snapshot.learning.avgAccuracy).toBe(0.75);
    expect(snapshot.slo.p95TimeToFirstArtifactMs).toBe(18000);
    expect(snapshot.slo.p95FullPackCompletionMs).toBe(42000);
    expect(snapshot.slo.jobSuccessRate).toBe(0.75);
    expect(snapshot.slo.citationCoverageRate).toBe(0.9);
    expect(snapshot.cost.totalEstimatedUsd).toBe(0.09);
    expect(snapshot.cost.avgEstimatedUsdPerPack).toBeCloseTo(0.03, 6);
    expect(snapshot.cost.byStage[0].stage).toBe('summarization');
    expect(snapshot.cost.byStage[0].events).toBe(3);
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
  });

  it('saves and lists cross-device user library packs', async () => {
    const query = vi
      .fn<PgClient['query']>()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'pack-1',
            input: 'Ada Lovelace',
            source_revision_id: 'rev-1',
            created_at: '2026-01-01T00:00:00.000Z',
            saved_at: '2026-01-01T00:02:00.000Z',
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

    await repo.savePackForUser('user-shared', 'pack-1');
    const library = await repo.listSavedPacksForUser('user-shared', 5);

    expect(String(query.mock.calls[0]?.[0])).toContain('INSERT INTO saved_packs');
    expect(query.mock.calls[0]?.[1]).toEqual(['user-shared', 'pack-1']);
    expect(String(query.mock.calls[1]?.[0])).toContain('FROM saved_packs saved');
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
});
