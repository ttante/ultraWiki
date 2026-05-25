import { randomUUID } from 'node:crypto';
import type { Flashcard, QuizQuestion } from '../domain/activeRecall.js';
import type { ArtifactCacheKind } from '../domain/cachePolicy.js';
import { buildArtifactCacheKey, isCacheFresh } from '../domain/cachePolicy.js';
import type { GlossaryTerm } from '../domain/glossary.js';
import type { IngestedPage } from '../domain/ingestion.js';
import type { Job } from '../domain/jobs.js';
import type { GraphEdge, GraphNode, TimelineEvent } from '../domain/knowledgeStructure.js';
import type { SummaryArtifact } from '../domain/summary.js';
import type {
  AppRepo,
  CachedArtifactRecord,
  CachedSourceRecord,
  CacheEventRecord,
  FlashcardReviewRating,
  FlashcardReviewRecord,
  IdempotencyResult,
  JobCompletionSample,
  JobFailureSample,
  CostTrendSnapshot,
  HistoryMissingArtifact,
  LearningProgressRecord,
  OperationalMetricsSnapshot,
  OutcomesMaintenanceSnapshot,
  OutcomesSnapshot,
  PackRecord,
  QuizAttemptRecord,
  ShareLinkRecord,
  ShareRole,
  StageCostSample,
  StudyPackHistoryItem,
  UserProfileRecord
} from './types.js';

type JobOutcomeRecord =
  | {
      status: 'completed';
      durationMs: number;
      citationRate: number;
      flashcards: number;
      quizQuestions: number;
    }
  | {
      status: 'failed';
    };

const average = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
};

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(p * sorted.length) - 1;
  const bounded = Math.min(sorted.length - 1, Math.max(0, index));
  return sorted[bounded];
};

const reviewIntervalsMs: Record<FlashcardReviewRating, number> = {
  again: 10 * 60 * 1000,
  hard: 24 * 60 * 60 * 1000,
  good: 3 * 24 * 60 * 60 * 1000,
  easy: 7 * 24 * 60 * 60 * 1000
};

const ratingScore: Record<FlashcardReviewRating, number> = {
  again: 0,
  hard: 0.4,
  good: 0.75,
  easy: 1
};

const getMissingArtifactsForPack = (pack: {
  summaries: unknown[];
  graphNodes: unknown[];
  graphEdges: unknown[];
  timelineEvents: unknown[];
  glossary: unknown[];
  flashcards: unknown[];
  quizQuestions: unknown[];
}): HistoryMissingArtifact[] => {
  const missing: HistoryMissingArtifact[] = [];
  if (pack.summaries.length === 0) missing.push('summaries');
  if (pack.graphNodes.length === 0 && pack.graphEdges.length === 0 && pack.timelineEvents.length === 0) missing.push('graph');
  if (pack.glossary.length === 0) missing.push('glossary');
  if (pack.flashcards.length === 0) missing.push('flashcards');
  if (pack.quizQuestions.length === 0) missing.push('quiz');
  return missing;
};

export class MemoryRepo implements AppRepo {
  private idempotency = new Map<string, { packId: string; jobId: string; createdAt: number }>();
  private jobs = new Map<string, Job>();
  private packs = new Map<string, PackRecord>();
  private sourceCache = new Map<string, CachedSourceRecord>();
  private artifactCache = new Map<string, CachedArtifactRecord>();
  private quizAttempts: QuizAttemptRecord[] = [];
  private outcomes = new Map<string, JobOutcomeRecord>();
  private stageCosts: StageCostSample[] = [];
  private savedPacks = new Map<string, Map<string, string>>();
  private userProfiles = new Map<string, UserProfileRecord>();
  private shareLinks = new Map<string, ShareLinkRecord>();
  private flashcardReviews: FlashcardReviewRecord[] = [];

  resetForTests(): void {
    this.idempotency.clear();
    this.jobs.clear();
    this.packs.clear();
    this.sourceCache.clear();
    this.artifactCache.clear();
    this.quizAttempts = [];
    this.outcomes.clear();
    this.stageCosts = [];
    this.savedPacks.clear();
    this.userProfiles.clear();
    this.shareLinks.clear();
    this.flashcardReviews = [];
  }

