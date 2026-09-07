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

export type CacheAdminStaleSource = {
  cacheKey: string;
  sourceTitle: string;
  sourceRevisionId: string;
  parserVersion: string;
  expiresAt: string;
};

export type CacheAdminStaleArtifact = {
  cacheKey: string;
  kind: ArtifactCacheKind;
  sourceRevisionId: string;
  promptVersion: string;
  taxonomyVersion: string;
  expiresAt: string;
};

export type CacheAdminSnapshot = {
  generatedAt: string;
  source: {
    total: number;
    fresh: number;
    expired: number;
  };
  artifacts: {
    total: number;
    fresh: number;
    expired: number;
    byKind: Array<{
      kind: ArtifactCacheKind;
      total: number;
      expired: number;
    }>;
  };
  staleSources: CacheAdminStaleSource[];
  staleArtifacts: CacheAdminStaleArtifact[];
  repairCandidates: number;
};

export type CacheInvalidationTarget = 'expired' | 'source' | 'artifacts' | 'cache_key' | 'all';

export type CacheInvalidationInput = {
  target: CacheInvalidationTarget;
  dryRun: boolean;
  cacheKey?: string;
  kind?: ArtifactCacheKind;
  sourceRevisionId?: string;
  reason?: string;
  requestedAt?: string;
};

export type CacheInvalidationResult = {
  target: CacheInvalidationTarget;
  dryRun: boolean;
  cacheKey?: string;
  kind?: ArtifactCacheKind;
  sourceRevisionId?: string;
  reason?: string;
  requestedAt: string;
  matchedSource: number;
  matchedArtifacts: number;
  deletedSource: number;
  deletedArtifacts: number;
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
  savedAt?: string;
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
  progress?: SavedLibraryProgressSummary;
  organization?: SavedPackOrganization;
};

export type SavedLibraryProgressSummary = {
  totalCards: number;
  reviewedCards: number;
  dueCards: number;
  masteryScore: number;
  nextDueAt?: string;
};

export type SavedPackOrganization = {
  tags: string[];
  collection?: string;
};

export type SavedLibraryReadinessFilter = 'all' | 'full' | 'partial';
export type SavedLibraryProgressFilter = 'all' | 'due' | 'reviewed' | 'not_started';
export type SavedLibrarySort = 'saved_desc' | 'saved_asc' | 'title_asc' | 'title_desc' | 'due_desc' | 'mastery_desc';

export type SavedLibraryQueryOptions = {
  limit: number;
  search?: string;
  readiness?: SavedLibraryReadinessFilter;
  progress?: SavedLibraryProgressFilter;
  sort?: SavedLibrarySort;
  tag?: string;
  collection?: string;
};

export type SavedLibraryFacets = {
  total: number;
  readiness: {
    full: number;
    partial: number;
  };
  progress: {
    due: number;
    reviewed: number;
    notStarted: number;
  };
  tags: Array<{ tag: string; count: number }>;
  collections: Array<{ collection: string; count: number }>;
};

export type SavedLibraryList = {
  items: StudyPackHistoryItem[];
  facets: SavedLibraryFacets;
};

export type SavedPackVersionArtifactCounts = {
  summaries: number;
  glossary: number;
  flashcards: number;
  quizQuestions: number;
  graphNodes: number;
  graphEdges: number;
  timelineEvents: number;
};

export type SavedPackVersionItem = StudyPackHistoryItem & {
  current: boolean;
  sourceRevisionChanged: boolean;
  artifactCounts: SavedPackVersionArtifactCounts;
};

export type SavedPackVersionCompare = {
  baselinePackId?: string;
  baselineSourceRevisionId?: string;
  sourceRevisionChanged: boolean;
  readinessChanged: boolean;
  artifactDeltas: SavedPackVersionArtifactCounts;
  missingArtifactsAdded: HistoryMissingArtifact[];
  missingArtifactsRemoved: HistoryMissingArtifact[];
};

export type SavedPackVersionHistory = {
  current: SavedPackVersionItem;
  versions: SavedPackVersionItem[];
  compare: SavedPackVersionCompare;
};

export type IdempotencyResult = {
  packId: string;
  jobId: string;
  reused: boolean;
};

