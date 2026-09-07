import { describe, expect, it, vi } from 'vitest';
import { buildArtifactCacheKey, buildSourceCacheKey } from '../src/domain/cachePolicy.js';
import { activeShareTokenVersion, createShareTokenHash } from '../src/domain/shareLinks.js';
import { MemoryRepo } from '../src/repo/memoryRepo.js';

describe('MemoryRepo', () => {
  it('reuses idempotency keys within ttl', async () => {
    const repo = new MemoryRepo();
    const first = await repo.createOrReuseByIdempotency('k1', 3600);
    const second = await repo.createOrReuseByIdempotency('k1', 3600);
    const lookup = await repo.getIdempotency('k1', 3600);

    expect(second.reused).toBe(true);
    expect(second.packId).toBe(first.packId);
    expect(second.jobId).toBe(first.jobId);
    expect(lookup).toEqual({ packId: first.packId, jobId: first.jobId, reused: true });
    expect(await repo.getIdempotency('missing', 3600)).toBeUndefined();
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

  it('clears study goals when reset for tests', async () => {
    const repo = new MemoryRepo();
    await repo.upsertStudyGoal('user-reset', 4);

    expect(await repo.getStudyGoal('user-reset')).toMatchObject({ dailyTargetReviews: 4 });

    repo.resetForTests();

    expect(await repo.getStudyGoal('user-reset')).toBeUndefined();
  });

  it('keeps generation feedback in a separate untrusted eval-candidate stream', async () => {
    const repo = new MemoryRepo();
    await repo.createPendingPack('pack-feedback', 'Feedback Pack');

    const feedback = await repo.recordGenerationFeedback({
      userId: 'feedback-user',
      packId: 'pack-feedback',
      artifactType: 'quiz',
      artifactId: 'question-0',
      rating: 2,
      signal: 'incorrect',
      comment: 'The answer key looks wrong.',
      promptVersion: 'active-recall@1.0.0',
      model: 'local-rule-based'
    });
    const summary = await repo.getGenerationFeedbackSummary();

    expect(feedback).toMatchObject({
      userId: 'feedback-user',
      packId: 'pack-feedback',
      trustedArtifact: false,
      evalCandidate: true
    });
    expect(summary).toMatchObject({
      dataset: 'user_feedback',
      trustedArtifact: false,
      contaminatesGoldenSet: false,
      requiresHumanReview: true,
      totalFeedback: 1,
      negativeFeedback: 1,
      averageRating: 2
    });
    expect(summary.byArtifact[0]).toMatchObject({
      artifactType: 'quiz',
      totalFeedback: 1,
      signals: [{ signal: 'incorrect', count: 1 }]
    });

    repo.resetForTests();
    await expect(repo.getGenerationFeedbackSummary()).resolves.toMatchObject({ totalFeedback: 0, byArtifact: [] });
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

  it('summarizes and invalidates stale cache records for admin repair', async () => {
    const repo = new MemoryRepo();
    const staleSourceKey = buildSourceCacheKey('en', 'Stale Source');
    const freshSourceKey = buildSourceCacheKey('en', 'Fresh Source');
    const staleArtifactKey = buildArtifactCacheKey('summaries', 'rev-stale', 'summary@1.0.0', '1.0.0');
    const freshArtifactKey = buildArtifactCacheKey('glossary', 'rev-fresh', 'glossary@1.0.0', '1.0.0');

    await repo.saveCachedSource({
      cacheKey: staleSourceKey,
      sourceTitle: 'Stale Source',
      sourceRevisionId: 'rev-stale',
      parserVersion: 'parser@1.0.0',
      language: 'en',
      sections: [],
      outgoingLinks: [],
      cachedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-02T00:00:00.000Z'
    });
    await repo.saveCachedSource({
      cacheKey: freshSourceKey,
      sourceTitle: 'Fresh Source',
      sourceRevisionId: 'rev-fresh',
      parserVersion: 'parser@1.0.0',
      language: 'en',
      sections: [],
      outgoingLinks: [],
      cachedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-20T00:00:00.000Z'
    });
    await repo.saveCachedArtifact({
      cacheKey: staleArtifactKey,
      kind: 'summaries',
      sourceRevisionId: 'rev-stale',
      promptVersion: 'summary@1.0.0',
      taxonomyVersion: '1.0.0',
      payload: { summaries: [] },
      cachedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-02T00:00:00.000Z'
    });
    await repo.saveCachedArtifact({
      cacheKey: freshArtifactKey,
      kind: 'glossary',
      sourceRevisionId: 'rev-fresh',
      promptVersion: 'glossary@1.0.0',
      taxonomyVersion: '1.0.0',
      payload: { glossary: [] },
      cachedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-20T00:00:00.000Z'
    });

    const snapshot = await repo.getCacheAdminSnapshot('2026-01-10T00:00:00.000Z');
    expect(snapshot).toMatchObject({
      source: { total: 2, fresh: 1, expired: 1 },
      artifacts: { total: 2, fresh: 1, expired: 1 },
      repairCandidates: 2
    });
    expect(snapshot.artifacts.byKind).toEqual([
      { kind: 'glossary', total: 1, expired: 0 },
      { kind: 'summaries', total: 1, expired: 1 }
    ]);
    expect(snapshot.staleSources[0]?.cacheKey).toBe(staleSourceKey);
    expect(snapshot.staleArtifacts[0]?.cacheKey).toBe(staleArtifactKey);

    const dryRun = await repo.invalidateCache({
      target: 'expired',
      dryRun: true,
      requestedAt: '2026-01-10T00:00:00.000Z',
      reason: 'test'
    });
    expect(dryRun).toMatchObject({
      matchedSource: 1,
      matchedArtifacts: 1,
      deletedSource: 0,
      deletedArtifacts: 0
    });
    expect((await repo.getCacheAdminSnapshot('2026-01-10T00:00:00.000Z')).repairCandidates).toBe(2);

    const applied = await repo.invalidateCache({
      target: 'expired',
      dryRun: false,
      requestedAt: '2026-01-10T00:00:00.000Z',
      reason: 'test'
    });
    expect(applied).toMatchObject({
      matchedSource: 1,
      matchedArtifacts: 1,
      deletedSource: 1,
      deletedArtifacts: 1
    });
    expect(await repo.getCacheAdminSnapshot('2026-01-10T00:00:00.000Z')).toMatchObject({
      source: { total: 1, fresh: 1, expired: 0 },
      artifacts: { total: 1, fresh: 1, expired: 0 },
      repairCandidates: 0
    });
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
          misconceptions: ['a is right', 'b is wrong', 'c is wrong', 'd is wrong'],
          explanation: 'e1',
          citation: 'c1',
          promptVersion: 'v1',
          model: 'm1'
        },
        {
          question: 'q2',
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 2,
          misconceptions: ['a is wrong', 'b is wrong', 'c is right', 'd is wrong'],
          explanation: 'e2',
          citation: 'c2',
          promptVersion: 'v1',
          model: 'm1'
        }
      ]
    );

    const attempt = await repo.saveQuizAttempt('user-1', 'p1', [0, 1], 0.75);
    expect(attempt?.correctAnswers).toBe(1);
    expect(attempt?.accuracy).toBe(0.5);
    expect(attempt).toMatchObject({
      userId: 'user-1',
      attemptNumber: 1,
      selectedIndices: [0, 1],
      accuracyDelta: 0,
      cardMasteryScore: 0.75,
      masteryScore: 0.625,
      masteryDelta: -0.125
    });

    const retake = await repo.saveQuizAttempt('user-1', 'p1', [0, 2], 0.75);
    expect(retake).toMatchObject({
      attemptNumber: 2,
      correctAnswers: 2,
      previousAccuracy: 0.5,
      accuracyDelta: 0.5,
      masteryScore: 0.875,
      masteryDelta: 0.25
    });
    await repo.saveQuizAttempt('user-2', 'p1', [0, 2], 0);
    expect((await repo.listQuizAttempts('user-1', 'p1', 5)).map((item) => item.attemptNumber)).toEqual([2, 1]);
    expect((await repo.listQuizAttempts('user-1', 'p1', 0)).map((item) => item.attemptNumber)).toEqual([2]);

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
    expect(snapshot.learning.attempts).toBe(3);
    expect(snapshot.learning.retakes).toBe(1);
    expect(snapshot.learning.avgAccuracy).toBeCloseTo(5 / 6, 6);
    expect(snapshot.learning.avgMasteryScore).toBeCloseTo(2 / 3, 6);
    expect(snapshot.learning.avgMasteryDelta).toBeCloseTo(0.208333, 6);
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

    await repo.recordJobCompletion({
      jobId: 'old-j1',
      packId: 'old-p1',
      durationMs: 5000,
      citationRate: 0.2,
      flashcards: 4,
      quizQuestions: 2,
      recordedAt: '2000-01-01T00:00:00.000Z'
    });
    await repo.recordStageCost({
      jobId: 'old-j1',
      packId: 'old-p1',
      stage: 'summarization',
      estimatedTokens: 9999,
      latencyMs: 5000,
      estimatedCostUsd: 9,
      promptVersion: 'summary-by-level@legacy',
      model: 'legacy-model',
      recordedAt: '2000-01-01T00:00:00.000Z'
    });
    const windowedSnapshot = await repo.getOutcomesSnapshot(24);
    expect(windowedSnapshot.jobs.completed).toBe(1);
    expect(windowedSnapshot.cost.totalEstimatedUsd).toBeCloseTo(0.023, 6);
    expect(windowedSnapshot.cost.byStage.find((entry) => entry.stage === 'summarization')?.avgTokens).toBe(1200);

    const drilldown = await repo.getCostDrilldownSnapshot(24, {
      packId: 'p1',
      promptVersion: 'summary-by-level@1.0.0',
      model: 'local-rule-based',
      stage: 'summarization',
      limit: 50
    });
    expect(drilldown.totalEvents).toBe(1);
    expect(drilldown.totalEstimatedTokens).toBe(1200);
    expect(drilldown.totalEstimatedUsd).toBeCloseTo(0.013, 6);
    expect(drilldown.distinctPacks).toBe(1);
    expect(drilldown.rows).toEqual([
      expect.objectContaining({
        packId: 'p1',
        promptVersion: 'summary-by-level@1.0.0',
        model: 'local-rule-based',
        stage: 'summarization',
        events: 1,
        estimatedTokens: 1200,
        avgTokens: 1200,
        avgLatencyMs: 3400,
        totalEstimatedUsd: 0.013,
        avgEstimatedUsd: 0.013,
        firstRecordedAt: expect.any(String),
        lastRecordedAt: expect.any(String)
      })
    ]);

    const limitedDrilldown = await repo.getCostDrilldownSnapshot(24, { limit: 2 });
    expect(limitedDrilldown.rows).toHaveLength(2);
    expect(limitedDrilldown.rows.map((entry) => entry.stage)).toEqual(['summarization', 'active_recall']);
    const overLimitDrilldown = await repo.getCostDrilldownSnapshot(24, { limit: 500 });
    expect(overLimitDrilldown.filters.limit).toBe(50);
  });

  it('lists recent packs for a session with readiness state', async () => {
    const repo = new MemoryRepo();
    await repo.createPendingPack('p1', 'Ada Lovelace');
    await repo.saveIngestedPack('p1', 'Ada Lovelace', {
      revisionId: 'rev-1',
      title: 'Ada Lovelace',
      sections: [{ heading: 'Overview', content: 'content' }],
      outgoingLinks: []
    });
    await repo.upsertJob({
      id: 'j1',
      packId: 'p1',
      sessionId: 's1',
      stage: 'done',
      status: 'completed',
      progress: 100,
      attempt: 1,
      retryState: 'none',
      degradationState: 'partial',
      degradationReason: 'budget_or_time_exceeded_after_summaries',
      errors: [],
      heartbeatAt: 1000
    });

    const history = await repo.listRecentPacksForSession('s1', 10);

    expect(history[0]).toMatchObject({
      id: 'p1',
      input: 'Ada Lovelace',
      sourceRevisionId: 'rev-1',
      readiness: {
        status: 'partial',
        missingArtifacts: ['summaries', 'graph', 'glossary', 'flashcards', 'quiz'],
        canResume: true,
        degradationReason: 'budget_or_time_exceeded_after_summaries'
      }
    });
  });

  it('saves packs to a user library across sessions', async () => {
    const repo = new MemoryRepo();
    await repo.createPendingPack('p1', 'Ada Lovelace');
    await repo.upsertJob({
      id: 'j1',
      packId: 'p1',
      sessionId: 's1',
      stage: 'done',
      status: 'completed',
      progress: 100,
      attempt: 1,
      retryState: 'none',
      degradationState: 'none',
      errors: [],
      heartbeatAt: 1000
    });

    await repo.savePackForUser('user-shared', 'p1');
    const library = await repo.listSavedPacksForUser('user-shared', 10);

    expect(library[0]).toMatchObject({
      id: 'p1',
      input: 'Ada Lovelace',
      latestJob: {
        id: 'j1',
        status: 'completed'
      }
    });
    expect(await repo.listSavedPacksForUser('other-user', 10)).toEqual([]);
  });

  it('searches, filters, sorts, and facets saved library rows', async () => {
    const repo = new MemoryRepo();
    const seedPack = async (packId: string, input: string, full: boolean, flashcards = 2) => {
      await repo.createPendingPack(packId, input);
      if (!full) {
        return;
      }
      await repo.saveIngestedPack(packId, input, {
        revisionId: `rev-${packId}`,
        title: input,
        sections: [{ heading: 'Overview', content: `${input} content.` }],
        outgoingLinks: []
      });
      await repo.saveSummaries(packId, [
        {
          level: 'beginner',
          text: `${input} summary.`,
          citations: ['Summary citation'],
          promptVersion: 'summary@1.0.0',
          model: 'local-rule-based'
        }
      ]);
      await repo.saveGlossary(packId, [
        {
          term: `${input} term`,
          definition: 'Definition.',
          citation: 'Glossary citation',
          promptVersion: 'glossary@1.0.0',
          model: 'local-rule-based'
        }
      ]);
      await repo.saveKnowledgeStructure(
        packId,
        [{ id: `${packId}-node`, label: input, type: 'concept', citation: 'Node citation' }],
        [],
        []
      );
      await repo.saveActiveRecall(
        packId,
        Array.from({ length: flashcards }, (_, index) => ({
          question: `${input} card ${index + 1}?`,
          answer: `${input} answer ${index + 1}.`,
          citation: 'Flashcard citation',
          promptVersion: 'active-recall@1.0.0',
          model: 'local-rule-based'
        })),
        [
          {
            question: `${input} quiz?`,
            options: ['Correct', 'Distractor', 'Third', 'Fourth'],
            correctIndex: 0,
            misconceptions: ['Correct is supported.', 'Distractor is not supported.', 'Third is not supported.', 'Fourth is not supported.'],
            explanation: 'The correct answer is cited.',
            citation: 'Quiz citation',
            promptVersion: 'active-recall@1.0.0',
            model: 'local-rule-based'
          }
        ]
      );
    };

    await seedPack('p-ada-complete', 'Ada Complete', true, 2);
    await seedPack('p-ada-draft', 'Ada Draft', false);
    await seedPack('p-grace-reviewed', 'Grace Reviewed', true, 1);
    await repo.savePackForUser('user-library', 'p-ada-complete');
    await repo.savePackForUser('user-library', 'p-ada-draft');
    await repo.savePackForUser('user-library', 'p-grace-reviewed');
    await repo.updateSavedPackOrganization('user-library', 'p-ada-complete', {
      tags: ['Math', 'history', 'math'],
      collection: 'STEM'
    });
    await repo.updateSavedPackOrganization('user-library', 'p-grace-reviewed', {
      tags: ['history'],
      collection: 'Computing'
    });
    await repo.recordFlashcardReview('user-library', 'p-ada-complete', 0, 'good');
    await repo.recordFlashcardReview('user-library', 'p-grace-reviewed', 0, 'easy');

    const filtered = await repo.listSavedLibraryForUser('user-library', {
      limit: 10,
      search: 'ada',
      readiness: 'full',
      progress: 'due',
      tag: 'math',
      collection: 'STEM',
      sort: 'title_asc'
    });
    const sorted = await repo.listSavedLibraryForUser('user-library', { limit: 10, sort: 'title_asc' });

    expect(filtered.facets).toEqual({
      total: 2,
      readiness: { full: 1, partial: 1 },
      progress: { due: 1, reviewed: 1, notStarted: 1 },
      tags: [
        { tag: 'history', count: 1 },
        { tag: 'math', count: 1 }
      ],
      collections: [{ collection: 'STEM', count: 1 }]
    });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]).toMatchObject({
      id: 'p-ada-complete',
      input: 'Ada Complete',
      readiness: { status: 'full' },
      progress: { totalCards: 2, reviewedCards: 1, dueCards: 1 },
      organization: { tags: ['math', 'history'], collection: 'STEM' }
    });
    expect((await repo.updateSavedPackOrganization('user-library', 'missing-pack', { tags: ['later'] }))).toBeUndefined();
    expect(sorted.items.map((item) => item.input)).toEqual(['Ada Complete', 'Ada Draft', 'Grace Reviewed']);
    expect(sorted.facets.tags).toEqual([
      { tag: 'history', count: 2 },
      { tag: 'math', count: 1 }
    ]);
    expect(sorted.facets.collections).toEqual([
      { collection: 'Computing', count: 1 },
      { collection: 'STEM', count: 1 }
    ]);
  });

  it('builds saved-pack version history for regenerated source revisions', async () => {
    const repo = new MemoryRepo();
    const seedPack = async (packId: string, input: string, revisionId: string, flashcards: number) => {
      await repo.createPendingPack(packId, input);
      await repo.saveIngestedPack(packId, input, {
        revisionId,
        title: input,
        sections: [{ heading: 'Overview', content: `Revision ${revisionId}.` }],
        outgoingLinks: []
      });
      await repo.saveSummaries(packId, [
        {
          level: 'beginner',
          text: `Summary ${revisionId}.`,
          citations: ['Summary citation'],
          promptVersion: 'summary@1.0.0',
          model: 'local-rule-based'
        }
      ]);
      await repo.saveGlossary(packId, [
        {
          term: 'Analytical Engine',
          definition: 'Definition.',
          citation: 'Glossary citation',
          promptVersion: 'glossary@1.0.0',
          model: 'local-rule-based'
        }
      ]);
      await repo.saveKnowledgeStructure(packId, [{ id: `${packId}-node`, label: 'Ada Lovelace', type: 'person', citation: 'Node citation' }], [], []);
      await repo.saveActiveRecall(
        packId,
        Array.from({ length: flashcards }, (_, index) => ({
          question: `Card ${index + 1}?`,
          answer: `Answer ${index + 1}.`,
          citation: 'Flashcard citation',
          promptVersion: 'active-recall@1.0.0',
          model: 'local-rule-based'
        })),
        [
          {
            question: 'Quiz?',
            options: ['Correct', 'Distractor', 'Third', 'Fourth'],
            correctIndex: 0,
            misconceptions: ['Correct is supported.', 'Distractor is not.', 'Third is not.', 'Fourth is not.'],
            explanation: 'The correct answer is cited.',
            citation: 'Quiz citation',
            promptVersion: 'active-recall@1.0.0',
            model: 'local-rule-based'
          }
        ]
      );
    };

    await seedPack('p-ada-v1', 'Ada Lovelace', 'rev-old', 1);
    await seedPack('p-ada-v2', 'Ada Lovelace', 'rev-new', 3);
    await seedPack('p-grace', 'Grace Hopper', 'rev-grace', 1);
    await repo.savePackForUser('version-user', 'p-ada-v1');
    await repo.savePackForUser('version-user', 'p-ada-v2');
    await repo.savePackForUser('version-user', 'p-grace');

    const history = await repo.getSavedPackVersionHistory('version-user', 'p-ada-v2', 8);

    expect(history?.current).toMatchObject({
      id: 'p-ada-v2',
      current: true,
      sourceRevisionChanged: false,
      artifactCounts: { flashcards: 3, quizQuestions: 1 }
    });
    expect(history?.versions.map((item) => item.id).sort()).toEqual(['p-ada-v1', 'p-ada-v2']);
    expect(history?.compare).toMatchObject({
      baselinePackId: 'p-ada-v1',
      baselineSourceRevisionId: 'rev-old',
      sourceRevisionChanged: true,
      readinessChanged: false,
      artifactDeltas: { flashcards: 2, quizQuestions: 0 },
      missingArtifactsAdded: [],
      missingArtifactsRemoved: []
    });
    expect(await repo.getSavedPackVersionHistory('version-user', 'missing-pack', 8)).toBeUndefined();
  });

  it('stores user profiles, share links, and spaced-repetition progress', async () => {
    const repo = new MemoryRepo();
    await repo.createPendingPack('p1', 'Ada Lovelace');
    await repo.saveActiveRecall(
      'p1',
      [
        { question: 'q1', answer: 'a1', citation: 'c1', promptVersion: 'v1', model: 'm1' },
        { question: 'q2', answer: 'a2', citation: 'c2', promptVersion: 'v1', model: 'm1' }
      ],
      []
    );

    const profile = await repo.upsertUserProfile('user-1', 'Ada');
    const tokenHash = createShareTokenHash('share-1', 'test-secret');
    const share = await repo.createShareLink('user-1', 'p1', 'viewer', {
      shareId: 'share-1',
      tokenHash,
      tokenVersion: activeShareTokenVersion,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    const listedShares = await repo.listShareLinksForOwner('user-1', 'p1', 10);
    const initialProgress = await repo.getLearningProgress('user-1', 'p1');
    const review = await repo.recordFlashcardReview('user-1', 'p1', 0, 'good');
    const nextProgress = await repo.getLearningProgress('user-1', 'p1');

    expect(profile).toMatchObject({ userId: 'user-1', displayName: 'Ada' });
    expect(await repo.getUserProfile('user-1')).toMatchObject({ displayName: 'Ada' });
    expect(share).toMatchObject({ packId: 'p1', ownerUserId: 'user-1', role: 'viewer', tokenHash });
    expect(listedShares).toEqual([expect.objectContaining({ shareId: share!.shareId, ownerUserId: 'user-1' })]);
    expect(await repo.getShareLink(share!.shareId, tokenHash)).toMatchObject({ packId: 'p1' });
    expect(await repo.getShareLink(share!.shareId, 'sha256:wrong')).toBeUndefined();
    expect(await repo.revokeShareLink('other-user', 'p1', share!.shareId, tokenHash)).toBeUndefined();
    const revokedShare = await repo.revokeShareLink('user-1', 'p1', share!.shareId, tokenHash);
    expect(revokedShare).toMatchObject({ shareId: share!.shareId });
    expect(revokedShare?.revokedAt).toBeTruthy();
    expect(await repo.getShareLink(share!.shareId, tokenHash)).toBeUndefined();
    expect(await repo.listShareLinksForOwner('user-1', 'p1', 10)).toEqual([]);
    const expiredHash = createShareTokenHash('share-expired', 'test-secret');
    await repo.createShareLink('user-1', 'p1', 'viewer', {
      shareId: 'share-expired',
      tokenHash: expiredHash,
      tokenVersion: activeShareTokenVersion,
      expiresAt: new Date(Date.now() - 1_000).toISOString()
    });
    expect(await repo.getShareLink('share-expired', expiredHash)).toBeUndefined();
    expect(await repo.listShareLinksForOwner('user-1', 'p1', 10)).toEqual([]);
    expect(initialProgress).toMatchObject({
      totalCards: 2,
      reviewedCards: 0,
      dueCards: 2
    });
    expect(review).toMatchObject({ cardIndex: 0, rating: 'good' });
    expect(Date.parse(review!.nextDueAt)).toBeGreaterThan(Date.parse(review!.reviewedAt));
    expect(nextProgress).toMatchObject({
      totalCards: 2,
      reviewedCards: 1,
      dueCards: 1
    });
    expect(nextProgress!.masteryScore).toBeGreaterThan(0);
  });

  it('exports and deletes all user-owned data without deleting generated packs', async () => {
    const repo = new MemoryRepo();
    await repo.createPendingPack('p-user-data', 'User Data');
    await repo.saveActiveRecall(
      'p-user-data',
      [{ question: 'q1', answer: 'a1', citation: 'c1', promptVersion: 'v1', model: 'm1' }],
      [
        {
          question: 'q1',
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
          misconceptions: ['a', 'b', 'c', 'd'],
          explanation: 'e',
          citation: 'c1',
          promptVersion: 'v1',
          model: 'm1'
        }
      ]
    );
    await repo.upsertUserProfile('user-data', 'Data User');
    await repo.savePackForUser('user-data', 'p-user-data');
    await repo.updateSavedPackOrganization('user-data', 'p-user-data', { tags: ['privacy'], collection: 'Account' });
    await repo.createShareLink('user-data', 'p-user-data', 'viewer', {
      shareId: 'share-data',
      tokenHash: createShareTokenHash('share-data', 'test-secret'),
      tokenVersion: activeShareTokenVersion,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    await repo.recordFlashcardReview('user-data', 'p-user-data', 0, 'good');
    await repo.createLearningSession('user-data', 'p-user-data', 1, 0, {
      status: 'active',
      reviewedCount: 0,
      outcome: { completedCards: 0, remainingCards: 1, masteryScore: 0, masteryDelta: 0 }
    });
    await repo.saveQuizAttempt('user-data', 'p-user-data', [0], 0.5);
    await repo.upsertStudyGoal('user-data', 4);
    await repo.recordGenerationFeedback({
      userId: 'user-data',
      packId: 'p-user-data',
      artifactType: 'flashcards',
      rating: 4,
      signal: 'helpful'
    });
    await repo.upsertUserProfile('other-user', 'Other User');

    const exported = await repo.exportUserData('user-data');
    expect(exported.profile).toMatchObject({ displayName: 'Data User' });
    expect(exported.library).toEqual([
      expect.objectContaining({ packId: 'p-user-data', organization: { tags: ['privacy'], collection: 'Account' } })
    ]);
    expect(exported.shares).toEqual([expect.objectContaining({ shareId: 'share-data' })]);
    expect(exported.flashcardReviews).toEqual([expect.objectContaining({ packId: 'p-user-data', rating: 'good' })]);
    expect(exported.learningSessions).toEqual([expect.objectContaining({ packId: 'p-user-data', status: 'active' })]);
    expect(exported.quizAttempts).toEqual([expect.objectContaining({ packId: 'p-user-data', attemptNumber: 1 })]);
    expect(exported.studyGoal).toMatchObject({ dailyTargetReviews: 4 });
    expect(exported.generationFeedback).toEqual([expect.objectContaining({ artifactType: 'flashcards', trustedArtifact: false })]);

    const deleted = await repo.deleteUserData('user-data');
    expect(deleted.deleted).toMatchObject({
      profile: true,
      library: 1,
      shares: 1,
      flashcardReviews: 1,
      learningSessions: 1,
      quizAttempts: 1,
      studyGoals: 1,
      generationFeedback: 1
    });
    expect(await repo.exportUserData('user-data')).toMatchObject({
      library: [],
      shares: [],
      flashcardReviews: [],
      learningSessions: [],
      quizAttempts: [],
      generationFeedback: []
    });
    expect((await repo.getPack('p-user-data'))?.id).toBe('p-user-data');
    expect(await repo.getUserProfile('other-user')).toMatchObject({ displayName: 'Other User' });
  });

  it('updates due counts and mastery as a learning session reviews all due cards', async () => {
    const repo = new MemoryRepo();
    await repo.createPendingPack('p-session', 'Session Topic');
    await repo.saveActiveRecall(
      'p-session',
      [
        { question: 'q1', answer: 'a1', citation: 'c1', promptVersion: 'v1', model: 'm1' },
        { question: 'q2', answer: 'a2', citation: 'c2', promptVersion: 'v1', model: 'm1' }
      ],
      []
    );

    const initial = await repo.getLearningProgress('user-session', 'p-session');
    await repo.recordFlashcardReview('user-session', 'p-session', 0, 'good');
    const afterFirst = await repo.getLearningProgress('user-session', 'p-session');
    await repo.recordFlashcardReview('user-session', 'p-session', 1, 'easy');
    const completed = await repo.getLearningProgress('user-session', 'p-session');

    expect(initial).toMatchObject({ totalCards: 2, reviewedCards: 0, dueCards: 2, masteryScore: 0 });
    expect(afterFirst).toMatchObject({ reviewedCards: 1, dueCards: 1 });
    expect(afterFirst!.cards.map((card) => card.due)).toEqual([false, true]);
    expect(completed).toMatchObject({ reviewedCards: 2, dueCards: 0 });
    expect(completed!.cards.map((card) => card.due)).toEqual([false, false]);
    expect(completed!.masteryScore).toBeGreaterThan(afterFirst!.masteryScore);
  });

  it('uses deterministic scheduler intervals for flashcard reviews', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
    try {
      const repo = new MemoryRepo();
      await repo.createPendingPack('p-schedule', 'Schedule Topic');
      await repo.saveActiveRecall(
        'p-schedule',
        [{ question: 'q1', answer: 'a1', citation: 'c1', promptVersion: 'v1', model: 'm1' }],
        []
      );

      const review = await repo.recordFlashcardReview('user-schedule', 'p-schedule', 0, 'again');
      const progress = await repo.getLearningProgress('user-schedule', 'p-schedule');

      expect(review).toMatchObject({
        reviewedAt: '2026-01-01T12:00:00.000Z',
        nextDueAt: '2026-01-01T12:10:00.000Z'
      });
      expect(progress?.masteryScore).toBe(0);
      expect(progress?.cards[0]).toMatchObject({ due: false, nextDueAt: '2026-01-01T12:10:00.000Z' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists learning session progress and completion outcome', async () => {
    const repo = new MemoryRepo();
    await repo.createPendingPack('p-session-record', 'Session Record Topic');
    await repo.saveActiveRecall(
      'p-session-record',
      [{ question: 'q1', answer: 'a1', citation: 'c1', promptVersion: 'v1', model: 'm1' }],
      []
    );

    const created = await repo.createLearningSession('user-session', 'p-session-record', 1, 0, {
      status: 'active',
      reviewedCount: 0,
      outcome: { completedCards: 0, remainingCards: 1, masteryScore: 0, masteryDelta: 0 }
    });
    expect(created).toMatchObject({
      userId: 'user-session',
      packId: 'p-session-record',
      status: 'active',
      baselineDueCards: 1,
      baselineMasteryScore: 0,
      reviewedCount: 0
    });

    const completed = await repo.updateLearningSessionProgress('user-session', 'p-session-record', created!.id, {
      status: 'completed',
      reviewedCount: 1,
      outcome: { completedCards: 1, remainingCards: 0, masteryScore: 1, masteryDelta: 1 }
    });

    expect(completed).toMatchObject({
      id: created!.id,
      status: 'completed',
      completedAt: expect.any(String),
      reviewedCount: 1,
      outcome: { completedCards: 1, remainingCards: 0, masteryScore: 1, masteryDelta: 1 }
    });
    expect(await repo.getLearningSession('user-session', 'p-session-record', created!.id)).toMatchObject({
      status: 'completed',
      reviewedCount: 1
    });
  });

  it('builds per-user learning analytics from saved packs, reviews, and quiz attempts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T09:00:00.000Z'));
    try {
      const repo = new MemoryRepo();
      await repo.createPendingPack('p-analytics', 'Analytics Topic');
      await repo.saveActiveRecall(
        'p-analytics',
        [
          { question: 'q1', answer: 'a1', citation: 'c1', promptVersion: 'v1', model: 'm1' },
          { question: 'q2', answer: 'a2', citation: 'c2', promptVersion: 'v1', model: 'm1' }
        ],
        [
          {
            question: 'quiz 1',
            options: ['a', 'b', 'c', 'd'],
            correctIndex: 0,
            misconceptions: ['a is correct', 'b is not', 'c is not', 'd is not'],
            explanation: 'e1',
            citation: 'c1',
            promptVersion: 'v1',
            model: 'm1'
          },
          {
            question: 'quiz 2',
            options: ['a', 'b', 'c', 'd'],
            correctIndex: 1,
            misconceptions: ['a is not', 'b is correct', 'c is not', 'd is not'],
            explanation: 'e2',
            citation: 'c2',
            promptVersion: 'v1',
            model: 'm1'
          }
        ]
      );
      await repo.createPendingPack('p-unsaved', 'Unsaved Topic');
      await repo.saveActiveRecall(
        'p-unsaved',
        [{ question: 'q3', answer: 'a3', citation: 'c3', promptVersion: 'v1', model: 'm1' }],
        []
      );
      await repo.savePackForUser('user-analytics', 'p-analytics');
      await repo.recordFlashcardReview('user-analytics', 'p-analytics', 0, 'good');
      await repo.recordFlashcardReview('other-user', 'p-analytics', 1, 'easy');
      await repo.upsertStudyGoal('user-analytics', 2);

      vi.setSystemTime(new Date('2026-01-02T09:00:00.000Z'));
      const progress = await repo.getLearningProgress('user-analytics', 'p-analytics');
      await repo.saveQuizAttempt('user-analytics', 'p-analytics', [0, 1], progress!.masteryScore);

      vi.setSystemTime(new Date('2026-01-03T09:00:00.000Z'));
      const analytics = await repo.getLearningAnalytics('user-analytics');

      expect(analytics).toMatchObject({
        userId: 'user-analytics',
        totalCards: 2,
        reviewedCards: 1,
        dueCards: 1,
        duePacks: 1,
        streak: {
          currentDays: 2,
          longestDays: 2,
          lastActivityAt: '2026-01-02T09:00:00.000Z'
        },
        goal: {
          dailyTargetReviews: 2,
          reviewsToday: 0,
          remainingToday: 2,
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
          retakes: 0,
          averageAccuracy: 1,
          latestAccuracy: 1
        }
      });
      expect(analytics.mastery.averageScore).toBe(0.375);
      expect(analytics.accuracy.trend).toHaveLength(1);
      expect(analytics.mastery.trend[0]).toMatchObject({ source: 'quiz', packId: 'p-analytics', masteryScore: 0.6875 });
      expect(await repo.getStudyGoal('user-analytics')).toMatchObject({ dailyTargetReviews: 2 });
      expect(analytics.packs).toEqual([
        expect.objectContaining({
          packId: 'p-analytics',
          totalCards: 2,
          reviewedCards: 1,
          dueCards: 1,
          retainedCards: 1,
          retentionRate: 1,
          quizAttempts: 1,
          latestAccuracy: 1
        })
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