  async createOrReuseByIdempotency(key: string, ttlSeconds: number): Promise<IdempotencyResult> {
    const now = Date.now();
    const existing = this.idempotency.get(key);
    if (existing && now - existing.createdAt < ttlSeconds * 1000) {
      return { packId: existing.packId, jobId: existing.jobId, reused: true };
    }

    const packId = randomUUID();
    const jobId = randomUUID();
    this.idempotency.set(key, { packId, jobId, createdAt: now });
    return { packId, jobId, reused: false };
  }

  async createPendingPack(packId: string, input: string): Promise<void> {
    this.packs.set(packId, {
      id: packId,
      input,
      sourceRevisionId: 'pending',
      createdAt: new Date().toISOString(),
      sections: [],
      outgoingLinks: [],
      cacheEvents: [],
      summaries: [],
      flashcards: [],
      quizQuestions: [],
      glossary: [],
      graphNodes: [],
      graphEdges: [],
      timelineEvents: []
    });
  }

  async upsertJob(job: Job): Promise<void> {
    this.jobs.set(job.id, { ...job });
  }

  async getJob(jobId: string): Promise<Job | undefined> {
    const job = this.jobs.get(jobId);
    return job ? { ...job, errors: [...job.errors] } : undefined;
  }

  async listJobs(): Promise<Job[]> {
    return Array.from(this.jobs.values()).map((job) => ({ ...job, errors: [...job.errors] }));
  }

  async claimNextQueuedJob(): Promise<Job | undefined> {
    const queued = Array.from(this.jobs.values())
      .filter((j) => j.status === 'queued')
      .sort((a, b) => a.heartbeatAt - b.heartbeatAt)[0];

    if (!queued) {
      return undefined;
    }

    queued.status = 'running';
    queued.attempt += 1;
    queued.retryState = 'none';
    queued.heartbeatAt = Date.now();
    this.jobs.set(queued.id, queued);
    return { ...queued, errors: [...queued.errors] };
  }

  async countQueuedJobs(): Promise<number> {
    return Array.from(this.jobs.values()).filter((j) => j.status === 'queued').length;
  }

  async countRunningJobs(): Promise<number> {
    return Array.from(this.jobs.values()).filter((j) => j.status === 'running').length;
  }

  async countInflightJobsForSession(sessionId: string): Promise<number> {
    return Array.from(this.jobs.values()).filter(
      (j) => j.sessionId === sessionId && (j.status === 'queued' || j.status === 'running')
    ).length;
  }

  async countInflightJobsForPack(packId: string): Promise<number> {
    return Array.from(this.jobs.values()).filter(
      (j) => j.packId === packId && (j.status === 'queued' || j.status === 'running')
    ).length;
  }

  async getLatestJobForPack(packId: string): Promise<Job | undefined> {
    const latest = Array.from(this.jobs.values())
      .filter((job) => job.packId === packId)
      .sort((a, b) => b.heartbeatAt - a.heartbeatAt)[0];
    return latest ? { ...latest, errors: [...latest.errors] } : undefined;
  }

  async getCachedSource(cacheKey: string, parserVersion: string): Promise<CachedSourceRecord | undefined> {
    const cached = this.sourceCache.get(cacheKey);
    if (!cached || cached.parserVersion !== parserVersion || !isCacheFresh(cached.expiresAt)) {
      return undefined;
    }
    return {
      ...cached,
      sections: cached.sections.map((section) => ({ ...section })),
      outgoingLinks: cached.outgoingLinks.map((link) => ({ ...link }))
    };
  }

  async saveCachedSource(record: CachedSourceRecord): Promise<void> {
    this.sourceCache.set(record.cacheKey, {
      ...record,
      sections: record.sections.map((section) => ({ ...section })),
      outgoingLinks: record.outgoingLinks.map((link) => ({ ...link }))
    });
  }