export type QuizAttemptRecord = {
  id: string;
  userId: string;
  packId: string;
  attemptNumber: number;
  selectedIndices: number[];
  totalQuestions: number;
  correctAnswers: number;
  accuracy: number;
  previousAccuracy?: number;
  accuracyDelta: number;
  cardMasteryScore: number;
  masteryScore: number;
  masteryDelta: number;
  submittedAt: string;
};

export type UserProfileRecord = {
  userId: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
};

export type ShareRole = 'viewer' | 'editor';

export type ShareLinkRecord = {
  shareId: string;
  packId: string;
  ownerUserId: string;
  role: ShareRole;
  createdAt: string;
  tokenHash: string;
  tokenVersion: string;
  expiresAt?: string;
  revokedAt?: string;
};

export type CreateShareLinkInput = {
  shareId: string;
  tokenHash: string;
  tokenVersion: string;
  expiresAt: string;
};

export type FlashcardReviewRating = 'again' | 'hard' | 'good' | 'easy';

export type FlashcardReviewRecord = {
  id: string;
  userId: string;
  packId: string;
  cardIndex: number;
  rating: FlashcardReviewRating;
  reviewedAt: string;
  nextDueAt: string;
};

export type LearningProgressCard = {
  cardIndex: number;
  reviewed: boolean;
  due: boolean;
  lastRating?: FlashcardReviewRating;
  reviewedAt?: string;
  nextDueAt?: string;
};

export type LearningProgressRecord = {
  userId: string;
  packId: string;
  totalCards: number;
  reviewedCards: number;
  dueCards: number;
  masteryScore: number;
  nextDueAt?: string;
  cards: LearningProgressCard[];
};

export type LearningSessionStatus = 'active' | 'completed';

export type LearningSessionOutcomeRecord = {
  completedCards: number;
  remainingCards: number;
  masteryScore: number;
  masteryDelta: number;
};

export type LearningSessionRecord = {
  id: string;
  userId: string;
  packId: string;
  status: LearningSessionStatus;
  startedAt: string;
  completedAt?: string;
  baselineDueCards: number;
  baselineMasteryScore: number;
  reviewedCount: number;
  outcome: LearningSessionOutcomeRecord;
};

export type StudyGoalRecord = {
  userId: string;
  dailyTargetReviews: number;
  createdAt?: string;
  updatedAt?: string;
};

export type GenerationFeedbackArtifactType = 'overall' | 'summaries' | 'flashcards' | 'quiz' | 'glossary' | 'concept_graph';

export type GenerationFeedbackSignal =
  | 'helpful'
  | 'unclear'
  | 'incorrect'
  | 'missing_citation'
  | 'too_shallow'
  | 'unsafe'
  | 'other';

export type CreateGenerationFeedbackInput = {
  userId: string;
  packId: string;
  artifactType: GenerationFeedbackArtifactType;
  artifactId?: string;
  rating: number;
  signal: GenerationFeedbackSignal;
  comment?: string;
  promptVersion?: string;
  model?: string;
};

export type GenerationFeedbackRecord = CreateGenerationFeedbackInput & {
  id: string;
  createdAt: string;
  trustedArtifact: false;
  evalCandidate: true;
};

export type GenerationFeedbackSummary = {
  dataset: 'user_feedback';
  trustedArtifact: false;
  contaminatesGoldenSet: false;
  requiresHumanReview: true;
  totalFeedback: number;
  negativeFeedback: number;
  averageRating: number;
  latestFeedbackAt?: string;
  byArtifact: Array<{
    artifactType: GenerationFeedbackArtifactType;
    totalFeedback: number;
    negativeFeedback: number;
    averageRating: number;
    latestFeedbackAt?: string;
    signals: Array<{
      signal: GenerationFeedbackSignal;
      count: number;
    }>;
  }>;
};

export type UserDataSavedPackRecord = {
  packId: string;
  savedAt: string;
  organization?: SavedPackOrganization;
};

export type UserDataExportRecord = {
  userId: string;
  exportedAt: string;
  profile?: UserProfileRecord;
  library: UserDataSavedPackRecord[];
  shares: ShareLinkRecord[];
  flashcardReviews: FlashcardReviewRecord[];
  learningSessions: LearningSessionRecord[];
  quizAttempts: QuizAttemptRecord[];
  studyGoal?: StudyGoalRecord;
  generationFeedback: GenerationFeedbackRecord[];
};

