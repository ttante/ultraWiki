import { randomUUID } from 'node:crypto';
import type { Flashcard, QuizQuestion } from '../domain/activeRecall.js';
import type { ArtifactCacheKind } from '../domain/cachePolicy.js';
import { buildArtifactCacheKey, isCacheFresh } from '../domain/cachePolicy.js';
import type { GlossaryTerm } from '../domain/glossary.js';
import { summarizeGenerationFeedback } from '../domain/generationFeedback.js';
import type { IngestedPage } from '../domain/ingestion.js';
import type { Job } from '../domain/jobs.js';
import { computeMasteryScore, isFlashcardDue, scheduleFlashcardReview } from '../domain/learningScheduler.js';
import { buildLearningAnalyticsRecord } from '../domain/learningAnalytics.js';
import { computeQuizMasteryTrend } from '../domain/masteryTrend.js';
import type { GraphEdge, GraphNode, TimelineEvent } from '../domain/knowledgeStructure.js';
import type { SummaryArtifact } from '../domain/summary.js';
import type {
  AppRepo,
  CachedArtifactRecord,
  CachedSourceRecord,
  CacheAdminSnapshot,
  CacheEventRecord,
  CacheInvalidationInput,
  CacheInvalidationResult,
  CostDrilldownFilters,
  CostDrilldownSnapshot,
  CreateGenerationFeedbackInput,
  CreateShareLinkInput,
  FlashcardReviewRating,
  FlashcardReviewRecord,
  GenerationFeedbackRecord,
  GenerationFeedbackSummary,
  IdempotencyResult,
  JobCompletionSample,
  JobFailureSample,
  CostTrendSnapshot,
  HistoryMissingArtifact,
  LearningProgressRecord,
  LearningAnalyticsRecord,
  LearningSessionRecord,
  OperationalMetricsSnapshot,
  OutcomesMaintenanceSnapshot,
  OutcomesSnapshot,
  PackRecord,
  QuizAttemptRecord,
  SavedLibraryList,
  SavedLibraryQueryOptions,
  SavedPackOrganization,
  SavedPackVersionHistory,
  ShareLinkRecord,
  ShareRole,
  StageCostSample,
  StudyGoalRecord,
  StudyPackHistoryItem,
  UpsertLearningSessionProgressInput,
  UserDataDeleteResult,
  UserDataExportRecord,
  UserProfileRecord
} from './types.js';
import { filterAndSortSavedLibrary, normalizeSavedPackOrganization } from './savedLibrary.js';
import {
  artifactCountsForPack,
  buildSavedPackVersionHistory,
  buildSavedPackVersionItem,
  normalizeVersionInput
} from './versionHistory.js';

