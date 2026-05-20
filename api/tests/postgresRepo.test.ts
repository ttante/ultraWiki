import { describe, expect, it, vi } from 'vitest';
import { PostgresRepo, type PgClient } from '../src/repo/postgres.js';

describe('PostgresRepo outcomes persistence', () => {
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
});