export type UserDataDeleteResult = {
  userId: string;
  deletedAt: string;
  deleted: {
    profile: boolean;
    library: number;
    shares: number;
    flashcardReviews: number;
    learningSessions: number;
    quizAttempts: number;
    studyGoals: number;
    generationFeedback: number;
  };
};

export type LearningAnalyticsPackSummary = {
  packId: string;
  totalCards: number;
  reviewedCards: number;
  dueCards: number;
  retainedCards: number;
  retentionRate: number;
  masteryScore: number;
  nextDueAt?: string;
  lastReviewedAt?: string;
  quizAttempts: number;
  latestAccuracy?: number;
  accuracyDelta?: number;
};

export type LearningAnalyticsRecord = {
  userId: string;
  generatedAt: string;
  totalCards: number;
  reviewedCards: number;
  dueCards: number;
  duePacks: number;
  streak: {
    currentDays: number;
    longestDays: number;
    lastActivityAt?: string;
  };
  goal: {
    dailyTargetReviews: number;
    reviewsToday: number;
    remainingToday: number;
    targetMet: boolean;
    createdAt?: string;
    updatedAt?: string;
  };
  retention: {
    reviewedCards: number;
    retainedCards: number;
    dueReviewedCards: number;
    retentionRate: number;
  };
  mastery: {
    averageScore: number;
    averageDelta: number;
    trend: Array<{
      source: 'session' | 'quiz';
      packId: string;
      recordedAt: string;
      masteryScore: number;
      masteryDelta: number;
    }>;
  };
  accuracy: {
    attempts: number;
    retakes: number;
    averageAccuracy: number;
    latestAccuracy?: number;
    accuracyDelta: number;
    trend: Array<{
      packId: string;
      attemptNumber: number;
      submittedAt: string;
      accuracy: number;
      accuracyDelta: number;
      masteryScore: number;
    }>;
  };
  packs: LearningAnalyticsPackSummary[];
};

export type UpsertLearningSessionProgressInput = {
  status: LearningSessionStatus;
  reviewedCount: number;
  outcome: LearningSessionOutcomeRecord;
};

export type JobCompletionSample = {
  jobId: string;
  packId: string;
  durationMs: number;
  citationRate: number;
  flashcards: number;
  quizQuestions: number;
  recordedAt?: string;
};