  async getCachedArtifact(
    kind: ArtifactCacheKind,
    sourceRevisionId: string,
    promptVersion: string,
    taxonomyVersion: string
  ): Promise<CachedArtifactRecord | undefined> {
    const cacheKey = buildArtifactCacheKey(kind, sourceRevisionId, promptVersion, taxonomyVersion);
    const cached = this.artifactCache.get(cacheKey);
    if (!cached || !isCacheFresh(cached.expiresAt)) {
      return undefined;
    }
    return {
      ...cached,
      payload: structuredClone(cached.payload)
    };
  }

  async saveCachedArtifact(record: CachedArtifactRecord): Promise<void> {
    this.artifactCache.set(record.cacheKey, {
      ...record,
      payload: structuredClone(record.payload)
    });
  }

  async recordCacheEvent(packId: string, event: CacheEventRecord): Promise<void> {
    const current = this.packs.get(packId);
    if (!current) return;
    this.packs.set(packId, {
      ...current,
      cacheEvents: [
        ...current.cacheEvents,
        {
          ...event,
          recordedAt: event.recordedAt ?? new Date().toISOString()
        }
      ]
    });
  }

  async saveIngestedPack(packId: string, input: string, page: IngestedPage): Promise<void> {
    const current = this.packs.get(packId);
    this.packs.set(packId, {
      id: packId,
      input,
      sourceRevisionId: page.revisionId,
      createdAt: current?.createdAt ?? new Date().toISOString(),
      sections: page.sections.map((section) => ({ ...section })),
      outgoingLinks: page.outgoingLinks.map((link) => ({ ...link })),
      cacheEvents: current?.cacheEvents ?? [],
      summaries: current?.summaries ?? [],
      flashcards: current?.flashcards ?? [],
      quizQuestions: current?.quizQuestions ?? [],
      glossary: current?.glossary ?? [],
      graphNodes: current?.graphNodes ?? [],
      graphEdges: current?.graphEdges ?? [],
      timelineEvents: current?.timelineEvents ?? []
    });
  }

  async saveSummaries(packId: string, summaries: SummaryArtifact[]): Promise<void> {
    const current = this.packs.get(packId);
    if (!current) return;
    this.packs.set(packId, {
      ...current,
      summaries: summaries.map((s) => ({ ...s, citations: [...s.citations] }))
    });
  }

  async saveActiveRecall(packId: string, flashcards: Flashcard[], quizQuestions: QuizQuestion[]): Promise<void> {
    const current = this.packs.get(packId);
    if (!current) return;
    this.packs.set(packId, {
      ...current,
      flashcards: flashcards.map((f) => ({ ...f })),
      quizQuestions: quizQuestions.map((q) => ({ ...q, options: [...q.options], misconceptions: [...(q.misconceptions ?? [])] }))
    });
  }

  async saveGlossary(packId: string, glossary: GlossaryTerm[]): Promise<void> {
    const current = this.packs.get(packId);
    if (!current) return;
    this.packs.set(packId, {
      ...current,
      glossary: glossary.map((term) => ({ ...term }))
    });
  }

  async saveKnowledgeStructure(
    packId: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    timeline: TimelineEvent[]
  ): Promise<void> {
    const current = this.packs.get(packId);
    if (!current) return;
    this.packs.set(packId, {
      ...current,
      graphNodes: nodes.map((n) => ({ ...n })),
      graphEdges: edges.map((e) => ({ ...e })),
      timelineEvents: timeline.map((t) => ({ ...t }))
    });
  }

  async saveQuizAttempt(packId: string, selectedIndices: number[]): Promise<QuizAttemptRecord | undefined> {
    const pack = this.packs.get(packId);
    if (!pack || pack.quizQuestions.length === 0) {
      return undefined;
    }

    if (selectedIndices.length !== pack.quizQuestions.length) {
      return undefined;
    }

    const correctAnswers = pack.quizQuestions.reduce((acc, question, index) => {
      return selectedIndices[index] === question.correctIndex ? acc + 1 : acc;
    }, 0);
    const totalQuestions = pack.quizQuestions.length;
    const attempt: QuizAttemptRecord = {
      id: randomUUID(),
      packId,
      totalQuestions,
      correctAnswers,
      accuracy: correctAnswers / totalQuestions,
      submittedAt: new Date().toISOString()
    };
    this.quizAttempts.push(attempt);
    return attempt;
  }