type JobOutcomeRecord =
  | {
      status: 'completed';
      durationMs: number;
      citationRate: number;
      flashcards: number;
      quizQuestions: number;
      recordedAt: string;
    }
  | {
      status: 'failed';
      recordedAt: string;
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

const clampQueryLimit = (limit: number, fallback = 12, max = 50): number => {
  if (!Number.isFinite(limit)) {
    return fallback;
  }
  return Math.max(1, Math.min(Math.trunc(limit), max));
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
  private savedPackOrganizations = new Map<string, Map<string, SavedPackOrganization>>();
  private userProfiles = new Map<string, UserProfileRecord>();
  private shareLinks = new Map<string, ShareLinkRecord>();
  private flashcardReviews: FlashcardReviewRecord[] = [];
  private learningSessions = new Map<string, LearningSessionRecord>();
  private studyGoals = new Map<string, StudyGoalRecord>();
  private generationFeedback: GenerationFeedbackRecord[] = [];

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
    this.savedPackOrganizations.clear();
    this.userProfiles.clear();
    this.shareLinks.clear();
    this.flashcardReviews = [];
    this.learningSessions.clear();
    this.studyGoals.clear();
    this.generationFeedback = [];
  }

  async getIdempotency(key: string, ttlSeconds: number): Promise<IdempotencyResult | undefined> {
    const now = Date.now();
    const existing = this.idempotency.get(key);
    if (existing && now - existing.createdAt < ttlSeconds * 1000) {
      return { packId: existing.packId, jobId: existing.jobId, reused: true };
    }
    return undefined;
  }

  async createOrReuseByIdempotency(key: string, ttlSeconds: number): Promise<IdempotencyResult> {
    const existing = await this.getIdempotency(key, ttlSeconds);
    if (existing) {
      return existing;
    }

    const now = Date.now();
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

  async getCacheAdminSnapshot(nowIso = new Date().toISOString()): Promise<CacheAdminSnapshot> {
    const nowMs = Date.parse(nowIso);
    const sources = Array.from(this.sourceCache.values());
    const artifacts = Array.from(this.artifactCache.values());
    const sourceExpired = sources.filter((record) => Date.parse(record.expiresAt) <= nowMs);
    const artifactExpired = artifacts.filter((record) => Date.parse(record.expiresAt) <= nowMs);
    const byKind = Array.from(
      artifacts.reduce((acc, record) => {
        const current = acc.get(record.kind) ?? { kind: record.kind, total: 0, expired: 0 };
        current.total += 1;
        if (Date.parse(record.expiresAt) <= nowMs) {
          current.expired += 1;
        }
        acc.set(record.kind, current);
        return acc;
      }, new Map<ArtifactCacheKind, { kind: ArtifactCacheKind; total: number; expired: number }>())
    )
      .map(([, entry]) => entry)
      .sort((left, right) => left.kind.localeCompare(right.kind));

    return {
      generatedAt: nowIso,
      source: {
        total: sources.length,
        fresh: sources.length - sourceExpired.length,
        expired: sourceExpired.length
      },
      artifacts: {
        total: artifacts.length,
        fresh: artifacts.length - artifactExpired.length,
        expired: artifactExpired.length,
        byKind
      },
      staleSources: sourceExpired
        .sort((left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt))
        .slice(0, 10)
        .map((record) => ({
          cacheKey: record.cacheKey,
          sourceTitle: record.sourceTitle,
          sourceRevisionId: record.sourceRevisionId,
          parserVersion: record.parserVersion,
          expiresAt: record.expiresAt
        })),
      staleArtifacts: artifactExpired
        .sort((left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt))
        .slice(0, 10)
        .map((record) => ({
          cacheKey: record.cacheKey,
          kind: record.kind,
          sourceRevisionId: record.sourceRevisionId,
          promptVersion: record.promptVersion,
          taxonomyVersion: record.taxonomyVersion,
          expiresAt: record.expiresAt
        })),
      repairCandidates: sourceExpired.length + artifactExpired.length
    };
  }

  async invalidateCache(input: CacheInvalidationInput): Promise<CacheInvalidationResult> {
    const requestedAt = input.requestedAt ?? new Date().toISOString();
    const nowMs = Date.parse(requestedAt);
    const sourceMatches = Array.from(this.sourceCache.values()).filter((record) => {
      if (input.target === 'artifacts') return false;
      if (input.target === 'expired') return Date.parse(record.expiresAt) <= nowMs;
      if (input.target === 'cache_key') return record.cacheKey === input.cacheKey;
      if (input.target === 'source') {
        return (!input.cacheKey || record.cacheKey === input.cacheKey) && (!input.sourceRevisionId || record.sourceRevisionId === input.sourceRevisionId);
      }
      return input.target === 'all';
    });
    const artifactMatches = Array.from(this.artifactCache.values()).filter((record) => {
      if (input.target === 'source') return false;
      if (input.target === 'expired') return Date.parse(record.expiresAt) <= nowMs;
      if (input.target === 'cache_key') return record.cacheKey === input.cacheKey;
      if (input.target === 'artifacts') {
        return (
          (!input.cacheKey || record.cacheKey === input.cacheKey) &&
          (!input.kind || record.kind === input.kind) &&
          (!input.sourceRevisionId || record.sourceRevisionId === input.sourceRevisionId)
        );
      }
      return input.target === 'all';
    });

    if (!input.dryRun) {
      sourceMatches.forEach((record) => this.sourceCache.delete(record.cacheKey));
      artifactMatches.forEach((record) => this.artifactCache.delete(record.cacheKey));
    }

    return {
      target: input.target,
      dryRun: input.dryRun,
      cacheKey: input.cacheKey,
      kind: input.kind,
      sourceRevisionId: input.sourceRevisionId,
      reason: input.reason,
      requestedAt,
      matchedSource: sourceMatches.length,
      matchedArtifacts: artifactMatches.length,
      deletedSource: input.dryRun ? 0 : sourceMatches.length,
      deletedArtifacts: input.dryRun ? 0 : artifactMatches.length
    };
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

  async saveQuizAttempt(
    userId: string,
    packId: string,
    selectedIndices: number[],
    cardMasteryScore: number
  ): Promise<QuizAttemptRecord | undefined> {
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
    const previousAttempt = this.quizAttempts
      .filter((attempt) => attempt.userId === userId && attempt.packId === packId)
      .sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
    const trend = computeQuizMasteryTrend({
      accuracy: correctAnswers / totalQuestions,
      cardMasteryScore,
      previousAccuracy: previousAttempt?.accuracy,
      previousMasteryScore: previousAttempt?.masteryScore
    });
    const attempt: QuizAttemptRecord = {
      id: randomUUID(),
      userId,
      packId,
      attemptNumber: (previousAttempt?.attemptNumber ?? 0) + 1,
      selectedIndices: [...selectedIndices],
      totalQuestions,
      correctAnswers,
      accuracy: correctAnswers / totalQuestions,
      previousAccuracy: previousAttempt?.accuracy,
      accuracyDelta: trend.accuracyDelta,
      cardMasteryScore,
      masteryScore: trend.masteryScore,
      masteryDelta: trend.masteryDelta,
      submittedAt: new Date().toISOString()
    };
    this.quizAttempts.push(attempt);
    return { ...attempt, selectedIndices: [...attempt.selectedIndices] };
  }

  async listQuizAttempts(userId: string, packId: string, limit: number): Promise<QuizAttemptRecord[]> {
    const boundedLimit = clampQueryLimit(limit);
    return this.quizAttempts
      .filter((attempt) => attempt.userId === userId && attempt.packId === packId)
      .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt) || b.attemptNumber - a.attemptNumber)
      .slice(0, boundedLimit)
      .map((attempt) => ({ ...attempt, selectedIndices: [...attempt.selectedIndices] }));
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

  async exportUserData(userId: string): Promise<UserDataExportRecord> {
    const saved = this.savedPacks.get(userId);
    return {
      userId,
      exportedAt: new Date().toISOString(),
      profile: await this.getUserProfile(userId),
      library: saved
        ? Array.from(saved.entries())
            .map(([packId, savedAt]) => ({ packId, savedAt, organization: this.savedPackOrganizations.get(userId)?.get(packId) }))
            .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
        : [],
      shares: Array.from(this.shareLinks.values())
        .filter((share) => share.ownerUserId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((share) => ({ ...share })),
      flashcardReviews: this.flashcardReviews
        .filter((review) => review.userId === userId)
        .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt) || a.cardIndex - b.cardIndex)
        .map((review) => ({ ...review })),
      learningSessions: Array.from(this.learningSessions.values())
        .filter((session) => session.userId === userId)
        .sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt))
        .map((session) => ({ ...session, outcome: { ...session.outcome } })),
      quizAttempts: this.quizAttempts
        .filter((attempt) => attempt.userId === userId)
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.attemptNumber - a.attemptNumber)
        .map((attempt) => ({ ...attempt, selectedIndices: [...attempt.selectedIndices] })),
      studyGoal: await this.getStudyGoal(userId),
      generationFeedback: this.generationFeedback
        .filter((feedback) => feedback.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((feedback) => ({ ...feedback }))
    };
  }

  async deleteUserData(userId: string): Promise<UserDataDeleteResult> {
    const profileDeleted = this.userProfiles.delete(userId);
    const libraryDeleted = this.savedPacks.get(userId)?.size ?? 0;
    this.savedPacks.delete(userId);
    this.savedPackOrganizations.delete(userId);

    let sharesDeleted = 0;
    for (const [shareId, share] of this.shareLinks.entries()) {
      if (share.ownerUserId === userId) {
        this.shareLinks.delete(shareId);
        sharesDeleted += 1;
      }
    }

    const flashcardReviewsBefore = this.flashcardReviews.length;
    this.flashcardReviews = this.flashcardReviews.filter((review) => review.userId !== userId);
    const quizAttemptsBefore = this.quizAttempts.length;
    this.quizAttempts = this.quizAttempts.filter((attempt) => attempt.userId !== userId);
    const generationFeedbackBefore = this.generationFeedback.length;
    this.generationFeedback = this.generationFeedback.filter((feedback) => feedback.userId !== userId);

    let learningSessionsDeleted = 0;
    for (const [sessionId, session] of this.learningSessions.entries()) {
      if (session.userId === userId) {
        this.learningSessions.delete(sessionId);
        learningSessionsDeleted += 1;
      }
    }

    const studyGoalsDeleted = this.studyGoals.delete(userId) ? 1 : 0;

    return {
      userId,
      deletedAt: new Date().toISOString(),
      deleted: {
        profile: profileDeleted,
        library: libraryDeleted,
        shares: sharesDeleted,
        flashcardReviews: flashcardReviewsBefore - this.flashcardReviews.length,
        learningSessions: learningSessionsDeleted,
        quizAttempts: quizAttemptsBefore - this.quizAttempts.length,
        studyGoals: studyGoalsDeleted,
        generationFeedback: generationFeedbackBefore - this.generationFeedback.length
      }
    };
  }

  async recordGenerationFeedback(input: CreateGenerationFeedbackInput): Promise<GenerationFeedbackRecord | undefined> {
    if (!this.packs.has(input.packId)) {
      return undefined;
    }

    const record: GenerationFeedbackRecord = {
      ...input,
      comment: input.comment?.trim() || undefined,
      promptVersion: input.promptVersion?.trim() || undefined,
      model: input.model?.trim() || undefined,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      trustedArtifact: false,
      evalCandidate: true
    };
    this.generationFeedback.push(record);
    return { ...record };
  }

  async getGenerationFeedbackSummary(): Promise<GenerationFeedbackSummary> {
    return summarizeGenerationFeedback(this.generationFeedback);
  }

  async createShareLink(
    ownerUserId: string,
    packId: string,
    role: ShareRole,
    input: CreateShareLinkInput
  ): Promise<ShareLinkRecord | undefined> {
    if (!this.packs.has(packId)) {
      return undefined;
    }
    const record: ShareLinkRecord = {
      shareId: input.shareId,
      packId,
      ownerUserId,
      role,
      createdAt: new Date().toISOString(),
      tokenHash: input.tokenHash,
      tokenVersion: input.tokenVersion,
      expiresAt: input.expiresAt
    };
    this.shareLinks.set(record.shareId, record);
    return { ...record };
  }

  async getShareLink(shareId: string, tokenHash: string): Promise<ShareLinkRecord | undefined> {
    const record = this.shareLinks.get(shareId);
    if (!record || record.tokenHash !== tokenHash || record.revokedAt) {
      return undefined;
    }
    if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) {
      return undefined;
    }
    return record ? { ...record } : undefined;
  }

  async listShareLinksForOwner(ownerUserId: string, packId: string, limit: number): Promise<ShareLinkRecord[]> {
    const boundedLimit = clampQueryLimit(limit);
    return Array.from(this.shareLinks.values())
      .filter((share) =>
        share.ownerUserId === ownerUserId &&
        share.packId === packId &&
        !share.revokedAt &&
        (!share.expiresAt || Date.parse(share.expiresAt) > Date.now())
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, boundedLimit)
      .map((share) => ({ ...share }));
  }

  async revokeShareLink(ownerUserId: string, packId: string, shareId: string, tokenHash: string): Promise<ShareLinkRecord | undefined> {
    const record = this.shareLinks.get(shareId);
    if (!record || record.ownerUserId !== ownerUserId || record.packId !== packId || record.tokenHash !== tokenHash || record.revokedAt) {
      return undefined;
    }
    const revoked = {
      ...record,
      revokedAt: new Date().toISOString()
    };
    this.shareLinks.set(shareId, revoked);
    return { ...revoked };
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
    const scheduled = scheduleFlashcardReview(rating);
    const record: FlashcardReviewRecord = {
      id: randomUUID(),
      userId,
      packId,
      cardIndex,
      rating,
      reviewedAt: scheduled.reviewedAt,
      nextDueAt: scheduled.nextDueAt
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
    const now = new Date();
    const cards = pack.flashcards.map((_, cardIndex) => {
      const review = latestByCard.get(cardIndex);
      return {
        cardIndex,
        reviewed: Boolean(review),
        due: isFlashcardDue(review?.nextDueAt, now),
        lastRating: review?.rating,
        reviewedAt: review?.reviewedAt,
        nextDueAt: review?.nextDueAt
      };
    });
    const nextDueAt = cards
      .map((card) => card.nextDueAt)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    const score = computeMasteryScore(
      Array.from(latestByCard.values()).map((review) => review.rating),
      pack.flashcards.length
    );

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

  async createLearningSession(
    userId: string,
    packId: string,
    baselineDueCards: number,
    baselineMasteryScore: number,
    progress: UpsertLearningSessionProgressInput
  ): Promise<LearningSessionRecord | undefined> {
    if (!this.packs.has(packId)) {
      return undefined;
    }
    const now = new Date().toISOString();
    const record: LearningSessionRecord = {
      id: randomUUID(),
      userId,
      packId,
      status: progress.status,
      startedAt: now,
      completedAt: progress.status === 'completed' ? now : undefined,
      baselineDueCards,
      baselineMasteryScore,
      reviewedCount: progress.reviewedCount,
      outcome: { ...progress.outcome }
    };
    this.learningSessions.set(record.id, record);
    return { ...record, outcome: { ...record.outcome } };
  }

  async getLearningSession(userId: string, packId: string, sessionId: string): Promise<LearningSessionRecord | undefined> {
    const record = this.learningSessions.get(sessionId);
    if (!record || record.userId !== userId || record.packId !== packId) {
      return undefined;
    }
    return { ...record, outcome: { ...record.outcome } };
  }

  async updateLearningSessionProgress(
    userId: string,
    packId: string,
    sessionId: string,
    progress: UpsertLearningSessionProgressInput
  ): Promise<LearningSessionRecord | undefined> {
    const record = this.learningSessions.get(sessionId);
    if (!record || record.userId !== userId || record.packId !== packId) {
      return undefined;
    }
    const completedAt = progress.status === 'completed' ? record.completedAt ?? new Date().toISOString() : record.completedAt;
    const updated: LearningSessionRecord = {
      ...record,
      status: progress.status,
      completedAt,
      reviewedCount: progress.reviewedCount,
      outcome: { ...progress.outcome }
    };
    this.learningSessions.set(sessionId, updated);
    return { ...updated, outcome: { ...updated.outcome } };
  }

  async getStudyGoal(userId: string): Promise<StudyGoalRecord | undefined> {
    const goal = this.studyGoals.get(userId);
    return goal ? { ...goal } : undefined;
  }

  async upsertStudyGoal(userId: string, dailyTargetReviews: number): Promise<StudyGoalRecord> {
    const existing = this.studyGoals.get(userId);
    const now = new Date().toISOString();
    const goal: StudyGoalRecord = {
      userId,
      dailyTargetReviews: Math.max(0, Math.min(200, Math.trunc(dailyTargetReviews))),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.studyGoals.set(userId, goal);
    return { ...goal };
  }

  async getLearningAnalytics(userId: string): Promise<LearningAnalyticsRecord> {
    const saved = this.savedPacks.get(userId);
    const packs = saved
      ? Array.from(saved.keys())
          .map((packId) => {
            const pack = this.packs.get(packId);
            return pack ? { packId, totalCards: pack.flashcards.length } : undefined;
          })
          .filter((pack): pack is { packId: string; totalCards: number } => Boolean(pack))
      : [];
    const savedPackIds = new Set(packs.map((pack) => pack.packId));
    const reviews = this.flashcardReviews.filter((review) => review.userId === userId && savedPackIds.has(review.packId));
    const quizAttempts = this.quizAttempts
      .filter((attempt) => attempt.userId === userId && savedPackIds.has(attempt.packId))
      .map((attempt) => ({ ...attempt, selectedIndices: [...attempt.selectedIndices] }));
    const sessions = Array.from(this.learningSessions.values())
      .filter((session) => session.userId === userId && savedPackIds.has(session.packId))
      .map((session) => ({ ...session, outcome: { ...session.outcome } }));

    return buildLearningAnalyticsRecord(userId, packs, reviews, quizAttempts, sessions, this.studyGoals.get(userId));
  }

  async recordJobCompletion(sample: JobCompletionSample): Promise<void> {
    this.outcomes.set(sample.jobId, {
      status: 'completed',
      durationMs: sample.durationMs,
      citationRate: sample.citationRate,
      flashcards: sample.flashcards,
      quizQuestions: sample.quizQuestions,
      recordedAt: sample.recordedAt ?? new Date().toISOString()
    });
  }

  async recordJobFailure(sample: JobFailureSample): Promise<void> {
    this.outcomes.set(sample.jobId, { status: 'failed', recordedAt: sample.recordedAt ?? new Date().toISOString() });
  }

  async recordStageCost(sample: StageCostSample): Promise<void> {
    this.stageCosts.push({ ...sample, recordedAt: sample.recordedAt ?? new Date().toISOString() });
  }

  async getOutcomesSnapshot(windowHours?: number): Promise<OutcomesSnapshot> {
    const cutoff = typeof windowHours === 'number' ? Date.now() - windowHours * 60 * 60 * 1000 : undefined;
    const inWindow = (value?: string): boolean => cutoff === undefined || !value || Date.parse(value) >= cutoff;
    const outcomeRows = Array.from(this.outcomes.values()).filter((row) => inWindow(row.recordedAt));
    const completedRows = outcomeRows.filter((row) => row.status === 'completed');
    const completed = completedRows.length;
    const failed = outcomeRows.filter((row) => row.status === 'failed').length;
    const total = completed + failed;
    const stageCostRows = this.stageCosts.filter((entry) => inWindow(entry.recordedAt));
    const quizAttemptRows = this.quizAttempts.filter((attempt) => inWindow(attempt.submittedAt));

    const byStage = (['ingestion', 'summarization', 'knowledge_structure', 'glossary', 'active_recall'] as const)
      .map((stage) => {
        const rows = stageCostRows.filter((entry) => entry.stage === stage);
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
    const totalEstimatedUsd = stageCostRows.reduce((acc, entry) => acc + entry.estimatedCostUsd, 0);
    const uniquePackCount = new Set(stageCostRows.map((entry) => entry.packId)).size;
    const firstArtifactDurations = Array.from(
      stageCostRows.reduce((acc, entry) => {
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
        attempts: quizAttemptRows.length,
        retakes: quizAttemptRows.filter((attempt) => attempt.attemptNumber > 1).length,
        avgAccuracy: average(quizAttemptRows.map((attempt) => attempt.accuracy)),
        avgMasteryScore: average(quizAttemptRows.map((attempt) => attempt.masteryScore)),
        avgMasteryDelta: average(quizAttemptRows.map((attempt) => attempt.masteryDelta))
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

  async getCostDrilldownSnapshot(windowHours: number, filters: CostDrilldownFilters): Promise<CostDrilldownSnapshot> {
    const boundedFilters = { ...filters, limit: clampQueryLimit(filters.limit, 50) };
    const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
    const rows = this.stageCosts.filter((entry) => {
      const inWindow = !entry.recordedAt || Date.parse(entry.recordedAt) >= cutoff;
      if (!inWindow) return false;
      if (boundedFilters.packId && entry.packId !== boundedFilters.packId) return false;
      if (boundedFilters.promptVersion && entry.promptVersion !== boundedFilters.promptVersion) return false;
      if (boundedFilters.model && entry.model !== boundedFilters.model) return false;
      if (boundedFilters.stage && entry.stage !== boundedFilters.stage) return false;
      return true;
    });

    type DrilldownGroup = {
      packId: string;
      promptVersion: string;
      model: string;
      stage: StageCostSample['stage'];
      events: number;
      tokenValues: number[];
      latencyValues: number[];
      estimatedTokens: number;
      totalEstimatedUsd: number;
      firstRecordedAt: string | null;
      lastRecordedAt: string | null;
    };

    const grouped = rows.reduce((acc, entry) => {
      const key = `${entry.packId}\u0000${entry.promptVersion}\u0000${entry.model}\u0000${entry.stage}`;
      const current =
        acc.get(key) ??
        ({
          packId: entry.packId,
          promptVersion: entry.promptVersion,
          model: entry.model,
          stage: entry.stage,
          events: 0,
          tokenValues: [],
          latencyValues: [],
          estimatedTokens: 0,
          totalEstimatedUsd: 0,
          firstRecordedAt: null,
          lastRecordedAt: null
        } satisfies DrilldownGroup);

      current.events += 1;
      current.tokenValues.push(entry.estimatedTokens);
      current.latencyValues.push(entry.latencyMs);
      current.estimatedTokens += entry.estimatedTokens;
      current.totalEstimatedUsd += entry.estimatedCostUsd;
      if (entry.recordedAt) {
        if (!current.firstRecordedAt || Date.parse(entry.recordedAt) < Date.parse(current.firstRecordedAt)) {
          current.firstRecordedAt = entry.recordedAt;
        }
        if (!current.lastRecordedAt || Date.parse(entry.recordedAt) > Date.parse(current.lastRecordedAt)) {
          current.lastRecordedAt = entry.recordedAt;
        }
      }
      acc.set(key, current);
      return acc;
    }, new Map<string, DrilldownGroup>());

    const totalEstimatedUsd = rows.reduce((acc, entry) => acc + entry.estimatedCostUsd, 0);
    const totalEvents = rows.length;

    return {
      windowHours,
      filters: boundedFilters,
      totalEvents,
      totalEstimatedTokens: rows.reduce((acc, entry) => acc + entry.estimatedTokens, 0),
      totalEstimatedUsd,
      avgEstimatedUsd: totalEvents === 0 ? 0 : totalEstimatedUsd / totalEvents,
      avgLatencyMs: average(rows.map((entry) => entry.latencyMs)),
      distinctPacks: new Set(rows.map((entry) => entry.packId)).size,
      rows: Array.from(grouped.values())
        .map((entry) => ({
          packId: entry.packId,
          promptVersion: entry.promptVersion,
          model: entry.model,
          stage: entry.stage,
          events: entry.events,
          estimatedTokens: entry.estimatedTokens,
          avgTokens: average(entry.tokenValues),
          avgLatencyMs: average(entry.latencyValues),
          totalEstimatedUsd: entry.totalEstimatedUsd,
          avgEstimatedUsd: entry.events === 0 ? 0 : entry.totalEstimatedUsd / entry.events,
          firstRecordedAt: entry.firstRecordedAt,
          lastRecordedAt: entry.lastRecordedAt
        }))
        .sort((a, b) => b.totalEstimatedUsd - a.totalEstimatedUsd || b.events - a.events || a.packId.localeCompare(b.packId))
        .slice(0, boundedFilters.limit)
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
      .slice(0, clampQueryLimit(limit))
      .map((job) => this.buildHistoryItem(job.packId, this.packs.get(job.packId), job, new Date(job.heartbeatAt).toISOString()));
  }

  async savePackForUser(userId: string, packId: string): Promise<void> {
    if (!this.packs.has(packId)) {
      return;
    }
    const current = this.savedPacks.get(userId) ?? new Map<string, string>();
    current.set(packId, new Date().toISOString());
    this.savedPacks.set(userId, current);
    const organization = this.savedPackOrganizations.get(userId) ?? new Map<string, SavedPackOrganization>();
    if (!organization.has(packId)) {
      organization.set(packId, { tags: [] });
    }
    this.savedPackOrganizations.set(userId, organization);
  }

  async isPackSavedForUser(userId: string, packId: string): Promise<boolean> {
    return this.savedPacks.get(userId)?.has(packId) ?? false;
  }

  async listSavedPacksForUser(userId: string, limit: number): Promise<StudyPackHistoryItem[]> {
    return (await this.listSavedLibraryForUser(userId, { limit })).items;
  }

  async listSavedLibraryForUser(userId: string, options: SavedLibraryQueryOptions): Promise<SavedLibraryList> {
    const saved = this.savedPacks.get(userId);
    if (!saved) {
      return {
        items: [],
        facets: {
          total: 0,
          readiness: { full: 0, partial: 0 },
          progress: { due: 0, reviewed: 0, notStarted: 0 },
          tags: [],
          collections: []
        }
      };
    }

    const rows = await Promise.all(
      Array.from(saved.entries())
        .filter(([packId]) => this.packs.has(packId))
        .map(async ([packId, savedAt]) => {
          const latestJob = await this.getLatestJobForPack(packId);
          const progress = await this.getLearningProgress(userId, packId);
          const item = this.buildHistoryItem(packId, this.packs.get(packId), latestJob, savedAt);
          const organization = this.savedPackOrganizations.get(userId)?.get(packId) ?? { tags: [] };
          return {
            ...item,
            savedAt,
            organization: {
              tags: [...organization.tags],
              collection: organization.collection
            },
            progress: progress
              ? {
                  totalCards: progress.totalCards,
                  reviewedCards: progress.reviewedCards,
                  dueCards: progress.dueCards,
                  masteryScore: progress.masteryScore,
                  nextDueAt: progress.nextDueAt
                }
              : undefined
          };
        })
    );

    return filterAndSortSavedLibrary(rows, options);
  }

  async updateSavedPackOrganization(
    userId: string,
    packId: string,
    organization: SavedPackOrganization
  ): Promise<SavedPackOrganization | undefined> {
    if (!this.savedPacks.get(userId)?.has(packId)) {
      return undefined;
    }
    const normalized = normalizeSavedPackOrganization(organization);
    const current = this.savedPackOrganizations.get(userId) ?? new Map<string, SavedPackOrganization>();
    current.set(packId, normalized);
    this.savedPackOrganizations.set(userId, current);
    return {
      tags: [...normalized.tags],
      collection: normalized.collection
    };
  }

  async getSavedPackVersionHistory(
    userId: string,
    packId: string,
    limit: number
  ): Promise<SavedPackVersionHistory | undefined> {
    const saved = this.savedPacks.get(userId);
    const currentPack = this.packs.get(packId);
    if (!saved?.has(packId) || !currentPack) {
      return undefined;
    }
    const currentInput = normalizeVersionInput(currentPack.input);
    const rows = await Promise.all(
      Array.from(saved.entries())
        .filter(([candidatePackId]) => {
          const candidatePack = this.packs.get(candidatePackId);
          return candidatePack ? normalizeVersionInput(candidatePack.input) === currentInput : false;
        })
        .map(async ([candidatePackId, savedAt]) => {
          const pack = this.packs.get(candidatePackId);
          if (!pack) {
            return undefined;
          }
          const latestJob = await this.getLatestJobForPack(candidatePackId);
          const item = {
            ...this.buildHistoryItem(candidatePackId, pack, latestJob, savedAt),
            savedAt
          };
          return buildSavedPackVersionItem(
            item,
            artifactCountsForPack(pack),
            packId,
            currentPack.sourceRevisionId
          );
        })
    );

    return buildSavedPackVersionHistory(
      rows.filter((item): item is NonNullable<typeof item> => Boolean(item)),
      packId,
      limit
    );
  }
}

export const memoryRepo = new MemoryRepo();
