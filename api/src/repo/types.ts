import type { IngestedPage, OutgoingLink } from '../domain/ingestion.js';
import type { Job } from '../domain/jobs.js';
import type { Flashcard, QuizQuestion } from '../domain/activeRecall.js';
import type { GlossaryTerm } from '../domain/glossary.js';
import type { GraphEdge, GraphNode, TimelineEvent } from '../domain/knowledgeStructure.js';
import type { SummaryArtifact } from '../domain/summary.js';
import type { ArtifactCacheKind } from '../domain/cachePolicy.js';

export type CachedSourceRecord = {
  cacheKey: string;
  sourceTitle: string;
  sourceRevisionId: string;
  parserVersion: string;
  language: string;
  sections: { heading: string; content: string }[];
  outgoingLinks: OutgoingLink[];
  cachedAt: string;
  expiresAt: string;
};

export type CachedArtifactRecord = {
  cacheKey: string;
  kind: ArtifactCacheKind;
  sourceRevisionId: string;
  promptVersion: string;
  taxonomyVersion: string;
  payload: unknown;
  cachedAt: string;
  expiresAt: string;
};

export type CacheEventRecord = {
  stage: 'source' | ArtifactCacheKind;
  cacheKey: string;
  hit: boolean;
  sourceRevisionId: string;
  parserVersion?: string;
  promptVersion?: string;
  taxonomyVersion?: string;
  cachedAt?: string;
  expiresAt?: string;
  recordedAt?: string;
};

export type PackRecord = {
  id: string;
  input: string;
  sourceRevisionId: string;
  createdAt: string;
  sections: { heading: string; content: string }[];
  outgoingLinks: OutgoingLink[];
  cacheEvents: CacheEventRecord[];
  summaries: SummaryArtifact[];
  flashcards: Flashcard[];
  quizQuestions: QuizQuestion[];
  glossary: GlossaryTerm[];
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  timelineEvents: TimelineEvent[];
};

export type HistoryMissingArtifact = 'summaries' | 'graph' | 'glossary' | 'flashcards' | 'quiz';

export type StudyPackHistoryItem = {
  id: string;
  input: string;
  sourceRevisionId: string;
  createdAt: string;
  latestJob: {
    id: string;
    status: Job['status'];
    stage: Job['stage'];
    progress: number;
    updatedAt: string;
    degradationState: Job['degradationState'];
    degradationReason?: string;
  } | null;
  readiness: {
    status: 'full' | 'partial';
    missingArtifacts: HistoryMissingArtifact[];
    canResume: boolean;
    degradationReason?: string;
  };
};

export type IdempotencyResult = {
  packId: string;
  jobId: string;
  reused: boolean;
};

export type QuizAttemptRecord = {
  id: string;
  packId: string;
  totalQuestions: number;
  correctAnswers: number;
  accuracy: number;
  submittedAt: string;
};

export type JobCompletionSample = {
  jobId: string;
  packId: string;
  durationMs: number;
  citationRate: number;
  flashcards: number;
  quizQuestions: number;
};

export type JobFailureSample = {
  jobId: string;
  packId: string;
};

export type OutcomesSnapshot = {
  jobs: {
    completed: number;
    failed: number;
    avgDurationMs: number;
    completionRate: number;
  };
  quality: {
    avgCitationRate: number;
    avgFlashcards: number;
    avgQuizQuestions: number;
  };
  learning: {
    attempts: number;
    avgAccuracy: number;
  };
  slo: {
    p95TimeToFirstArtifactMs: number;
    p95FullPackCompletionMs: number;
    jobSuccessRate: number;
    citationCoverageRate: number;
  };
  cost: {
    totalEstimatedUsd: number;
    avgEstimatedUsdPerPack: number;
    byStage: StageCostAggregate[];
  };
};

export type CostStage = 'ingestion' | 'summarization' | 'knowledge_structure' | 'glossary' | 'active_recall';

export type StageCostSample = {
  jobId: string;
  packId: string;
  stage: CostStage;
  estimatedTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
  promptVersion: string;
  model: string;
  recordedAt?: string;
};