  async upsertUserProfile(userId: string, displayName?: string): Promise<UserProfileRecord> {
    const now = new Date().toISOString();
    const existing = this.userProfiles.get(userId);
    const next: UserProfileRecord = {
      userId,
      displayName: displayName?.trim() || existing?.displayName || userId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.userProfiles.set(userId, next);
    return { ...next };
  }

  async getUserProfile(userId: string): Promise<UserProfileRecord | undefined> {
    const profile = this.userProfiles.get(userId);
    return profile ? { ...profile } : undefined;
  }

  async createShareLink(ownerUserId: string, packId: string, role: ShareRole): Promise<ShareLinkRecord | undefined> {
    if (!this.packs.has(packId)) {
      return undefined;
    }
    const record: ShareLinkRecord = {
      shareId: randomUUID(),
      packId,
      ownerUserId,
      role,
      createdAt: new Date().toISOString()
    };
    this.shareLinks.set(record.shareId, record);
    return { ...record };
  }

  async getShareLink(shareId: string): Promise<ShareLinkRecord | undefined> {
    const record = this.shareLinks.get(shareId);
    return record ? { ...record } : undefined;
  }

  async recordFlashcardReview(
    userId: string,
    packId: string,
    cardIndex: number,
    rating: FlashcardReviewRating
  ): Promise<FlashcardReviewRecord | undefined> {
    const pack = this.packs.get(packId);
    if (!pack || cardIndex < 0 || cardIndex >= pack.flashcards.length) {
      return undefined;
    }
    const reviewedAtMs = Date.now();
    const record: FlashcardReviewRecord = {
      id: randomUUID(),
      userId,
      packId,
      cardIndex,
      rating,
      reviewedAt: new Date(reviewedAtMs).toISOString(),
      nextDueAt: new Date(reviewedAtMs + reviewIntervalsMs[rating]).toISOString()
    };
    this.flashcardReviews.push(record);
    return { ...record };
  }

  async getLearningProgress(userId: string, packId: string): Promise<LearningProgressRecord | undefined> {
    const pack = this.packs.get(packId);
    if (!pack) {
      return undefined;
    }

    const latestByCard = this.flashcardReviews
      .filter((review) => review.userId === userId && review.packId === packId)
      .sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt))
      .reduce((acc, review) => {
        if (!acc.has(review.cardIndex)) {
          acc.set(review.cardIndex, review);
        }
        return acc;
      }, new Map<number, FlashcardReviewRecord>());
    const now = Date.now();
    const cards = pack.flashcards.map((_, cardIndex) => {
      const review = latestByCard.get(cardIndex);
      return {
        cardIndex,
        reviewed: Boolean(review),
        due: !review || Date.parse(review.nextDueAt) <= now,
        lastRating: review?.rating,
        reviewedAt: review?.reviewedAt,
        nextDueAt: review?.nextDueAt
      };
    });
    const nextDueAt = cards
      .map((card) => card.nextDueAt)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    const score = pack.flashcards.length === 0
      ? 0
      : Array.from(latestByCard.values()).reduce((acc, review) => acc + ratingScore[review.rating], 0) / pack.flashcards.length;