export type JobFailureSample = {
  jobId: string;
  packId: string;
  recordedAt?: string;
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
    retakes: number;
    avgAccuracy: number;
    avgMasteryScore: number;
    avgMasteryDelta: number;
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

export type CostDrilldownFilters = {
  packId?: string;
  promptVersion?: string;
  model?: string;
  stage?: CostStage;
  limit: number;
};

export type CostDrilldownRow = {
  packId: string;
  promptVersion: string;
  model: string;
  stage: CostStage;
  events: number;
  estimatedTokens: number;
  avgTokens: number;
  avgLatencyMs: number;
  totalEstimatedUsd: number;
  avgEstimatedUsd: number;
  firstRecordedAt: string | null;
  lastRecordedAt: string | null;
};

export type CostDrilldownSnapshot = {
  windowHours: number;
  filters: CostDrilldownFilters;
  totalEvents: number;
  totalEstimatedTokens: number;
  totalEstimatedUsd: number;
  avgEstimatedUsd: number;
  avgLatencyMs: number;
  distinctPacks: number;
  rows: CostDrilldownRow[];
};

export interface AppRepo {
  getIdempotency(key: string, ttlSeconds: number): Promise<IdempotencyResult | undefined>;
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
  getCacheAdminSnapshot(nowIso?: string): Promise<CacheAdminSnapshot>;
  invalidateCache(input: CacheInvalidationInput): Promise<CacheInvalidationResult>;
  saveIngestedPack(packId: string, input: string, page: IngestedPage): Promise<void>;
  saveSummaries(packId: string, summaries: SummaryArtifact[]): Promise<void>;
  saveActiveRecall(packId: string, flashcards: Flashcard[], quizQuestions: QuizQuestion[]): Promise<void>;
  saveGlossary(packId: string, glossary: GlossaryTerm[]): Promise<void>;
  saveKnowledgeStructure(packId: string, nodes: GraphNode[], edges: GraphEdge[], timeline: TimelineEvent[]): Promise<void>;
  saveQuizAttempt(
    userId: string,
    packId: string,
    selectedIndices: number[],
    cardMasteryScore: number
  ): Promise<QuizAttemptRecord | undefined>;
  listQuizAttempts(userId: string, packId: string, limit: number): Promise<QuizAttemptRecord[]>;
  upsertUserProfile(userId: string, displayName?: string): Promise<UserProfileRecord>;
  getUserProfile(userId: string): Promise<UserProfileRecord | undefined>;
  exportUserData(userId: string): Promise<UserDataExportRecord>;
  deleteUserData(userId: string): Promise<UserDataDeleteResult>;
  createShareLink(ownerUserId: string, packId: string, role: ShareRole, input: CreateShareLinkInput): Promise<ShareLinkRecord | undefined>;
  getShareLink(shareId: string, tokenHash: string): Promise<ShareLinkRecord | undefined>;
  listShareLinksForOwner(ownerUserId: string, packId: string, limit: number): Promise<ShareLinkRecord[]>;
  revokeShareLink(ownerUserId: string, packId: string, shareId: string, tokenHash: string): Promise<ShareLinkRecord | undefined>;
  recordFlashcardReview(
    userId: string,
    packId: string,
    cardIndex: number,
    rating: FlashcardReviewRating
  ): Promise<FlashcardReviewRecord | undefined>;
  getLearningProgress(userId: string, packId: string): Promise<LearningProgressRecord | undefined>;
  createLearningSession(
    userId: string,
    packId: string,
    baselineDueCards: number,
    baselineMasteryScore: number,
    progress: UpsertLearningSessionProgressInput
  ): Promise<LearningSessionRecord | undefined>;
  getLearningSession(userId: string, packId: string, sessionId: string): Promise<LearningSessionRecord | undefined>;
  updateLearningSessionProgress(
    userId: string,
    packId: string,
    sessionId: string,
    progress: UpsertLearningSessionProgressInput
  ): Promise<LearningSessionRecord | undefined>;
  getStudyGoal(userId: string): Promise<StudyGoalRecord | undefined>;
  upsertStudyGoal(userId: string, dailyTargetReviews: number): Promise<StudyGoalRecord>;
  getLearningAnalytics(userId: string): Promise<LearningAnalyticsRecord>;
  recordGenerationFeedback(input: CreateGenerationFeedbackInput): Promise<GenerationFeedbackRecord | undefined>;
  getGenerationFeedbackSummary(): Promise<GenerationFeedbackSummary>;
  recordJobCompletion(sample: JobCompletionSample): Promise<void>;
  recordJobFailure(sample: JobFailureSample): Promise<void>;
  recordStageCost(sample: StageCostSample): Promise<void>;
  getOutcomesSnapshot(windowHours?: number): Promise<OutcomesSnapshot>;
  getOutcomesMaintenanceSnapshot(): Promise<OutcomesMaintenanceSnapshot>;
  getOperationalMetricsSnapshot(): Promise<OperationalMetricsSnapshot>;
  getCostTrendSnapshot(windowHours: number): Promise<CostTrendSnapshot>;
  getCostDrilldownSnapshot(windowHours: number, filters: CostDrilldownFilters): Promise<CostDrilldownSnapshot>;
  listRecentPacksForSession(sessionId: string, limit: number): Promise<StudyPackHistoryItem[]>;
  savePackForUser(userId: string, packId: string): Promise<void>;
  isPackSavedForUser(userId: string, packId: string): Promise<boolean>;
  listSavedPacksForUser(userId: string, limit: number): Promise<StudyPackHistoryItem[]>;
  listSavedLibraryForUser(userId: string, options: SavedLibraryQueryOptions): Promise<SavedLibraryList>;
  updateSavedPackOrganization(userId: string, packId: string, organization: SavedPackOrganization): Promise<SavedPackOrganization | undefined>;
  getSavedPackVersionHistory(userId: string, packId: string, limit: number): Promise<SavedPackVersionHistory | undefined>;
  getPack(packId: string): Promise<PackRecord | undefined>;
}