export type StageCostAggregate = {
  stage: CostStage;
  events: number;
  avgTokens: number;
  avgLatencyMs: number;
  totalEstimatedUsd: number;
  avgEstimatedUsd: number;
};

export type OutcomesMaintenanceSnapshot = {
  lastRunAt: string | null;
  durationMs: number;
  outcomesPruned: number;
  quizAttemptsPruned: number;
  rollupsRefreshed: number;
};

export type OperationalMetricsSnapshot = {
  degradation: {
    completedJobs: number;
    partialJobs: number;
    partialRate: number;
  };
  cache: {
    events: number;
    hits: number;
    misses: number;
    hitRate: number;
  };
};

export type CostTrendSnapshot = {
  windowHours: number;
  totalEstimatedUsd: number;
  avgEstimatedUsdPerPack: number;
  byStage: StageCostAggregate[];
  byPack: Array<{
    packId: string;
    events: number;
    estimatedTokens: number;
    totalEstimatedUsd: number;
    avgEstimatedUsd: number;
  }>;
  byPromptModel: Array<{
    promptVersion: string;
    model: string;
    events: number;
    avgLatencyMs: number;
    estimatedTokens: number;
    totalEstimatedUsd: number;
  }>;
};

export interface AppRepo {
  createOrReuseByIdempotency(key: string, ttlSeconds: number): Promise<IdempotencyResult>;
  createPendingPack(packId: string, input: string): Promise<void>;
  upsertJob(job: Job): Promise<void>;
  getJob(jobId: string): Promise<Job | undefined>;
  listJobs(): Promise<Job[]>;
  claimNextQueuedJob(): Promise<Job | undefined>;
  countQueuedJobs(): Promise<number>;
  countRunningJobs(): Promise<number>;
  countInflightJobsForSession(sessionId: string): Promise<number>;
  countInflightJobsForPack(packId: string): Promise<number>;
  getLatestJobForPack(packId: string): Promise<Job | undefined>;
  getCachedSource(cacheKey: string, parserVersion: string): Promise<CachedSourceRecord | undefined>;
  saveCachedSource(record: CachedSourceRecord): Promise<void>;
  getCachedArtifact(
    kind: ArtifactCacheKind,
    sourceRevisionId: string,
    promptVersion: string,
    taxonomyVersion: string
  ): Promise<CachedArtifactRecord | undefined>;
  saveCachedArtifact(record: CachedArtifactRecord): Promise<void>;
  recordCacheEvent(packId: string, event: CacheEventRecord): Promise<void>;
  saveIngestedPack(packId: string, input: string, page: IngestedPage): Promise<void>;
  saveSummaries(packId: string, summaries: SummaryArtifact[]): Promise<void>;
  saveActiveRecall(packId: string, flashcards: Flashcard[], quizQuestions: QuizQuestion[]): Promise<void>;
  saveGlossary(packId: string, glossary: GlossaryTerm[]): Promise<void>;
  saveKnowledgeStructure(packId: string, nodes: GraphNode[], edges: GraphEdge[], timeline: TimelineEvent[]): Promise<void>;
  saveQuizAttempt(packId: string, selectedIndices: number[]): Promise<QuizAttemptRecord | undefined>;
  recordJobCompletion(sample: JobCompletionSample): Promise<void>;
  recordJobFailure(sample: JobFailureSample): Promise<void>;
  recordStageCost(sample: StageCostSample): Promise<void>;
  getOutcomesSnapshot(): Promise<OutcomesSnapshot>;
  getOutcomesMaintenanceSnapshot(): Promise<OutcomesMaintenanceSnapshot>;
  getOperationalMetricsSnapshot(): Promise<OperationalMetricsSnapshot>;
  getCostTrendSnapshot(windowHours: number): Promise<CostTrendSnapshot>;
  listRecentPacksForSession(sessionId: string, limit: number): Promise<StudyPackHistoryItem[]>;
  savePackForUser(userId: string, packId: string): Promise<void>;
  listSavedPacksForUser(userId: string, limit: number): Promise<StudyPackHistoryItem[]>;
  getPack(packId: string): Promise<PackRecord | undefined>;
}