    return {
      userId,
      packId,
      totalCards: pack.flashcards.length,
      reviewedCards: latestByCard.size,
      dueCards: cards.filter((card) => card.due).length,
      masteryScore: Math.max(0, Math.min(1, score)),
      nextDueAt,
      cards
    };
  }

  async recordJobCompletion(sample: JobCompletionSample): Promise<void> {
    this.outcomes.set(sample.jobId, {
      status: 'completed',
      durationMs: sample.durationMs,
      citationRate: sample.citationRate,
      flashcards: sample.flashcards,
      quizQuestions: sample.quizQuestions
    });
  }

  async recordJobFailure(sample: JobFailureSample): Promise<void> {
    this.outcomes.set(sample.jobId, { status: 'failed' });
  }

  async recordStageCost(sample: StageCostSample): Promise<void> {
    this.stageCosts.push({ ...sample, recordedAt: sample.recordedAt ?? new Date().toISOString() });
  }

  async getOutcomesSnapshot(): Promise<OutcomesSnapshot> {
    const outcomeRows = Array.from(this.outcomes.values());
    const completedRows = outcomeRows.filter((row) => row.status === 'completed');
    const completed = completedRows.length;
    const failed = outcomeRows.filter((row) => row.status === 'failed').length;
    const total = completed + failed;

    const byStage = (['ingestion', 'summarization', 'knowledge_structure', 'glossary', 'active_recall'] as const)
      .map((stage) => {
        const rows = this.stageCosts.filter((entry) => entry.stage === stage);
        if (rows.length === 0) {
          return null;
        }
        const totalEstimatedUsd = rows.reduce((acc, entry) => acc + entry.estimatedCostUsd, 0);
        return {
          stage,
          events: rows.length,
          avgTokens: average(rows.map((entry) => entry.estimatedTokens)),
          avgLatencyMs: average(rows.map((entry) => entry.latencyMs)),
          totalEstimatedUsd,
          avgEstimatedUsd: totalEstimatedUsd / rows.length
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const totalEstimatedUsd = this.stageCosts.reduce((acc, entry) => acc + entry.estimatedCostUsd, 0);
    const uniquePackCount = new Set(this.stageCosts.map((entry) => entry.packId)).size;
    const firstArtifactDurations = Array.from(
      this.stageCosts.reduce((acc, entry) => {
        const prior = acc.get(entry.jobId) ?? { ingestionMs: 0, summarizationMs: 0 };
        if (entry.stage === 'ingestion') prior.ingestionMs = entry.latencyMs;
        if (entry.stage === 'summarization') prior.summarizationMs = entry.latencyMs;
        acc.set(entry.jobId, prior);
        return acc;
      }, new Map<string, { ingestionMs: number; summarizationMs: number }>())
    )
      .map(([, stages]) => stages.ingestionMs + stages.summarizationMs)
      .filter((duration) => duration > 0);
    const fullPackDurations = completedRows.map((row) => row.durationMs);
    const citationCoverageRate = average(completedRows.map((row) => row.citationRate));

    return {
      jobs: {
        completed,
        failed,
        avgDurationMs: average(completedRows.map((row) => row.durationMs)),
        completionRate: total === 0 ? 0 : completed / total
      },
      quality: {
        avgCitationRate: citationCoverageRate,
        avgFlashcards: average(completedRows.map((row) => row.flashcards)),
        avgQuizQuestions: average(completedRows.map((row) => row.quizQuestions))
      },
      learning: {
        attempts: this.quizAttempts.length,
        avgAccuracy: average(this.quizAttempts.map((attempt) => attempt.accuracy))
      },
      slo: {
        p95TimeToFirstArtifactMs: percentile(firstArtifactDurations, 0.95),
        p95FullPackCompletionMs: percentile(fullPackDurations, 0.95),
        jobSuccessRate: total === 0 ? 0 : completed / total,
        citationCoverageRate
      },
      cost: {
        totalEstimatedUsd,
        avgEstimatedUsdPerPack: uniquePackCount === 0 ? 0 : totalEstimatedUsd / uniquePackCount,
        byStage
      }
    };
  }

  async getOutcomesMaintenanceSnapshot(): Promise<OutcomesMaintenanceSnapshot> {
    return {
      lastRunAt: null,
      durationMs: 0,
      outcomesPruned: 0,
      quizAttemptsPruned: 0,
      rollupsRefreshed: 0
    };
  }

  async getOperationalMetricsSnapshot(): Promise<OperationalMetricsSnapshot> {
    const completedJobs = Array.from(this.jobs.values()).filter((job) => job.status === 'completed').length;
    const partialJobs = Array.from(this.jobs.values()).filter(
      (job) => job.status === 'completed' && job.degradationState === 'partial'
    ).length;
    const cacheEvents = Array.from(this.packs.values()).flatMap((pack) => pack.cacheEvents);
    const hits = cacheEvents.filter((event) => event.hit).length;
    const events = cacheEvents.length;

    return {
      degradation: {
        completedJobs,
        partialJobs,
        partialRate: completedJobs === 0 ? 0 : partialJobs / completedJobs
      },
      cache: {
        events,
        hits,
        misses: events - hits,
        hitRate: events === 0 ? 0 : hits / events
      }
    };
  }

  async getCostTrendSnapshot(windowHours: number): Promise<CostTrendSnapshot> {
    const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
    const rows = this.stageCosts.filter((entry) => {
      if (!entry.recordedAt) return true;
      return Date.parse(entry.recordedAt) >= cutoff;
    });

    const byStage = (['ingestion', 'summarization', 'knowledge_structure', 'glossary', 'active_recall'] as const)
      .map((stage) => {
        const stageRows = rows.filter((entry) => entry.stage === stage);
        if (stageRows.length === 0) return null;
        const totalEstimatedUsd = stageRows.reduce((acc, entry) => acc + entry.estimatedCostUsd, 0);
        return {
          stage,
          events: stageRows.length,
          avgTokens: average(stageRows.map((entry) => entry.estimatedTokens)),
          avgLatencyMs: average(stageRows.map((entry) => entry.latencyMs)),
          totalEstimatedUsd,
          avgEstimatedUsd: totalEstimatedUsd / stageRows.length
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const byPack = Array.from(
      rows.reduce((acc, entry) => {
        const current = acc.get(entry.packId) ?? { events: 0, estimatedTokens: 0, totalEstimatedUsd: 0 };
        current.events += 1;
        current.estimatedTokens += entry.estimatedTokens;
        current.totalEstimatedUsd += entry.estimatedCostUsd;
        acc.set(entry.packId, current);
        return acc;
      }, new Map<string, { events: number; estimatedTokens: number; totalEstimatedUsd: number }>())
    )
      .map(([packId, entry]) => ({
        packId,
        events: entry.events,
        estimatedTokens: entry.estimatedTokens,
        totalEstimatedUsd: entry.totalEstimatedUsd,
        avgEstimatedUsd: entry.events === 0 ? 0 : entry.totalEstimatedUsd / entry.events
      }))
      .sort((a, b) => b.totalEstimatedUsd - a.totalEstimatedUsd)
      .slice(0, 20);

    const byPromptModel = Array.from(
      rows.reduce((acc, entry) => {
        const key = `${entry.promptVersion}\u0000${entry.model}`;
        const current = acc.get(key) ?? {
          promptVersion: entry.promptVersion,
          model: entry.model,
          events: 0,
          latencyValues: [] as number[],
          estimatedTokens: 0,
          totalEstimatedUsd: 0
        };
        current.events += 1;
        current.latencyValues.push(entry.latencyMs);
        current.estimatedTokens += entry.estimatedTokens;
        current.totalEstimatedUsd += entry.estimatedCostUsd;
        acc.set(key, current);
        return acc;
      }, new Map<string, { promptVersion: string; model: string; events: number; latencyValues: number[]; estimatedTokens: number; totalEstimatedUsd: number }>())
    )
      .map(([, entry]) => ({
        promptVersion: entry.promptVersion,
        model: entry.model,
        events: entry.events,
        avgLatencyMs: average(entry.latencyValues),
        estimatedTokens: entry.estimatedTokens,
        totalEstimatedUsd: entry.totalEstimatedUsd
      }))
      .sort((a, b) => b.totalEstimatedUsd - a.totalEstimatedUsd)
      .slice(0, 20);

    const totalEstimatedUsd = rows.reduce((acc, entry) => acc + entry.estimatedCostUsd, 0);
    const distinctPacks = new Set(rows.map((entry) => entry.packId)).size;

    return {
      windowHours,
      totalEstimatedUsd,
      avgEstimatedUsdPerPack: distinctPacks === 0 ? 0 : totalEstimatedUsd / distinctPacks,
      byStage,
      byPack,
      byPromptModel
    };
  }

  async getPack(packId: string): Promise<PackRecord | undefined> {
    const pack = this.packs.get(packId);
    return pack
      ? {
          ...pack,
          sections: pack.sections.map((s) => ({ ...s })),
          outgoingLinks: pack.outgoingLinks.map((link) => ({ ...link })),
          cacheEvents: pack.cacheEvents.map((event) => ({ ...event })),
          summaries: pack.summaries.map((s) => ({ ...s, citations: [...s.citations] })),
          flashcards: pack.flashcards.map((f) => ({ ...f })),
          quizQuestions: pack.quizQuestions.map((q) => ({ ...q, options: [...q.options], misconceptions: [...(q.misconceptions ?? [])] })),
          glossary: pack.glossary.map((term) => ({ ...term })),
          graphNodes: pack.graphNodes.map((n) => ({ ...n })),
          graphEdges: pack.graphEdges.map((e) => ({ ...e })),
          timelineEvents: pack.timelineEvents.map((t) => ({ ...t }))
        }
      : undefined;
  }

  private buildHistoryItem(
    packId: string,
    pack: PackRecord | undefined,
    latestJob: Job | undefined,
    fallbackDate: string
  ): StudyPackHistoryItem {
    const missingArtifacts: HistoryMissingArtifact[] = pack
      ? getMissingArtifactsForPack(pack)
      : ['summaries', 'graph', 'glossary', 'flashcards', 'quiz'];

    return {
      id: packId,
      input: pack?.input ?? 'Unknown pack',
      sourceRevisionId: pack?.sourceRevisionId ?? 'pending',
      createdAt: pack?.createdAt ?? fallbackDate,
      latestJob: latestJob
        ? {
            id: latestJob.id,
            status: latestJob.status,
            stage: latestJob.stage,
            progress: latestJob.progress,
            updatedAt: new Date(latestJob.heartbeatAt).toISOString(),
            degradationState: latestJob.degradationState,
            degradationReason: latestJob.degradationReason
          }
        : null,
      readiness: {
        status: missingArtifacts.length === 0 ? 'full' : 'partial',
        missingArtifacts,
        canResume: missingArtifacts.length > 0,
        degradationReason: latestJob?.degradationReason
      }
    };
  }

  async listRecentPacksForSession(sessionId: string, limit: number): Promise<StudyPackHistoryItem[]> {
    const latestJobsByPack = Array.from(this.jobs.values())
      .filter((job) => job.sessionId === sessionId)
      .reduce((acc, job) => {
        const current = acc.get(job.packId);
        if (!current || job.heartbeatAt > current.heartbeatAt) {
          acc.set(job.packId, job);
        }
        return acc;
      }, new Map<string, Job>());

    return Array.from(latestJobsByPack.values())
      .sort((a, b) => b.heartbeatAt - a.heartbeatAt)
      .slice(0, Math.max(1, Math.min(limit, 50)))
      .map((job) => this.buildHistoryItem(job.packId, this.packs.get(job.packId), job, new Date(job.heartbeatAt).toISOString()));
  }

  async savePackForUser(userId: string, packId: string): Promise<void> {
    if (!this.packs.has(packId)) {
      return;
    }
    const current = this.savedPacks.get(userId) ?? new Map<string, string>();
    current.set(packId, new Date().toISOString());
    this.savedPacks.set(userId, current);
  }

  async listSavedPacksForUser(userId: string, limit: number): Promise<StudyPackHistoryItem[]> {
    const saved = this.savedPacks.get(userId);
    if (!saved) {
      return [];
    }

    const boundedLimit = Math.max(1, Math.min(limit, 50));
    const rows = Array.from(saved.entries())
      .filter(([packId]) => this.packs.has(packId))
      .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]))
      .slice(0, boundedLimit);

    return Promise.all(
      rows.map(async ([packId, savedAt]) => {
        const latestJob = await this.getLatestJobForPack(packId);
        return this.buildHistoryItem(packId, this.packs.get(packId), latestJob, savedAt);
      })
    );
  }
}

export const memoryRepo = new MemoryRepo();
