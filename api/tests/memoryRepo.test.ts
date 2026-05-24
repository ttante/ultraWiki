import { describe, expect, it } from 'vitest';
import { buildArtifactCacheKey, buildSourceCacheKey } from '../src/domain/cachePolicy.js';
import { MemoryRepo } from '../src/repo/memoryRepo.js';

describe('MemoryRepo', () => {
  it('reuses idempotency keys within ttl', async () => {
    const repo = new MemoryRepo();
    const first = await repo.createOrReuseByIdempotency('k1', 3600);
    const second = await repo.createOrReuseByIdempotency('k1', 3600);

    expect(second.reused).toBe(true);
    expect(second.packId).toBe(first.packId);
    expect(second.jobId).toBe(first.jobId);
  });

  it('stores and retrieves jobs and packs', async () => {
    const repo = new MemoryRepo();
    await repo.upsertJob({
      id: 'j1',
      packId: 'p1',
      sessionId: 's1',
      stage: 'ingestion',
      status: 'queued',
      progress: 0,
      attempt: 0,
      retryState: 'none',
      degradationState: 'none',
      errors: [],
      heartbeatAt: Date.now()
    });

    expect((await repo.getJob('j1'))?.id).toBe('j1');

    await repo.saveIngestedPack('p1', 'Alan Turing', {
      revisionId: '1',
      title: 'Alan Turing',
      sections: [{ heading: 'Overview', content: 'content' }],
      outgoingLinks: [
        {
          title: 'Computability theory',
          url: 'https://en.wikipedia.org/wiki/Computability_theory',
          sourceHeading: 'Overview'
        }
      ]
    });

    expect((await repo.getPack('p1'))?.sourceRevisionId).toBe('1');
    expect((await repo.getPack('p1'))?.outgoingLinks[0]?.title).toBe('Computability theory');
  });

  it('stores fresh source and artifact cache records with pack provenance', async () => {
    const repo = new MemoryRepo();
    await repo.createPendingPack('p1', 'Alan Turing');
    const sourceCacheKey = buildSourceCacheKey('en', 'Alan Turing');
    const artifactCacheKey = buildArtifactCacheKey('summaries', 'rev-1', 'summary@1.0.0', '1.0.0');

    await repo.saveCachedSource({
      cacheKey: sourceCacheKey,
      sourceTitle: 'Alan Turing',
      sourceRevisionId: 'rev-1',
      parserVersion: 'parser@1.0.0',
      language: 'en',
      sections: [{ heading: 'Overview', content: 'content' }],
      outgoingLinks: [],
      cachedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2999-01-01T00:00:00.000Z'
    });
    await repo.saveCachedArtifact({
      cacheKey: artifactCacheKey,
      kind: 'summaries',
      sourceRevisionId: 'rev-1',
      promptVersion: 'summary@1.0.0',
      taxonomyVersion: '1.0.0',
      payload: { summaries: [{ level: 'beginner', text: 'summary', citations: [], promptVersion: 'summary@1.0.0', model: 'm' }] },
      cachedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2999-01-01T00:00:00.000Z'
    });
    await repo.recordCacheEvent('p1', {
      stage: 'summaries',
      cacheKey: artifactCacheKey,
      hit: true,
      sourceRevisionId: 'rev-1',
      promptVersion: 'summary@1.0.0',
      taxonomyVersion: '1.0.0'
    });

    expect((await repo.getCachedSource(sourceCacheKey, 'parser@1.0.0'))?.sourceRevisionId).toBe('rev-1');
    expect((await repo.getCachedArtifact('summaries', 'rev-1', 'summary@1.0.0', '1.0.0'))?.cacheKey).toBe(artifactCacheKey);
    expect((await repo.getPack('p1'))?.cacheEvents[0]?.hit).toBe(true);
  });

  it('persists quiz attempts and outcome aggregates', async () => {
    const repo = new MemoryRepo();
    await repo.createPendingPack('p1', 'Topic');
    await repo.saveActiveRecall(
      'p1',
      [{ question: 'q', answer: 'a', citation: 'c', promptVersion: 'v1', model: 'm1' }],
      [
        {
          question: 'q1',
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
          explanation: 'e1',
          citation: 'c1',
          promptVersion: 'v1',
          model: 'm1'
        },
        {
          question: 'q2',
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 2,
          explanation: 'e2',
          citation: 'c2',
          promptVersion: 'v1',
          model: 'm1'
        }
      ]
    );

    const attempt = await repo.saveQuizAttempt('p1', [0, 1]);
    expect(attempt?.correctAnswers).toBe(1);
    expect(attempt?.accuracy).toBe(0.5);

    await repo.recordJobCompletion({
      jobId: 'j1',
      packId: 'p1',
      durationMs: 900,
      citationRate: 1,
      flashcards: 15,
      quizQuestions: 10
    });
    await repo.recordJobFailure({ jobId: 'j2', packId: 'p2' });
    await repo.recordStageCost({
      jobId: 'j1',
      packId: 'p1',
      stage: 'ingestion',
      estimatedTokens: 300,
      latencyMs: 1200,
      estimatedCostUsd: 0.001,
      promptVersion: 'wikipedia-parser@1.0.0',
      model: 'deterministic-parser'
    });
    await repo.recordStageCost({
      jobId: 'j1',
      packId: 'p1',
      stage: 'summarization',
      estimatedTokens: 1200,
      latencyMs: 3400,
      estimatedCostUsd: 0.013,
      promptVersion: 'summary-by-level@1.0.0',
      model: 'local-rule-based'
    });
    await repo.recordStageCost({
      jobId: 'j1',
      packId: 'p1',
      stage: 'active_recall',
      estimatedTokens: 900,
      latencyMs: 2200,
      estimatedCostUsd: 0.009,
      promptVersion: 'active-recall@1.0.0',
      model: 'local-rule-based'
    });

    const snapshot = await repo.getOutcomesSnapshot();
    const costTrends = await repo.getCostTrendSnapshot(24);
    const operational = await repo.getOperationalMetricsSnapshot();

    expect(snapshot.jobs.completed).toBe(1);
    expect(snapshot.jobs.failed).toBe(1);
    expect(snapshot.jobs.completionRate).toBe(0.5);
    expect(snapshot.learning.attempts).toBe(1);
    expect(snapshot.learning.avgAccuracy).toBe(0.5);
    expect(snapshot.slo.p95TimeToFirstArtifactMs).toBe(4600);
    expect(snapshot.slo.p95FullPackCompletionMs).toBe(900);
    expect(snapshot.slo.jobSuccessRate).toBe(0.5);
    expect(snapshot.slo.citationCoverageRate).toBe(1);
    expect(snapshot.cost.totalEstimatedUsd).toBeCloseTo(0.023, 6);
    expect(snapshot.cost.avgEstimatedUsdPerPack).toBeCloseTo(0.023, 6);
    expect(snapshot.cost.byStage.find((entry) => entry.stage === 'summarization')?.avgTokens).toBe(1200);
    expect(costTrends.byPack[0]).toMatchObject({
      packId: 'p1',
      events: 3,
      estimatedTokens: 2400
    });
    expect(costTrends.byPromptModel.some((entry) => entry.promptVersion === 'summary-by-level@1.0.0')).toBe(true);
    expect(operational.degradation.completedJobs).toBe(0);
    expect(operational.cache.events).toBe(0);
  });
});
