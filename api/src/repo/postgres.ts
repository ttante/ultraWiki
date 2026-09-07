import { randomUUID } from 'node:crypto';
import type { Flashcard, QuizQuestion } from '../domain/activeRecall.js';
import type { ArtifactCacheKind } from '../domain/cachePolicy.js';
import type { GlossaryTerm } from '../domain/glossary.js';
import { emptyGenerationFeedbackSummary } from '../domain/generationFeedback.js';
import type { IngestedPage } from '../domain/ingestion.js';
import type { Job } from '../domain/jobs.js';
import { buildLearningAnalyticsRecord, type LearningAnalyticsReviewInput } from '../domain/learningAnalytics.js';
import { computeMasteryScore, isFlashcardDue, scheduleFlashcardReview } from '../domain/learningScheduler.js';
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
  CostTrendSnapshot,
  CreateGenerationFeedbackInput,
  CreateShareLinkInput,
  FlashcardReviewRating,
  FlashcardReviewRecord,
  GenerationFeedbackRecord,
  GenerationFeedbackSignal,
  GenerationFeedbackSummary,
  HistoryMissingArtifact,
  IdempotencyResult,
  JobCompletionSample,
  JobFailureSample,
  LearningAnalyticsRecord,
  LearningProgressRecord,
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
import { normalizeSavedLibraryQuery, normalizeSavedPackOrganization } from './savedLibrary.js';
import { buildSavedPackVersionHistory, buildSavedPackVersionItem } from './versionHistory.js';

type PgQueryClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type PgTransactionClient = PgQueryClient & {
  release: () => void;
};

export type PgClient = PgQueryClient & {
  connect?: () => Promise<PgTransactionClient>;
};

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const affectedRows = (result: { rows: any[]; rowCount: number | null }): number => result.rowCount ?? result.rows.length;

const normalizeDbTextArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

const parseJsonFacetArray = <K extends string>(value: unknown, key: K): Array<Record<K, string> & { count: number }> => {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .map((item) => ({
      [key]: typeof item?.[key] === 'string' ? item[key] : '',
      count: Number(item?.count ?? 0)
    }) as Record<K, string> & { count: number })
    .filter((item) => item[key].length > 0 && item.count > 0);
};

const buildCacheInvalidationWhere = (
  input: CacheInvalidationInput,
  table: 'source' | 'artifact',
  requestedAt: string
): { where: string; params: unknown[] } => {
  if (table === 'source' && input.target === 'artifacts') {
    return { where: 'FALSE', params: [] };
  }
  if (table === 'artifact' && input.target === 'source') {
    return { where: 'FALSE', params: [] };
  }
  if (input.target === 'all') {
    return { where: 'TRUE', params: [] };
  }
  if (input.target === 'expired') {
    return { where: 'expires_at <= $1', params: [requestedAt] };
  }
  if (input.target === 'cache_key') {
    return { where: 'cache_key = $1', params: [input.cacheKey] };
  }

  const clauses: string[] = [];
  const params: unknown[] = [];
  const addParam = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (input.cacheKey) {
    clauses.push(`cache_key = ${addParam(input.cacheKey)}`);
  }
  if (input.sourceRevisionId) {
    clauses.push(`source_revision_id = ${addParam(input.sourceRevisionId)}`);
  }
  if (table === 'artifact' && input.kind) {
    clauses.push(`kind = ${addParam(input.kind)}`);
  }

  return { where: clauses.length > 0 ? clauses.join(' AND ') : 'TRUE', params };
};

const clampQueryLimit = (limit: number, fallback = 12, max = 50): number => {
  if (!Number.isFinite(limit)) {
    return fallback;
  }
  return Math.max(1, Math.min(Math.trunc(limit), max));
};

const fromDbJob = (row: any): Job => ({
  id: row.id,
  packId: row.pack_id,
  sessionId: row.session_id,
  stage: row.stage as Job['stage'],
  status: row.status,
  progress: Number(row.progress),
  attempt: Number(row.attempt),
  retryState: row.retry_state,
  degradationState: row.degradation_state,
  degradationReason: row.degradation_reason ?? undefined,
  errors: Array.isArray(row.errors) ? row.errors : [],
  heartbeatAt: new Date(row.heartbeat_at).getTime()
});

const fromDbUserProfile = (row: any): UserProfileRecord => ({
  userId: row.user_id,
  displayName: row.display_name,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString()
});

const fromDbShareLink = (row: any): ShareLinkRecord => ({
  shareId: row.share_id,
  packId: row.pack_id,
  ownerUserId: row.owner_user_id,
  role: row.role,
  createdAt: new Date(row.created_at).toISOString(),
  tokenHash: row.token_hash,
  tokenVersion: row.token_version,
  expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : undefined,
  revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : undefined
});

const fromDbFlashcardReview = (row: any): FlashcardReviewRecord => ({
  id: row.id,
  userId: row.user_id,
  packId: row.pack_id,
  cardIndex: Number(row.card_index),
  rating: row.rating,
  reviewedAt: new Date(row.reviewed_at).toISOString(),
  nextDueAt: new Date(row.next_due_at).toISOString()
});

const fromDbLearningSession = (row: any): LearningSessionRecord => ({
  id: row.id,
  userId: row.user_id,
  packId: row.pack_id,
  status: row.status,
  startedAt: new Date(row.started_at).toISOString(),
  completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : undefined,
  baselineDueCards: Number(row.baseline_due_cards),
  baselineMasteryScore: toNumber(row.baseline_mastery_score),
  reviewedCount: Number(row.reviewed_count),
  outcome: {
    completedCards: Number(row.outcome?.completedCards ?? 0),
    remainingCards: Number(row.outcome?.remainingCards ?? 0),
    masteryScore: toNumber(row.outcome?.masteryScore),
    masteryDelta: toNumber(row.outcome?.masteryDelta)
  }
});

const fromDbStudyGoal = (row: any): StudyGoalRecord => ({
  userId: row.user_id,
  dailyTargetReviews: Number(row.daily_target_reviews ?? 0),
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined
});

const fromDbGenerationFeedback = (row: any): GenerationFeedbackRecord => ({
  id: row.id,
  userId: row.user_id,
  packId: row.pack_id,
  artifactType: row.artifact_type,
  artifactId: row.artifact_id ?? undefined,
  rating: Number(row.rating),
  signal: row.signal,
  comment: row.comment ?? undefined,
  promptVersion: row.prompt_version ?? undefined,
  model: row.model ?? undefined,
  createdAt: new Date(row.created_at).toISOString(),
  trustedArtifact: false,
  evalCandidate: true
});

const fromDbQuizAttempt = (row: any): QuizAttemptRecord => ({
  id: row.id,
  userId: row.user_id,
  packId: row.pack_id,
  attemptNumber: Number(row.attempt_number),
  selectedIndices: Array.isArray(row.selected_indices) ? row.selected_indices.map((value: unknown) => Number(value)) : [],
  totalQuestions: Number(row.total_questions),
  correctAnswers: Number(row.correct_answers),
  accuracy: toNumber(row.accuracy),
  previousAccuracy: row.previous_accuracy === null || row.previous_accuracy === undefined ? undefined : toNumber(row.previous_accuracy),
  accuracyDelta: toNumber(row.accuracy_delta),
  cardMasteryScore: toNumber(row.card_mastery_score),
  masteryScore: toNumber(row.mastery_score),
  masteryDelta: toNumber(row.mastery_delta),
  submittedAt: new Date(row.submitted_at).toISOString()
});

const missingArtifactsFromCounts = (counts: {
  summaries: number;
  graphNodes: number;
  graphEdges: number;
  timelineEvents: number;
  glossary: number;
  flashcards: number;
  quizQuestions: number;
}): HistoryMissingArtifact[] => {
  const missing: HistoryMissingArtifact[] = [];
  if (counts.summaries === 0) missing.push('summaries');
  if (counts.graphNodes === 0 && counts.graphEdges === 0 && counts.timelineEvents === 0) missing.push('graph');
  if (counts.glossary === 0) missing.push('glossary');
  if (counts.flashcards === 0) missing.push('flashcards');
  if (counts.quizQuestions === 0) missing.push('quiz');
  return missing;
};

const historyItemFromRow = (row: any): StudyPackHistoryItem => {
  const missingArtifacts = missingArtifactsFromCounts({
    summaries: Number(row.summary_count ?? 0),
    graphNodes: Number(row.graph_node_count ?? 0),
    graphEdges: Number(row.graph_edge_count ?? 0),
    timelineEvents: Number(row.timeline_count ?? 0),
    glossary: Number(row.glossary_count ?? 0),
    flashcards: Number(row.flashcard_count ?? 0),
    quizQuestions: Number(row.quiz_count ?? 0)
  });

  return {
    id: row.id,
    input: row.input,
    sourceRevisionId: row.source_revision_id,
    createdAt: new Date(row.created_at).toISOString(),
    latestJob: row.job_id
      ? {
          id: row.job_id,
          status: row.status,
          stage: row.stage,
          progress: Number(row.progress ?? 0),
          updatedAt: new Date(row.updated_at).toISOString(),
          degradationState: row.degradation_state,
          degradationReason: row.degradation_reason ?? undefined
        }
      : null,
    readiness: {
      status: missingArtifacts.length === 0 ? 'full' : 'partial',
      missingArtifacts,
      canResume: missingArtifacts.length > 0,
      degradationReason: row.degradation_reason ?? undefined
    }
  };
};

const artifactCountsFromRow = (row: any) => ({
  summaries: Number(row.summary_count ?? 0),
  glossary: Number(row.glossary_count ?? 0),
  flashcards: Number(row.flashcard_count ?? 0),
  quizQuestions: Number(row.quiz_count ?? 0),
  graphNodes: Number(row.graph_node_count ?? 0),
  graphEdges: Number(row.graph_edge_count ?? 0),
  timelineEvents: Number(row.timeline_count ?? 0)
});

export class PostgresRepo implements AppRepo {
  constructor(private readonly client: PgClient) {}

  private async withTransaction<T>(operation: (client: PgQueryClient) => Promise<T>): Promise<T> {
    const transactionClient = this.client.connect ? await this.client.connect() : this.client;
    try {
      await transactionClient.query('BEGIN');
      const result = await operation(transactionClient);
      await transactionClient.query('COMMIT');
      return result;
    } catch (error) {
      await transactionClient.query('ROLLBACK');
      throw error;
    } finally {
      if ('release' in transactionClient) {
        transactionClient.release();
      }
    }
  }

  async getIdempotency(key: string, ttlSeconds: number): Promise<IdempotencyResult | undefined> {
    const existing = await this.client.query(
      `SELECT pack_id, job_id
       FROM idempotency_keys
       WHERE key = $1
         AND created_at > NOW() - ($2 || ' seconds')::interval`,
      [key, ttlSeconds]
    );

    if (existing.rows.length > 0) {
      return {
        packId: existing.rows[0].pack_id,
        jobId: existing.rows[0].job_id,
        reused: true
      };
    }
    return undefined;
  }

  async createOrReuseByIdempotency(key: string, ttlSeconds: number): Promise<IdempotencyResult> {
    const existing = await this.getIdempotency(key, ttlSeconds);
    if (existing) {
      return existing;
    }

    const packId = randomUUID();
    const jobId = randomUUID();

    await this.client.query(
      `INSERT INTO idempotency_keys (key, pack_id, job_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO NOTHING`,
      [key, packId, jobId]
    );

    const recheck = await this.client.query('SELECT pack_id, job_id FROM idempotency_keys WHERE key = $1', [key]);
    const row = recheck.rows[0];
    const reused = row.pack_id !== packId || row.job_id !== jobId;
    return { packId: row.pack_id, jobId: row.job_id, reused };
  }

  async createPendingPack(packId: string, input: string): Promise<void> {
    await this.client.query(
      `INSERT INTO study_packs (id, input, source_revision_id, schema_version)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [packId, input, 'pending', '1.0.0']
    );
  }

  async upsertJob(job: Job): Promise<void> {
    await this.client.query(
      `INSERT INTO generation_jobs
        (id, pack_id, session_id, stage, status, progress, attempt, retry_state, degradation_state, degradation_reason, errors, heartbeat_at, updated_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, to_timestamp($12 / 1000.0), NOW())
       ON CONFLICT (id)
       DO UPDATE SET
        stage = EXCLUDED.stage,
        status = EXCLUDED.status,
        progress = EXCLUDED.progress,
        attempt = EXCLUDED.attempt,
        retry_state = EXCLUDED.retry_state,
        degradation_state = EXCLUDED.degradation_state,
        degradation_reason = EXCLUDED.degradation_reason,
        errors = EXCLUDED.errors,
        heartbeat_at = EXCLUDED.heartbeat_at,
        updated_at = NOW()`,
      [
        job.id,
        job.packId,
        job.sessionId,
        job.stage,
        job.status,
        job.progress,
        job.attempt,
        job.retryState,
        job.degradationState,
        job.degradationReason ?? null,
        JSON.stringify(job.errors),
        job.heartbeatAt
      ]
    );
  }

  async getJob(jobId: string): Promise<Job | undefined> {
    const result = await this.client.query('SELECT * FROM generation_jobs WHERE id = $1', [jobId]);
    if (result.rows.length === 0) return undefined;
    return fromDbJob(result.rows[0]);
  }

  async listJobs(): Promise<Job[]> {
    const result = await this.client.query('SELECT * FROM generation_jobs ORDER BY created_at ASC');
    return result.rows.map(fromDbJob);
  }

  async claimNextQueuedJob(): Promise<Job | undefined> {
    await this.client.query('BEGIN');
    try {
      const selected = await this.client.query(
        `SELECT *
         FROM generation_jobs
         WHERE status = 'queued'
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`
      );

      if (selected.rows.length === 0) {
        await this.client.query('COMMIT');
        return undefined;
      }

      const row = selected.rows[0];
      const updated = await this.client.query(
        `UPDATE generation_jobs
         SET status = 'running',
             attempt = attempt + 1,
             retry_state = 'none',
             heartbeat_at = NOW(),
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [row.id]
      );

      await this.client.query('COMMIT');
      return fromDbJob(updated.rows[0]);
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }

  async countQueuedJobs(): Promise<number> {
    const result = await this.client.query("SELECT COUNT(*)::int AS count FROM generation_jobs WHERE status = 'queued'");
    return Number(result.rows[0].count);
  }

  async countRunningJobs(): Promise<number> {
    const result = await this.client.query("SELECT COUNT(*)::int AS count FROM generation_jobs WHERE status = 'running'");
    return Number(result.rows[0].count);
  }

  async countInflightJobsForSession(sessionId: string): Promise<number> {
    const result = await this.client.query(
      `SELECT COUNT(*)::int AS count
       FROM generation_jobs
       WHERE session_id = $1
         AND status IN ('queued', 'running')`,
      [sessionId]
    );
    return Number(result.rows[0].count);
  }

  async countInflightJobsForPack(packId: string): Promise<number> {
    const result = await this.client.query(
      `SELECT COUNT(*)::int AS count
       FROM generation_jobs
       WHERE pack_id = $1
         AND status IN ('queued', 'running')`,
      [packId]
    );
    return Number(result.rows[0].count);
  }

  async getLatestJobForPack(packId: string): Promise<Job | undefined> {
    const result = await this.client.query(
      `SELECT *
       FROM generation_jobs
       WHERE pack_id = $1
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`,
      [packId]
    );
    if (result.rows.length === 0) return undefined;
    return fromDbJob(result.rows[0]);
  }

  async getCachedSource(cacheKey: string, parserVersion: string): Promise<CachedSourceRecord | undefined> {
    const result = await this.client.query(
      `SELECT cache_key, source_title, source_revision_id, parser_version, language, sections, outgoing_links, cached_at, expires_at
       FROM source_cache
       WHERE cache_key = $1
         AND parser_version = $2
         AND expires_at > NOW()`,
      [cacheKey, parserVersion]
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      cacheKey: row.cache_key,
      sourceTitle: row.source_title,
      sourceRevisionId: row.source_revision_id,
      parserVersion: row.parser_version,
      language: row.language,
      sections: Array.isArray(row.sections) ? row.sections : [],
      outgoingLinks: Array.isArray(row.outgoing_links)
        ? row.outgoing_links.map((link: any) => ({
            title: link.title,
            url: link.url,
            sourceHeading: link.sourceHeading ?? link.source_heading
          }))
        : [],
      cachedAt: new Date(row.cached_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString()
    };
  }

  async saveCachedSource(record: CachedSourceRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO source_cache
        (cache_key, source_title, source_revision_id, parser_version, language, sections, outgoing_links, cached_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
       ON CONFLICT (cache_key)
       DO UPDATE SET
        source_title = EXCLUDED.source_title,
        source_revision_id = EXCLUDED.source_revision_id,
        parser_version = EXCLUDED.parser_version,
        language = EXCLUDED.language,
        sections = EXCLUDED.sections,
        outgoing_links = EXCLUDED.outgoing_links,
        cached_at = EXCLUDED.cached_at,
        expires_at = EXCLUDED.expires_at`,
      [
        record.cacheKey,
        record.sourceTitle,
        record.sourceRevisionId,
        record.parserVersion,
        record.language,
        JSON.stringify(record.sections),
        JSON.stringify(record.outgoingLinks),
        record.cachedAt,
        record.expiresAt
      ]
    );
  }

  async getCachedArtifact(
    kind: ArtifactCacheKind,
    sourceRevisionId: string,
    promptVersion: string,
    taxonomyVersion: string
  ): Promise<CachedArtifactRecord | undefined> {
    const result = await this.client.query(
      `SELECT cache_key, kind, source_revision_id, prompt_version, taxonomy_version, payload, cached_at, expires_at
       FROM artifact_cache
       WHERE kind = $1
         AND source_revision_id = $2
         AND prompt_version = $3
         AND taxonomy_version = $4
         AND expires_at > NOW()`,
      [kind, sourceRevisionId, promptVersion, taxonomyVersion]
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      cacheKey: row.cache_key,
      kind: row.kind as ArtifactCacheKind,
      sourceRevisionId: row.source_revision_id,
      promptVersion: row.prompt_version,
      taxonomyVersion: row.taxonomy_version,
      payload: row.payload,
      cachedAt: new Date(row.cached_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString()
    };
  }

  async saveCachedArtifact(record: CachedArtifactRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO artifact_cache
        (cache_key, kind, source_revision_id, prompt_version, taxonomy_version, payload, cached_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       ON CONFLICT (kind, source_revision_id, prompt_version, taxonomy_version)
       DO UPDATE SET
        cache_key = EXCLUDED.cache_key,
        payload = EXCLUDED.payload,
        cached_at = EXCLUDED.cached_at,
        expires_at = EXCLUDED.expires_at`,
      [
        record.cacheKey,
        record.kind,
        record.sourceRevisionId,
        record.promptVersion,
        record.taxonomyVersion,
        JSON.stringify(record.payload),
        record.cachedAt,
        record.expiresAt
      ]
    );
  }

  async recordCacheEvent(packId: string, event: CacheEventRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO pack_cache_events
        (pack_id, stage, cache_key, hit, source_revision_id, parser_version, prompt_version, taxonomy_version, cached_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        packId,
        event.stage,
        event.cacheKey,
        event.hit,
        event.sourceRevisionId,
        event.parserVersion ?? null,
        event.promptVersion ?? null,
        event.taxonomyVersion ?? null,
        event.cachedAt ?? null,
        event.expiresAt ?? null
      ]
    );
  }

  async getCacheAdminSnapshot(nowIso = new Date().toISOString()): Promise<CacheAdminSnapshot> {
    const sourceTotals = await this.client.query(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE expires_at > $1)::int AS fresh,
        COUNT(*) FILTER (WHERE expires_at <= $1)::int AS expired
       FROM source_cache`,
      [nowIso]
    );
    const artifactTotals = await this.client.query(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE expires_at > $1)::int AS fresh,
        COUNT(*) FILTER (WHERE expires_at <= $1)::int AS expired
       FROM artifact_cache`,
      [nowIso]
    );
    const byKind = await this.client.query(
      `SELECT kind, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE expires_at <= $1)::int AS expired
       FROM artifact_cache
       GROUP BY kind
       ORDER BY kind ASC`,
      [nowIso]
    );
    const staleSources = await this.client.query(
      `SELECT cache_key, source_title, source_revision_id, parser_version, expires_at
       FROM source_cache
       WHERE expires_at <= $1
       ORDER BY expires_at ASC
       LIMIT 10`,
      [nowIso]
    );
    const staleArtifacts = await this.client.query(
      `SELECT cache_key, kind, source_revision_id, prompt_version, taxonomy_version, expires_at
       FROM artifact_cache
       WHERE expires_at <= $1
       ORDER BY expires_at ASC
       LIMIT 10`,
      [nowIso]
    );

    const sourceRow = sourceTotals.rows[0] ?? {};
    const artifactRow = artifactTotals.rows[0] ?? {};
    const sourceExpired = toNumber(sourceRow.expired);
    const artifactExpired = toNumber(artifactRow.expired);

    return {
      generatedAt: nowIso,
      source: {
        total: toNumber(sourceRow.total),
        fresh: toNumber(sourceRow.fresh),
        expired: sourceExpired
      },
      artifacts: {
        total: toNumber(artifactRow.total),
        fresh: toNumber(artifactRow.fresh),
        expired: artifactExpired,
        byKind: byKind.rows.map((row) => ({
          kind: row.kind as ArtifactCacheKind,
          total: toNumber(row.total),
          expired: toNumber(row.expired)
        }))
      },
      staleSources: staleSources.rows.map((row) => ({
        cacheKey: row.cache_key,
        sourceTitle: row.source_title,
        sourceRevisionId: row.source_revision_id,
        parserVersion: row.parser_version,
        expiresAt: new Date(row.expires_at).toISOString()
      })),
      staleArtifacts: staleArtifacts.rows.map((row) => ({
        cacheKey: row.cache_key,
        kind: row.kind as ArtifactCacheKind,
        sourceRevisionId: row.source_revision_id,
        promptVersion: row.prompt_version,
        taxonomyVersion: row.taxonomy_version,
        expiresAt: new Date(row.expires_at).toISOString()
      })),
      repairCandidates: sourceExpired + artifactExpired
    };
  }

  async invalidateCache(input: CacheInvalidationInput): Promise<CacheInvalidationResult> {
    const requestedAt = input.requestedAt ?? new Date().toISOString();
    const sourceWhere = buildCacheInvalidationWhere(input, 'source', requestedAt);
    const artifactWhere = buildCacheInvalidationWhere(input, 'artifact', requestedAt);
    const sourceCount = await this.client.query(`SELECT COUNT(*)::int AS count FROM source_cache WHERE ${sourceWhere.where}`, sourceWhere.params);
    const artifactCount = await this.client.query(
      `SELECT COUNT(*)::int AS count FROM artifact_cache WHERE ${artifactWhere.where}`,
      artifactWhere.params
    );
    const matchedSource = toNumber(sourceCount.rows[0]?.count);
    const matchedArtifacts = toNumber(artifactCount.rows[0]?.count);
    let deletedSource = 0;
    let deletedArtifacts = 0;

    if (!input.dryRun) {
      deletedSource = affectedRows(
        await this.client.query(`DELETE FROM source_cache WHERE ${sourceWhere.where}`, sourceWhere.params)
      );
      deletedArtifacts = affectedRows(
        await this.client.query(`DELETE FROM artifact_cache WHERE ${artifactWhere.where}`, artifactWhere.params)
      );
    }

    return {
      target: input.target,
      dryRun: input.dryRun,
      cacheKey: input.cacheKey,
      kind: input.kind,
      sourceRevisionId: input.sourceRevisionId,
      reason: input.reason,
      requestedAt,
      matchedSource,
      matchedArtifacts,
      deletedSource,
      deletedArtifacts
    };
  }

  async saveIngestedPack(packId: string, input: string, page: IngestedPage): Promise<void> {
    await this.client.query('BEGIN');
    try {
      await this.client.query(
        `INSERT INTO study_packs (id, input, source_revision_id, schema_version)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE
         SET source_revision_id = EXCLUDED.source_revision_id,
             input = EXCLUDED.input`,
        [packId, input, page.revisionId, '1.0.0']
      );

      await this.client.query('DELETE FROM source_sections WHERE pack_id = $1', [packId]);
      await this.client.query('DELETE FROM source_links WHERE pack_id = $1', [packId]);
      for (const section of page.sections) {
        await this.client.query(
          `INSERT INTO source_sections (pack_id, heading, content)
           VALUES ($1, $2, $3)`,
          [packId, section.heading, section.content]
        );
      }
      for (const link of page.outgoingLinks) {
        await this.client.query(
          `INSERT INTO source_links (pack_id, title, url, source_heading)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (pack_id, title, source_heading) DO NOTHING`,
          [packId, link.title, link.url, link.sourceHeading]
        );
      }
      await this.client.query('COMMIT');
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }

  async saveSummaries(packId: string, summaries: SummaryArtifact[]): Promise<void> {
    await this.client.query('BEGIN');
    try {
      await this.client.query('DELETE FROM summary_artifacts WHERE pack_id = $1', [packId]);
      for (const summary of summaries) {
        await this.client.query(
          `INSERT INTO summary_artifacts (pack_id, level, text, citations, prompt_version, model)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
          [packId, summary.level, summary.text, JSON.stringify(summary.citations), summary.promptVersion, summary.model]
        );
      }
      await this.client.query('COMMIT');
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }

  async saveActiveRecall(packId: string, flashcards: Flashcard[], quizQuestions: QuizQuestion[]): Promise<void> {
    await this.client.query('BEGIN');
    try {
      await this.client.query('DELETE FROM flashcard_artifacts WHERE pack_id = $1', [packId]);
      await this.client.query('DELETE FROM quiz_artifacts WHERE pack_id = $1', [packId]);

      for (const flashcard of flashcards) {
        await this.client.query(
          `INSERT INTO flashcard_artifacts (pack_id, question, answer, citation, prompt_version, model)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [packId, flashcard.question, flashcard.answer, flashcard.citation, flashcard.promptVersion, flashcard.model]
        );
      }

      for (const quiz of quizQuestions) {
        await this.client.query(
          `INSERT INTO quiz_artifacts (pack_id, question, options, correct_index, misconceptions, explanation, citation, prompt_version, model)
           VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6, $7, $8, $9)`,
          [
            packId,
            quiz.question,
            JSON.stringify(quiz.options),
            quiz.correctIndex,
            JSON.stringify(quiz.misconceptions ?? []),
            quiz.explanation,
            quiz.citation,
            quiz.promptVersion,
            quiz.model
          ]
        );
      }

      await this.client.query('COMMIT');
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }

  async saveGlossary(packId: string, glossary: GlossaryTerm[]): Promise<void> {
    await this.client.query('BEGIN');
    try {
      await this.client.query('DELETE FROM glossary_artifacts WHERE pack_id = $1', [packId]);
      for (const term of glossary) {
        await this.client.query(
          `INSERT INTO glossary_artifacts (pack_id, term, definition, citation, prompt_version, model)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [packId, term.term, term.definition, term.citation, term.promptVersion, term.model]
        );
      }
      await this.client.query('COMMIT');
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }

  async saveKnowledgeStructure(
    packId: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    timeline: TimelineEvent[]
  ): Promise<void> {
    await this.client.query('BEGIN');
    try {
      await this.client.query('DELETE FROM graph_nodes WHERE pack_id = $1', [packId]);
      await this.client.query('DELETE FROM graph_edges WHERE pack_id = $1', [packId]);
      await this.client.query('DELETE FROM timeline_events WHERE pack_id = $1', [packId]);

      for (const node of nodes) {
        await this.client.query(
          `INSERT INTO graph_nodes (pack_id, node_id, label, node_type, citation)
           VALUES ($1, $2, $3, $4, $5)`,
          [packId, node.id, node.label, node.type, node.citation]
        );
      }

      for (const edge of edges) {
        await this.client.query(
          `INSERT INTO graph_edges (pack_id, source_node_id, target_node_id, relation, citation)
           VALUES ($1, $2, $3, $4, $5)`,
          [packId, edge.source, edge.target, edge.relation, edge.citation]
        );
      }

      for (const event of timeline) {
        await this.client.query(
          `INSERT INTO timeline_events (pack_id, year, date_label, description, citation)
           VALUES ($1, $2, $3, $4, $5)`,
          [packId, event.year, event.dateLabel, event.description, event.citation]
        );
      }

      await this.client.query('COMMIT');
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }

  async saveQuizAttempt(
    userId: string,
    packId: string,
    selectedIndices: number[],
    cardMasteryScore: number
  ): Promise<QuizAttemptRecord | undefined> {
    await this.client.query('BEGIN');
    try {
      const quizResult = await this.client.query(
        `SELECT id, correct_index
         FROM quiz_artifacts
         WHERE pack_id = $1
         ORDER BY id ASC`,
        [packId]
      );

      if (quizResult.rows.length === 0) {
        await this.client.query('COMMIT');
        return undefined;
      }

      if (selectedIndices.length !== quizResult.rows.length) {
        await this.client.query('COMMIT');
        return undefined;
      }

      const correctAnswers = quizResult.rows.reduce((acc, row, index) => {
        return selectedIndices[index] === Number(row.correct_index) ? acc + 1 : acc;
      }, 0);
      const totalQuestions = quizResult.rows.length;
      const accuracy = correctAnswers / totalQuestions;
      const previousResult = await this.client.query(
        `SELECT attempt_number, accuracy, mastery_score
         FROM quiz_attempts
         WHERE user_id = $1
           AND pack_id = $2
         ORDER BY attempt_number DESC, submitted_at DESC
         LIMIT 1`,
        [userId, packId]
      );
      const previousAttempt = previousResult.rows[0];
      const trend = computeQuizMasteryTrend({
        accuracy,
        cardMasteryScore,
        previousAccuracy: previousAttempt ? toNumber(previousAttempt.accuracy) : undefined,
        previousMasteryScore: previousAttempt ? toNumber(previousAttempt.mastery_score) : undefined
      });
      const attemptNumber = Number(previousAttempt?.attempt_number ?? 0) + 1;

      const inserted = await this.client.query(
        `INSERT INTO quiz_attempts
          (id, user_id, pack_id, attempt_number, selected_indices, total_questions, correct_answers, accuracy, previous_accuracy, accuracy_delta, card_mastery_score, mastery_score, mastery_delta)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id, user_id, pack_id, attempt_number, selected_indices, total_questions, correct_answers, accuracy, previous_accuracy, accuracy_delta, card_mastery_score, mastery_score, mastery_delta, submitted_at`,
        [
          randomUUID(),
          userId,
          packId,
          attemptNumber,
          JSON.stringify(selectedIndices),
          totalQuestions,
          correctAnswers,
          accuracy,
          previousAttempt ? toNumber(previousAttempt.accuracy) : null,
          trend.accuracyDelta,
          cardMasteryScore,
          trend.masteryScore,
          trend.masteryDelta
        ]
      );

      await this.client.query('COMMIT');
      return fromDbQuizAttempt(inserted.rows[0]);
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }

  async listQuizAttempts(userId: string, packId: string, limit: number): Promise<QuizAttemptRecord[]> {
    const boundedLimit = clampQueryLimit(limit);
    const result = await this.client.query(
      `SELECT id, user_id, pack_id, attempt_number, selected_indices, total_questions, correct_answers, accuracy, previous_accuracy, accuracy_delta, card_mastery_score, mastery_score, mastery_delta, submitted_at
       FROM quiz_attempts
       WHERE user_id = $1
         AND pack_id = $2
       ORDER BY submitted_at DESC, attempt_number DESC
       LIMIT $3`,
      [userId, packId, boundedLimit]
    );
    return result.rows.map(fromDbQuizAttempt);
  }

  async upsertUserProfile(userId: string, displayName?: string): Promise<UserProfileRecord> {
    const result = await this.client.query(
      `INSERT INTO user_profiles (user_id, display_name)
       VALUES ($1, $2)
       ON CONFLICT (user_id)
       DO UPDATE SET
         display_name = COALESCE(EXCLUDED.display_name, user_profiles.display_name),
         updated_at = NOW()
       RETURNING user_id, display_name, created_at, updated_at`,
      [userId, displayName?.trim() || userId]
    );
    return fromDbUserProfile(result.rows[0]);
  }

  async getUserProfile(userId: string): Promise<UserProfileRecord | undefined> {
    const result = await this.client.query(
      `SELECT user_id, display_name, created_at, updated_at
       FROM user_profiles
       WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] ? fromDbUserProfile(result.rows[0]) : undefined;
  }

  async exportUserData(userId: string): Promise<UserDataExportRecord> {
    const [profile, library, shares, flashcardReviews, learningSessions, quizAttempts, studyGoal, generationFeedback] = await Promise.all([
      this.client.query(
        `SELECT user_id, display_name, created_at, updated_at
         FROM user_profiles
         WHERE user_id = $1`,
        [userId]
      ),
      this.client.query(
        `SELECT pack_id, saved_at, tags, collection
         FROM saved_packs
         WHERE user_id = $1
         ORDER BY saved_at DESC`,
        [userId]
      ),
      this.client.query(
        `SELECT share_id, pack_id, owner_user_id, role, created_at, token_hash, token_version, expires_at, revoked_at
         FROM share_links
         WHERE owner_user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      ),
      this.client.query(
        `SELECT id, user_id, pack_id, card_index, rating, reviewed_at, next_due_at
         FROM flashcard_reviews
         WHERE user_id = $1
         ORDER BY reviewed_at DESC, card_index ASC`,
        [userId]
      ),
      this.client.query(
        `SELECT id, user_id, pack_id, status, started_at, completed_at, baseline_due_cards, baseline_mastery_score, reviewed_count, outcome
         FROM learning_sessions
         WHERE user_id = $1
         ORDER BY COALESCE(completed_at, started_at) DESC`,
        [userId]
      ),
      this.client.query(
        `SELECT id, user_id, pack_id, attempt_number, selected_indices, total_questions, correct_answers, accuracy, previous_accuracy, accuracy_delta, card_mastery_score, mastery_score, mastery_delta, submitted_at
         FROM quiz_attempts
         WHERE user_id = $1
         ORDER BY submitted_at DESC, attempt_number DESC`,
        [userId]
      ),
      this.client.query(
        `SELECT user_id, daily_target_reviews, created_at, updated_at
         FROM study_goals
         WHERE user_id = $1`,
        [userId]
      ),
      this.client.query(
        `SELECT id, user_id, pack_id, artifact_type, artifact_id, rating, signal, comment, prompt_version, model, created_at
         FROM generation_feedback
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      )
    ]);

    return {
      userId,
      exportedAt: new Date().toISOString(),
      profile: profile.rows[0] ? fromDbUserProfile(profile.rows[0]) : undefined,
      library: library.rows.map((row) => ({
        packId: row.pack_id,
        savedAt: new Date(row.saved_at).toISOString(),
        organization: {
          tags: normalizeDbTextArray(row.tags),
          collection: row.collection ?? undefined
        }
      })),
      shares: shares.rows.map(fromDbShareLink),
      flashcardReviews: flashcardReviews.rows.map(fromDbFlashcardReview),
      learningSessions: learningSessions.rows.map(fromDbLearningSession),
      quizAttempts: quizAttempts.rows.map(fromDbQuizAttempt),
      studyGoal: studyGoal.rows[0] ? fromDbStudyGoal(studyGoal.rows[0]) : undefined,
      generationFeedback: generationFeedback.rows.map(fromDbGenerationFeedback)
    };
  }

  async deleteUserData(userId: string): Promise<UserDataDeleteResult> {
    return this.withTransaction(async (client) => {
      const library = await client.query('DELETE FROM saved_packs WHERE user_id = $1', [userId]);
      const shares = await client.query('DELETE FROM share_links WHERE owner_user_id = $1', [userId]);
      const flashcardReviews = await client.query('DELETE FROM flashcard_reviews WHERE user_id = $1', [userId]);
      const learningSessions = await client.query('DELETE FROM learning_sessions WHERE user_id = $1', [userId]);
      const quizAttempts = await client.query('DELETE FROM quiz_attempts WHERE user_id = $1', [userId]);
      const studyGoals = await client.query('DELETE FROM study_goals WHERE user_id = $1', [userId]);
      const generationFeedback = await client.query('DELETE FROM generation_feedback WHERE user_id = $1', [userId]);
      const profile = await client.query('DELETE FROM user_profiles WHERE user_id = $1', [userId]);

      return {
        userId,
        deletedAt: new Date().toISOString(),
        deleted: {
          profile: affectedRows(profile) > 0,
          library: affectedRows(library),
          shares: affectedRows(shares),
          flashcardReviews: affectedRows(flashcardReviews),
          learningSessions: affectedRows(learningSessions),
          quizAttempts: affectedRows(quizAttempts),
          studyGoals: affectedRows(studyGoals),
          generationFeedback: affectedRows(generationFeedback)
        }
      };
    });
  }

  async recordGenerationFeedback(input: CreateGenerationFeedbackInput): Promise<GenerationFeedbackRecord | undefined> {
    const result = await this.client.query(
      `INSERT INTO generation_feedback (
         id,
         user_id,
         pack_id,
         artifact_type,
         artifact_id,
         rating,
         signal,
         comment,
         prompt_version,
         model,
         trusted_artifact,
         eval_candidate,
         created_at
       )
       SELECT
         $1,
         $2,
         sp.id,
         $4,
         $5,
         $6,
         $7,
         $8,
         $9,
         $10,
         FALSE,
         TRUE,
         NOW()
       FROM study_packs sp
       WHERE sp.id = $3
       RETURNING id, user_id, pack_id, artifact_type, artifact_id, rating, signal, comment, prompt_version, model, created_at`,
      [
        randomUUID(),
        input.userId,
        input.packId,
        input.artifactType,
        input.artifactId ?? null,
        input.rating,
        input.signal,
        input.comment?.trim() || null,
        input.promptVersion?.trim() || null,
        input.model?.trim() || null
      ]
    );

    return result.rows[0] ? fromDbGenerationFeedback(result.rows[0]) : undefined;
  }

  async getGenerationFeedbackSummary(): Promise<GenerationFeedbackSummary> {
    const [totals, artifactRows, signalRows] = await Promise.all([
      this.client.query(
        `SELECT
           COUNT(*)::int AS total_feedback,
           COUNT(*) FILTER (
             WHERE rating <= 2 OR signal IN ('unclear', 'incorrect', 'missing_citation', 'too_shallow', 'unsafe')
           )::int AS negative_feedback,
           AVG(rating)::float8 AS average_rating,
           MAX(created_at) AS latest_feedback_at
         FROM generation_feedback`
      ),
      this.client.query(
         `SELECT
           artifact_type,
           COUNT(*)::int AS total_feedback,
           COUNT(*) FILTER (
             WHERE rating <= 2 OR signal IN ('unclear', 'incorrect', 'missing_citation', 'too_shallow', 'unsafe')
           )::int AS negative_feedback,
           AVG(rating)::float8 AS average_rating,
           MAX(created_at) AS latest_feedback_at
         FROM generation_feedback
         GROUP BY artifact_type
         ORDER BY total_feedback DESC, artifact_type ASC`
      ),
      this.client.query(
        `SELECT artifact_type, signal, COUNT(*)::int AS count
         FROM generation_feedback
         GROUP BY artifact_type, signal
         ORDER BY artifact_type ASC, count DESC, signal ASC`
      )
    ]);

    const totalFeedback = Number(totals.rows[0]?.total_feedback ?? 0);
    if (totalFeedback === 0) {
      return emptyGenerationFeedbackSummary();
    }

    const signalsByArtifact = signalRows.rows.reduce((acc, row) => {
      const artifactType = row.artifact_type as GenerationFeedbackRecord['artifactType'];
      const current = acc.get(artifactType) ?? [];
      current.push({
        signal: row.signal as GenerationFeedbackSignal,
        count: Number(row.count ?? 0)
      });
      acc.set(artifactType, current);
      return acc;
    }, new Map<GenerationFeedbackRecord['artifactType'], Array<{ signal: GenerationFeedbackSignal; count: number }>>());

    const byArtifact = artifactRows.rows.map((row) => {
      const artifactType = row.artifact_type as GenerationFeedbackRecord['artifactType'];
      const signals = signalsByArtifact.get(artifactType) ?? [];
      return {
        artifactType,
        totalFeedback: Number(row.total_feedback ?? 0),
        negativeFeedback: Number(row.negative_feedback ?? 0),
        averageRating: toNumber(row.average_rating),
        latestFeedbackAt: row.latest_feedback_at ? new Date(row.latest_feedback_at).toISOString() : undefined,
        signals
      };
    });

    return {
      ...emptyGenerationFeedbackSummary(),
      totalFeedback,
      negativeFeedback: Number(totals.rows[0]?.negative_feedback ?? 0),
      averageRating: toNumber(totals.rows[0]?.average_rating),
      latestFeedbackAt: totals.rows[0]?.latest_feedback_at ? new Date(totals.rows[0].latest_feedback_at).toISOString() : undefined,
      byArtifact
    };
  }

  async createShareLink(
    ownerUserId: string,
    packId: string,
    role: ShareRole,
    input: CreateShareLinkInput
  ): Promise<ShareLinkRecord | undefined> {
    const pack = await this.client.query('SELECT 1 FROM study_packs WHERE id = $1', [packId]);
    if (pack.rows.length === 0) {
      return undefined;
    }

    const result = await this.client.query(
      `INSERT INTO share_links (share_id, pack_id, owner_user_id, role, token_hash, token_version, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING share_id, pack_id, owner_user_id, role, created_at, token_hash, token_version, expires_at, revoked_at`,
      [input.shareId, packId, ownerUserId, role, input.tokenHash, input.tokenVersion, input.expiresAt]
    );
    return fromDbShareLink(result.rows[0]);
  }

  async getShareLink(shareId: string, tokenHash: string): Promise<ShareLinkRecord | undefined> {
    const result = await this.client.query(
      `SELECT share_id, pack_id, owner_user_id, role, created_at, token_hash, token_version, expires_at, revoked_at
       FROM share_links
       WHERE share_id = $1
         AND token_hash = $2
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [shareId, tokenHash]
    );
    return result.rows[0] ? fromDbShareLink(result.rows[0]) : undefined;
  }

  async listShareLinksForOwner(ownerUserId: string, packId: string, limit: number): Promise<ShareLinkRecord[]> {
    const boundedLimit = clampQueryLimit(limit);
    const result = await this.client.query(
      `SELECT share_id, pack_id, owner_user_id, role, created_at, token_hash, token_version, expires_at, revoked_at
       FROM share_links
       WHERE owner_user_id = $1
         AND pack_id = $2
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC
       LIMIT $3`,
      [ownerUserId, packId, boundedLimit]
    );
    return result.rows.map(fromDbShareLink);
  }

  async revokeShareLink(ownerUserId: string, packId: string, shareId: string, tokenHash: string): Promise<ShareLinkRecord | undefined> {
    const result = await this.client.query(
      `UPDATE share_links
       SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE owner_user_id = $1
         AND pack_id = $2
         AND share_id = $3
         AND token_hash = $4
         AND revoked_at IS NULL
       RETURNING share_id, pack_id, owner_user_id, role, created_at, token_hash, token_version, expires_at, revoked_at`,
      [ownerUserId, packId, shareId, tokenHash]
    );
    return result.rows[0] ? fromDbShareLink(result.rows[0]) : undefined;
  }

  async recordFlashcardReview(
    userId: string,
    packId: string,
    cardIndex: number,
    rating: FlashcardReviewRating
  ): Promise<FlashcardReviewRecord | undefined> {
    const flashcards = await this.client.query(
      'SELECT COUNT(*)::int AS count FROM flashcard_artifacts WHERE pack_id = $1',
      [packId]
    );
    const totalCards = Number(flashcards.rows[0]?.count ?? 0);
    if (cardIndex < 0 || cardIndex >= totalCards) {
      return undefined;
    }

    const scheduled = scheduleFlashcardReview(rating);
    const result = await this.client.query(
      `INSERT INTO flashcard_reviews (id, user_id, pack_id, card_index, rating, reviewed_at, next_due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, pack_id, card_index, rating, reviewed_at, next_due_at`,
      [randomUUID(), userId, packId, cardIndex, rating, scheduled.reviewedAt, scheduled.nextDueAt]
    );
    return fromDbFlashcardReview(result.rows[0]);
  }

  async getLearningProgress(userId: string, packId: string): Promise<LearningProgressRecord | undefined> {
    const flashcards = await this.client.query(
      'SELECT COUNT(*)::int AS count FROM flashcard_artifacts WHERE pack_id = $1',
      [packId]
    );
    const totalCards = Number(flashcards.rows[0]?.count ?? 0);
    if (totalCards === 0) {
      const pack = await this.client.query('SELECT 1 FROM study_packs WHERE id = $1', [packId]);
      if (pack.rows.length === 0) {
        return undefined;
      }
    }

    const latest = await this.client.query(
      `SELECT DISTINCT ON (card_index)
         id, user_id, pack_id, card_index, rating, reviewed_at, next_due_at
       FROM flashcard_reviews
       WHERE user_id = $1
         AND pack_id = $2
       ORDER BY card_index, reviewed_at DESC`,
      [userId, packId]
    );
    const latestByCard = new Map<number, FlashcardReviewRecord>(
      latest.rows.map((row) => {
        const review = fromDbFlashcardReview(row);
        return [review.cardIndex, review];
      })
    );
    const now = new Date();
    const cards = Array.from({ length: totalCards }, (_, cardIndex) => {
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
    const masteryScore = computeMasteryScore(
      Array.from(latestByCard.values()).map((review) => review.rating),
      totalCards
    );

    return {
      userId,
      packId,
      totalCards,
      reviewedCards: latestByCard.size,
      dueCards: cards.filter((card) => card.due).length,
      masteryScore: Math.max(0, Math.min(1, masteryScore)),
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
    const pack = await this.client.query('SELECT 1 FROM study_packs WHERE id = $1', [packId]);
    if (pack.rows.length === 0) {
      return undefined;
    }
    const now = new Date().toISOString();
    const completedAt = progress.status === 'completed' ? now : null;
    const result = await this.client.query(
      `INSERT INTO learning_sessions
        (id, user_id, pack_id, status, started_at, completed_at, baseline_due_cards, baseline_mastery_score, reviewed_count, outcome)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       RETURNING id, user_id, pack_id, status, started_at, completed_at, baseline_due_cards, baseline_mastery_score, reviewed_count, outcome`,
      [
        randomUUID(),
        userId,
        packId,
        progress.status,
        now,
        completedAt,
        baselineDueCards,
        baselineMasteryScore,
        progress.reviewedCount,
        JSON.stringify(progress.outcome)
      ]
    );
    return fromDbLearningSession(result.rows[0]);
  }

  async getLearningSession(userId: string, packId: string, sessionId: string): Promise<LearningSessionRecord | undefined> {
    const result = await this.client.query(
      `SELECT id, user_id, pack_id, status, started_at, completed_at, baseline_due_cards, baseline_mastery_score, reviewed_count, outcome
       FROM learning_sessions
       WHERE id = $1
         AND user_id = $2
         AND pack_id = $3`,
      [sessionId, userId, packId]
    );
    return result.rows[0] ? fromDbLearningSession(result.rows[0]) : undefined;
  }

  async updateLearningSessionProgress(
    userId: string,
    packId: string,
    sessionId: string,
    progress: UpsertLearningSessionProgressInput
  ): Promise<LearningSessionRecord | undefined> {
    const completedAt = progress.status === 'completed' ? new Date().toISOString() : null;
    const result = await this.client.query(
      `UPDATE learning_sessions
       SET status = $4,
           completed_at = CASE
             WHEN $4 = 'completed' THEN COALESCE(completed_at, $5)
             ELSE completed_at
           END,
           reviewed_count = $6,
           outcome = $7::jsonb
       WHERE id = $1
         AND user_id = $2
         AND pack_id = $3
       RETURNING id, user_id, pack_id, status, started_at, completed_at, baseline_due_cards, baseline_mastery_score, reviewed_count, outcome`,
      [sessionId, userId, packId, progress.status, completedAt, progress.reviewedCount, JSON.stringify(progress.outcome)]
    );
    return result.rows[0] ? fromDbLearningSession(result.rows[0]) : undefined;
  }

  async getStudyGoal(userId: string): Promise<StudyGoalRecord | undefined> {
    const result = await this.client.query(
      `SELECT user_id, daily_target_reviews, created_at, updated_at
       FROM study_goals
       WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] ? fromDbStudyGoal(result.rows[0]) : undefined;
  }

  async upsertStudyGoal(userId: string, dailyTargetReviews: number): Promise<StudyGoalRecord> {
    const result = await this.client.query(
      `INSERT INTO study_goals (user_id, daily_target_reviews)
       VALUES ($1, $2)
       ON CONFLICT (user_id)
       DO UPDATE SET daily_target_reviews = EXCLUDED.daily_target_reviews, updated_at = NOW()
       RETURNING user_id, daily_target_reviews, created_at, updated_at`,
      [userId, Math.max(0, Math.min(200, Math.trunc(dailyTargetReviews)))]
    );
    return fromDbStudyGoal(result.rows[0]);
  }

  async getLearningAnalytics(userId: string): Promise<LearningAnalyticsRecord> {
    const packs = await this.client.query(
      `SELECT
         saved.pack_id,
         COUNT(fa.id)::int AS total_cards
       FROM saved_packs saved
       LEFT JOIN flashcard_artifacts fa ON fa.pack_id = saved.pack_id
       WHERE saved.user_id = $1
       GROUP BY saved.pack_id, saved.saved_at
       ORDER BY saved.saved_at DESC`,
      [userId]
    );
    const reviews = await this.client.query(
      `SELECT fr.pack_id, fr.card_index, fr.rating, fr.reviewed_at, fr.next_due_at
       FROM flashcard_reviews fr
       JOIN saved_packs saved ON saved.user_id = fr.user_id AND saved.pack_id = fr.pack_id
       WHERE fr.user_id = $1
       ORDER BY fr.reviewed_at ASC, fr.card_index ASC`,
      [userId]
    );
    const attempts = await this.client.query(
      `SELECT qa.id, qa.user_id, qa.pack_id, qa.attempt_number, qa.selected_indices, qa.total_questions, qa.correct_answers, qa.accuracy, qa.previous_accuracy, qa.accuracy_delta, qa.card_mastery_score, qa.mastery_score, qa.mastery_delta, qa.submitted_at
       FROM quiz_attempts qa
       JOIN saved_packs saved ON saved.user_id = qa.user_id AND saved.pack_id = qa.pack_id
       WHERE qa.user_id = $1
       ORDER BY qa.submitted_at ASC, qa.attempt_number ASC`,
      [userId]
    );
    const sessions = await this.client.query(
      `SELECT ls.id, ls.user_id, ls.pack_id, ls.status, ls.started_at, ls.completed_at, ls.baseline_due_cards, ls.baseline_mastery_score, ls.reviewed_count, ls.outcome
       FROM learning_sessions ls
       JOIN saved_packs saved ON saved.user_id = ls.user_id AND saved.pack_id = ls.pack_id
       WHERE ls.user_id = $1
       ORDER BY COALESCE(ls.completed_at, ls.started_at) ASC`,
      [userId]
    );
    const goal = await this.getStudyGoal(userId);

    return buildLearningAnalyticsRecord(
      userId,
      packs.rows.map((row) => ({
        packId: row.pack_id,
        totalCards: Number(row.total_cards ?? 0)
      })),
      reviews.rows.map(
        (row): LearningAnalyticsReviewInput => ({
          packId: row.pack_id,
          cardIndex: Number(row.card_index),
          rating: row.rating,
          reviewedAt: new Date(row.reviewed_at).toISOString(),
          nextDueAt: new Date(row.next_due_at).toISOString()
        })
      ),
      attempts.rows.map(fromDbQuizAttempt),
      sessions.rows.map(fromDbLearningSession),
      goal
    );
  }

  async recordJobCompletion(sample: JobCompletionSample): Promise<void> {
    await this.client.query(
      `INSERT INTO generation_outcomes
       (job_id, pack_id, status, duration_ms, citation_rate, flashcards_count, quiz_questions_count)
       VALUES ($1, $2, 'completed', $3, $4, $5, $6)
       ON CONFLICT (job_id) DO UPDATE
       SET status = EXCLUDED.status,
           duration_ms = EXCLUDED.duration_ms,
           citation_rate = EXCLUDED.citation_rate,
           flashcards_count = EXCLUDED.flashcards_count,
           quiz_questions_count = EXCLUDED.quiz_questions_count,
           recorded_at = NOW()`,
      [sample.jobId, sample.packId, sample.durationMs, sample.citationRate, sample.flashcards, sample.quizQuestions]
    );
  }

  async recordJobFailure(sample: JobFailureSample): Promise<void> {
    await this.client.query(
      `INSERT INTO generation_outcomes (job_id, pack_id, status)
       VALUES ($1, $2, 'failed')
       ON CONFLICT (job_id) DO UPDATE
       SET status = EXCLUDED.status,
           duration_ms = NULL,
           citation_rate = NULL,
           flashcards_count = NULL,
           quiz_questions_count = NULL,
           recorded_at = NOW()`,
      [sample.jobId, sample.packId]
    );
  }

  async recordStageCost(sample: StageCostSample): Promise<void> {
    await this.client.query(
      `INSERT INTO stage_cost_events
       (job_id, pack_id, stage, estimated_tokens, latency_ms, estimated_cost_usd, prompt_version, model)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        sample.jobId,
        sample.packId,
        sample.stage,
        sample.estimatedTokens,
        sample.latencyMs,
        sample.estimatedCostUsd,
        sample.promptVersion,
        sample.model
      ]
    );
  }

  async getOutcomesSnapshot(windowHours?: number): Promise<OutcomesSnapshot> {
    const params = typeof windowHours === 'number' ? [windowHours] : [];
    const outcomesWindowClause = typeof windowHours === 'number' ? `WHERE recorded_at > NOW() - ($1 || ' hours')::interval` : '';
    const quizWindowClause = typeof windowHours === 'number' ? `WHERE submitted_at > NOW() - ($1 || ' hours')::interval` : '';
    const stageWindowClause = typeof windowHours === 'number' ? `WHERE recorded_at > NOW() - ($1 || ' hours')::interval` : '';
    const firstArtifactWindowClause = typeof windowHours === 'number' ? `AND recorded_at > NOW() - ($1 || ' hours')::interval` : '';
    const completedOutcomeWindowClause = typeof windowHours === 'number' ? `AND recorded_at > NOW() - ($1 || ' hours')::interval` : '';
    const outcomes = await this.client.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         COALESCE(AVG(duration_ms) FILTER (WHERE status = 'completed'), 0)::float8 AS avg_duration_ms,
         COALESCE(AVG(citation_rate) FILTER (WHERE status = 'completed'), 0)::float8 AS avg_citation_rate,
         COALESCE(AVG(flashcards_count) FILTER (WHERE status = 'completed'), 0)::float8 AS avg_flashcards,
         COALESCE(AVG(quiz_questions_count) FILTER (WHERE status = 'completed'), 0)::float8 AS avg_quiz_questions
       FROM generation_outcomes
       ${outcomesWindowClause}`,
      params
    );
    const learning = await this.client.query(
      `SELECT
         COUNT(*)::int AS attempts,
         COUNT(*) FILTER (WHERE attempt_number > 1)::int AS retakes,
         COALESCE(AVG(accuracy), 0)::float8 AS avg_accuracy,
         COALESCE(AVG(mastery_score), 0)::float8 AS avg_mastery_score,
         COALESCE(AVG(mastery_delta), 0)::float8 AS avg_mastery_delta
       FROM quiz_attempts
       ${quizWindowClause}`,
      params
    );
    const stageCosts = await this.client.query(
      `SELECT
         stage,
         COUNT(*)::int AS events,
         COALESCE(AVG(estimated_tokens), 0)::float8 AS avg_tokens,
         COALESCE(AVG(latency_ms), 0)::float8 AS avg_latency_ms,
         COALESCE(SUM(estimated_cost_usd), 0)::float8 AS total_estimated_usd,
         COALESCE(AVG(estimated_cost_usd), 0)::float8 AS avg_estimated_usd
       FROM stage_cost_events
       ${stageWindowClause}
       GROUP BY stage
       ORDER BY stage ASC`,
      params
    );
    const costTotals = await this.client.query(
      `SELECT
         COALESCE(SUM(estimated_cost_usd), 0)::float8 AS total_estimated_usd,
         COUNT(DISTINCT pack_id)::int AS distinct_packs
       FROM stage_cost_events
       ${stageWindowClause}`,
      params
    );
    const sloPercentiles = await this.client.query(
      `WITH first_artifact AS (
         SELECT
           job_id,
           SUM(latency_ms)::float8 AS time_to_first_artifact_ms
         FROM stage_cost_events
         WHERE stage IN ('ingestion', 'summarization')
         ${firstArtifactWindowClause}
         GROUP BY job_id
       )
       SELECT
         COALESCE(
           percentile_cont(0.95) WITHIN GROUP (ORDER BY time_to_first_artifact_ms),
           0
         )::float8 AS p95_time_to_first_artifact_ms,
         COALESCE(
           (
             SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)
             FROM generation_outcomes
             WHERE status = 'completed'
             ${completedOutcomeWindowClause}
           ),
           0
         )::float8 AS p95_full_pack_completion_ms
       FROM first_artifact`,
      params
    );

    const completed = Number(outcomes.rows[0]?.completed ?? 0);
    const failed = Number(outcomes.rows[0]?.failed ?? 0);
    const total = completed + failed;

    return {
      jobs: {
        completed,
        failed,
        avgDurationMs: toNumber(outcomes.rows[0]?.avg_duration_ms),
        completionRate: total === 0 ? 0 : completed / total
      },
      quality: {
        avgCitationRate: toNumber(outcomes.rows[0]?.avg_citation_rate),
        avgFlashcards: toNumber(outcomes.rows[0]?.avg_flashcards),
        avgQuizQuestions: toNumber(outcomes.rows[0]?.avg_quiz_questions)
      },
      learning: {
        attempts: Number(learning.rows[0]?.attempts ?? 0),
        retakes: Number(learning.rows[0]?.retakes ?? 0),
        avgAccuracy: toNumber(learning.rows[0]?.avg_accuracy),
        avgMasteryScore: toNumber(learning.rows[0]?.avg_mastery_score),
        avgMasteryDelta: toNumber(learning.rows[0]?.avg_mastery_delta)
      },
      slo: {
        p95TimeToFirstArtifactMs: toNumber(sloPercentiles.rows[0]?.p95_time_to_first_artifact_ms),
        p95FullPackCompletionMs: toNumber(sloPercentiles.rows[0]?.p95_full_pack_completion_ms),
        jobSuccessRate: total === 0 ? 0 : completed / total,
        citationCoverageRate: toNumber(outcomes.rows[0]?.avg_citation_rate)
      },
      cost: {
        totalEstimatedUsd: toNumber(costTotals.rows[0]?.total_estimated_usd),
        avgEstimatedUsdPerPack:
          Number(costTotals.rows[0]?.distinct_packs ?? 0) === 0
            ? 0
            : toNumber(costTotals.rows[0]?.total_estimated_usd) / Number(costTotals.rows[0]?.distinct_packs),
        byStage: stageCosts.rows.map((row) => ({
          stage: row.stage as 'ingestion' | 'summarization' | 'knowledge_structure' | 'glossary' | 'active_recall',
          events: Number(row.events ?? 0),
          avgTokens: toNumber(row.avg_tokens),
          avgLatencyMs: toNumber(row.avg_latency_ms),
          totalEstimatedUsd: toNumber(row.total_estimated_usd),
          avgEstimatedUsd: toNumber(row.avg_estimated_usd)
        }))
      }
    };
  }

  async getOutcomesMaintenanceSnapshot(): Promise<OutcomesMaintenanceSnapshot> {
    const result = await this.client.query(
      `SELECT
         finished_at,
         duration_ms,
         outcomes_pruned,
         quiz_attempts_pruned,
         rollups_refreshed
       FROM outcomes_maintenance_runs
       WHERE status = 'completed'
       ORDER BY id DESC
       LIMIT 1`
    );

    const row = result.rows[0];
    if (!row) {
      return {
        lastRunAt: null,
        durationMs: 0,
        outcomesPruned: 0,
        quizAttemptsPruned: 0,
        rollupsRefreshed: 0
      };
    }

    return {
      lastRunAt: new Date(row.finished_at).toISOString(),
      durationMs: Number(row.duration_ms ?? 0),
      outcomesPruned: Number(row.outcomes_pruned ?? 0),
      quizAttemptsPruned: Number(row.quiz_attempts_pruned ?? 0),
      rollupsRefreshed: Number(row.rollups_refreshed ?? 0)
    };
  }

  async getOperationalMetricsSnapshot(): Promise<OperationalMetricsSnapshot> {
    const degradation = await this.client.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_jobs,
         COUNT(*) FILTER (WHERE status = 'completed' AND degradation_state = 'partial')::int AS partial_jobs
       FROM generation_jobs`
    );
    const cache = await this.client.query(
      `SELECT
         COUNT(*)::int AS events,
         COUNT(*) FILTER (WHERE hit = true)::int AS hits
       FROM pack_cache_events`
    );

    const completedJobs = Number(degradation.rows[0]?.completed_jobs ?? 0);
    const partialJobs = Number(degradation.rows[0]?.partial_jobs ?? 0);
    const events = Number(cache.rows[0]?.events ?? 0);
    const hits = Number(cache.rows[0]?.hits ?? 0);

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
    const windowClause = `recorded_at > NOW() - ($1 || ' hours')::interval`;
    const byStage = await this.client.query(
      `SELECT
         stage,
         COUNT(*)::int AS events,
         COALESCE(AVG(estimated_tokens), 0)::float8 AS avg_tokens,
         COALESCE(AVG(latency_ms), 0)::float8 AS avg_latency_ms,
         COALESCE(SUM(estimated_cost_usd), 0)::float8 AS total_estimated_usd,
         COALESCE(AVG(estimated_cost_usd), 0)::float8 AS avg_estimated_usd
       FROM stage_cost_events
       WHERE ${windowClause}
       GROUP BY stage
       ORDER BY stage ASC`,
      [windowHours]
    );
    const totals = await this.client.query(
      `SELECT
         COALESCE(SUM(estimated_cost_usd), 0)::float8 AS total_estimated_usd,
         COUNT(DISTINCT pack_id)::int AS distinct_packs
       FROM stage_cost_events
       WHERE ${windowClause}`,
      [windowHours]
    );
    const byPack = await this.client.query(
      `SELECT
         pack_id,
         COUNT(*)::int AS events,
         COALESCE(SUM(estimated_tokens), 0)::int AS estimated_tokens,
         COALESCE(SUM(estimated_cost_usd), 0)::float8 AS total_estimated_usd,
         COALESCE(AVG(estimated_cost_usd), 0)::float8 AS avg_estimated_usd
       FROM stage_cost_events
       WHERE ${windowClause}
       GROUP BY pack_id
       ORDER BY total_estimated_usd DESC
       LIMIT 20`,
      [windowHours]
    );
    const byPromptModel = await this.client.query(
      `SELECT
         prompt_version,
         model,
         COUNT(*)::int AS events,
         COALESCE(AVG(latency_ms), 0)::float8 AS avg_latency_ms,
         COALESCE(SUM(estimated_tokens), 0)::int AS estimated_tokens,
         COALESCE(SUM(estimated_cost_usd), 0)::float8 AS total_estimated_usd
       FROM stage_cost_events
       WHERE ${windowClause}
       GROUP BY prompt_version, model
       ORDER BY total_estimated_usd DESC
       LIMIT 20`,
      [windowHours]
    );

    const distinctPacks = Number(totals.rows[0]?.distinct_packs ?? 0);
    const totalEstimatedUsd = toNumber(totals.rows[0]?.total_estimated_usd);

    return {
      windowHours,
      totalEstimatedUsd,
      avgEstimatedUsdPerPack: distinctPacks === 0 ? 0 : totalEstimatedUsd / distinctPacks,
      byStage: byStage.rows.map((row) => ({
        stage: row.stage as 'ingestion' | 'summarization' | 'knowledge_structure' | 'glossary' | 'active_recall',
        events: Number(row.events ?? 0),
        avgTokens: toNumber(row.avg_tokens),
        avgLatencyMs: toNumber(row.avg_latency_ms),
        totalEstimatedUsd: toNumber(row.total_estimated_usd),
        avgEstimatedUsd: toNumber(row.avg_estimated_usd)
      })),
      byPack: byPack.rows.map((row) => ({
        packId: row.pack_id,
        events: Number(row.events ?? 0),
        estimatedTokens: Number(row.estimated_tokens ?? 0),
        totalEstimatedUsd: toNumber(row.total_estimated_usd),
        avgEstimatedUsd: toNumber(row.avg_estimated_usd)
      })),
      byPromptModel: byPromptModel.rows.map((row) => ({
        promptVersion: row.prompt_version,
        model: row.model,
        events: Number(row.events ?? 0),
        avgLatencyMs: toNumber(row.avg_latency_ms),
        estimatedTokens: Number(row.estimated_tokens ?? 0),
        totalEstimatedUsd: toNumber(row.total_estimated_usd)
      }))
    };
  }

  async getCostDrilldownSnapshot(windowHours: number, filters: CostDrilldownFilters): Promise<CostDrilldownSnapshot> {
    const boundedFilters = { ...filters, limit: clampQueryLimit(filters.limit, 50) };
    const params: unknown[] = [windowHours];
    const clauses = [`recorded_at > NOW() - ($1 || ' hours')::interval`];

    if (boundedFilters.packId) {
      params.push(boundedFilters.packId);
      clauses.push(`pack_id = $${params.length}`);
    }
    if (boundedFilters.promptVersion) {
      params.push(boundedFilters.promptVersion);
      clauses.push(`prompt_version = $${params.length}`);
    }
    if (boundedFilters.model) {
      params.push(boundedFilters.model);
      clauses.push(`model = $${params.length}`);
    }
    if (boundedFilters.stage) {
      params.push(boundedFilters.stage);
      clauses.push(`stage = $${params.length}`);
    }

    const whereClause = clauses.join(' AND ');
    const totals = await this.client.query(
      `SELECT
         COUNT(*)::int AS events,
         COALESCE(SUM(estimated_tokens), 0)::int AS estimated_tokens,
         COALESCE(SUM(estimated_cost_usd), 0)::float8 AS total_estimated_usd,
         COALESCE(AVG(estimated_cost_usd), 0)::float8 AS avg_estimated_usd,
         COALESCE(AVG(latency_ms), 0)::float8 AS avg_latency_ms,
         COUNT(DISTINCT pack_id)::int AS distinct_packs
       FROM stage_cost_events
       WHERE ${whereClause}`,
      params
    );

    const rows = await this.client.query(
      `SELECT
         pack_id,
         prompt_version,
         model,
         stage,
         COUNT(*)::int AS events,
         COALESCE(SUM(estimated_tokens), 0)::int AS estimated_tokens,
         COALESCE(AVG(estimated_tokens), 0)::float8 AS avg_tokens,
         COALESCE(AVG(latency_ms), 0)::float8 AS avg_latency_ms,
         COALESCE(SUM(estimated_cost_usd), 0)::float8 AS total_estimated_usd,
         COALESCE(AVG(estimated_cost_usd), 0)::float8 AS avg_estimated_usd,
         MIN(recorded_at) AS first_recorded_at,
         MAX(recorded_at) AS last_recorded_at
       FROM stage_cost_events
       WHERE ${whereClause}
       GROUP BY pack_id, prompt_version, model, stage
       ORDER BY total_estimated_usd DESC, events DESC, pack_id ASC, prompt_version ASC, model ASC, stage ASC
       LIMIT $${params.length + 1}`,
      [...params, boundedFilters.limit]
    );

    const totalRow = totals.rows[0] ?? {};
    return {
      windowHours,
      filters: boundedFilters,
      totalEvents: Number(totalRow.events ?? 0),
      totalEstimatedTokens: Number(totalRow.estimated_tokens ?? 0),
      totalEstimatedUsd: toNumber(totalRow.total_estimated_usd),
      avgEstimatedUsd: toNumber(totalRow.avg_estimated_usd),
      avgLatencyMs: toNumber(totalRow.avg_latency_ms),
      distinctPacks: Number(totalRow.distinct_packs ?? 0),
      rows: rows.rows.map((row) => ({
        packId: row.pack_id,
        promptVersion: row.prompt_version,
        model: row.model,
        stage: row.stage as StageCostSample['stage'],
        events: Number(row.events ?? 0),
        estimatedTokens: Number(row.estimated_tokens ?? 0),
        avgTokens: toNumber(row.avg_tokens),
        avgLatencyMs: toNumber(row.avg_latency_ms),
        totalEstimatedUsd: toNumber(row.total_estimated_usd),
        avgEstimatedUsd: toNumber(row.avg_estimated_usd),
        firstRecordedAt: row.first_recorded_at ? new Date(row.first_recorded_at).toISOString() : null,
        lastRecordedAt: row.last_recorded_at ? new Date(row.last_recorded_at).toISOString() : null
      }))
    };
  }

  async getPack(packId: string): Promise<PackRecord | undefined> {
    const packResult = await this.client.query('SELECT * FROM study_packs WHERE id = $1', [packId]);
    if (packResult.rows.length === 0) return undefined;

    const sectionResult = await this.client.query(
      'SELECT heading, content FROM source_sections WHERE pack_id = $1 ORDER BY id ASC',
      [packId]
    );
    const sourceLinkResult = await this.client.query(
      'SELECT title, url, source_heading FROM source_links WHERE pack_id = $1 ORDER BY id ASC',
      [packId]
    );
    const cacheEventResult = await this.client.query(
      `SELECT stage, cache_key, hit, source_revision_id, parser_version, prompt_version, taxonomy_version, cached_at, expires_at, recorded_at
       FROM pack_cache_events
       WHERE pack_id = $1
       ORDER BY id ASC`,
      [packId]
    );
    const summaryResult = await this.client.query(
      `SELECT level, text, citations, prompt_version, model
       FROM summary_artifacts
       WHERE pack_id = $1
       ORDER BY CASE level
         WHEN 'beginner' THEN 1
         WHEN 'intermediate' THEN 2
         WHEN 'advanced' THEN 3
         ELSE 4 END`,
      [packId]
    );
    const flashcardResult = await this.client.query(
      `SELECT question, answer, citation, prompt_version, model
       FROM flashcard_artifacts
       WHERE pack_id = $1
       ORDER BY id ASC`,
      [packId]
    );
    const glossaryResult = await this.client.query(
      `SELECT term, definition, citation, prompt_version, model
       FROM glossary_artifacts
       WHERE pack_id = $1
       ORDER BY id ASC`,
      [packId]
    );
    const quizResult = await this.client.query(
      `SELECT question, options, correct_index, misconceptions, explanation, citation, prompt_version, model
       FROM quiz_artifacts
       WHERE pack_id = $1
       ORDER BY id ASC`,
      [packId]
    );
    const graphNodeResult = await this.client.query(
      `SELECT node_id, label, node_type, citation
       FROM graph_nodes
       WHERE pack_id = $1
       ORDER BY id ASC`,
      [packId]
    );
    const graphEdgeResult = await this.client.query(
      `SELECT source_node_id, target_node_id, relation, citation
       FROM graph_edges
       WHERE pack_id = $1
       ORDER BY id ASC`,
      [packId]
    );
    const timelineResult = await this.client.query(
      `SELECT year, date_label, description, citation
       FROM timeline_events
       WHERE pack_id = $1
       ORDER BY year ASC, id ASC`,
      [packId]
    );

    return {
      id: packResult.rows[0].id,
      input: packResult.rows[0].input,
      sourceRevisionId: packResult.rows[0].source_revision_id,
      createdAt: new Date(packResult.rows[0].created_at).toISOString(),
      sections: sectionResult.rows.map((row) => ({ heading: row.heading, content: row.content })),
      outgoingLinks: sourceLinkResult.rows.map((row) => ({
        title: row.title,
        url: row.url,
        sourceHeading: row.source_heading
      })),
      cacheEvents: cacheEventResult.rows.map((row) => ({
        stage: row.stage as CacheEventRecord['stage'],
        cacheKey: row.cache_key,
        hit: Boolean(row.hit),
        sourceRevisionId: row.source_revision_id,
        parserVersion: row.parser_version ?? undefined,
        promptVersion: row.prompt_version ?? undefined,
        taxonomyVersion: row.taxonomy_version ?? undefined,
        cachedAt: row.cached_at ? new Date(row.cached_at).toISOString() : undefined,
        expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : undefined,
        recordedAt: row.recorded_at ? new Date(row.recorded_at).toISOString() : undefined
      })),
      summaries: summaryResult.rows.map((row) => ({
        level: row.level,
        text: row.text,
        citations: Array.isArray(row.citations) ? row.citations : [],
        promptVersion: row.prompt_version,
        model: row.model
      })),
      flashcards: flashcardResult.rows.map((row) => ({
        question: row.question,
        answer: row.answer,
        citation: row.citation,
        promptVersion: row.prompt_version,
        model: row.model
      })),
      glossary: glossaryResult.rows.map((row) => ({
        term: row.term,
        definition: row.definition,
        citation: row.citation,
        promptVersion: row.prompt_version,
        model: row.model
      })),
      quizQuestions: quizResult.rows.map((row) => ({
        question: row.question,
        options: Array.isArray(row.options) ? row.options : [],
        correctIndex: Number(row.correct_index),
        misconceptions: Array.isArray(row.misconceptions) ? row.misconceptions : [],
        explanation: row.explanation,
        citation: row.citation,
        promptVersion: row.prompt_version,
        model: row.model
      })),
      graphNodes: graphNodeResult.rows.map((row) => ({
        id: row.node_id,
        label: row.label,
        type: row.node_type,
        citation: row.citation
      })),
      graphEdges: graphEdgeResult.rows.map((row) => ({
        source: row.source_node_id,
        target: row.target_node_id,
        relation: row.relation,
        citation: row.citation
      })),
      timelineEvents: timelineResult.rows.map((row) => ({
        year: Number(row.year),
        dateLabel: row.date_label,
        description: row.description,
        citation: row.citation
      }))
    };
  }

  async listRecentPacksForSession(sessionId: string, limit: number): Promise<StudyPackHistoryItem[]> {
    const boundedLimit = clampQueryLimit(limit);
    const result = await this.client.query(
      `WITH latest_jobs AS (
         SELECT
           gj.*,
           ROW_NUMBER() OVER (PARTITION BY gj.pack_id ORDER BY gj.updated_at DESC, gj.created_at DESC) AS row_num
         FROM generation_jobs gj
         WHERE gj.session_id = $1
       ),
       bounded_latest_jobs AS (
         SELECT *
         FROM latest_jobs
         WHERE row_num = 1
         ORDER BY updated_at DESC
         LIMIT $2
       )
       SELECT
         sp.id,
         sp.input,
         sp.source_revision_id,
         sp.created_at,
         lj.id AS job_id,
         lj.status,
         lj.stage,
         lj.progress,
         lj.degradation_state,
         lj.degradation_reason,
         lj.updated_at,
         COUNT(DISTINCT sa.id)::int AS summary_count,
         COUNT(DISTINCT gn.id)::int AS graph_node_count,
         COUNT(DISTINCT ge.id)::int AS graph_edge_count,
         COUNT(DISTINCT te.id)::int AS timeline_count,
         COUNT(DISTINCT ga.id)::int AS glossary_count,
         COUNT(DISTINCT fa.id)::int AS flashcard_count,
         COUNT(DISTINCT qa.id)::int AS quiz_count
       FROM bounded_latest_jobs lj
       JOIN study_packs sp ON sp.id = lj.pack_id
       LEFT JOIN summary_artifacts sa ON sa.pack_id = sp.id
       LEFT JOIN graph_nodes gn ON gn.pack_id = sp.id
       LEFT JOIN graph_edges ge ON ge.pack_id = sp.id
       LEFT JOIN timeline_events te ON te.pack_id = sp.id
       LEFT JOIN glossary_artifacts ga ON ga.pack_id = sp.id
       LEFT JOIN flashcard_artifacts fa ON fa.pack_id = sp.id
       LEFT JOIN quiz_artifacts qa ON qa.pack_id = sp.id
       GROUP BY
         sp.id,
         sp.input,
         sp.source_revision_id,
         sp.created_at,
         lj.id,
         lj.status,
         lj.stage,
         lj.progress,
         lj.degradation_state,
         lj.degradation_reason,
         lj.updated_at
       ORDER BY lj.updated_at DESC`,
      [sessionId, boundedLimit]
    );

    return result.rows.map(historyItemFromRow);
  }

  async savePackForUser(userId: string, packId: string): Promise<void> {
    await this.client.query(
      `INSERT INTO saved_packs (user_id, pack_id, saved_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, pack_id)
       DO UPDATE SET saved_at = EXCLUDED.saved_at`,
      [userId, packId]
    );
  }

  async isPackSavedForUser(userId: string, packId: string): Promise<boolean> {
    const result = await this.client.query(
      `SELECT 1
       FROM saved_packs
       WHERE user_id = $1
         AND pack_id = $2
       LIMIT 1`,
      [userId, packId]
    );
    return result.rows.length > 0;
  }

  async updateSavedPackOrganization(
    userId: string,
    packId: string,
    organization: SavedPackOrganization
  ): Promise<SavedPackOrganization | undefined> {
    const normalized = normalizeSavedPackOrganization(organization);
    const result = await this.client.query(
      `UPDATE saved_packs
       SET tags = $3::text[],
           collection = $4
       WHERE user_id = $1
         AND pack_id = $2
       RETURNING tags, collection`,
      [userId, packId, normalized.tags, normalized.collection ?? null]
    );
    if (!result.rows[0]) {
      return undefined;
    }
    return {
      tags: normalizeDbTextArray(result.rows[0].tags),
      collection: result.rows[0].collection ?? undefined
    };
  }

  async getSavedPackVersionHistory(
    userId: string,
    packId: string,
    limit: number
  ): Promise<SavedPackVersionHistory | undefined> {
    const result = await this.client.query(
      `WITH current_pack AS (
         SELECT sp.input, sp.source_revision_id
         FROM saved_packs saved
         JOIN study_packs sp ON sp.id = saved.pack_id
         WHERE saved.user_id = $1
           AND saved.pack_id = $2
         LIMIT 1
       ),
       candidate_saved AS (
         SELECT saved.pack_id, saved.saved_at
         FROM saved_packs saved
         JOIN study_packs sp ON sp.id = saved.pack_id
         CROSS JOIN current_pack current
         WHERE saved.user_id = $1
           AND (
             saved.pack_id = $2
             OR LOWER(TRIM(sp.input)) = LOWER(TRIM(current.input))
           )
         ORDER BY
           CASE WHEN saved.pack_id = $2 THEN 0 ELSE 1 END,
           saved.saved_at DESC
         LIMIT $3
       ),
       latest_jobs AS (
         SELECT
           gj.*,
           ROW_NUMBER() OVER (PARTITION BY gj.pack_id ORDER BY gj.updated_at DESC, gj.created_at DESC) AS row_num
         FROM generation_jobs gj
         JOIN candidate_saved saved ON saved.pack_id = gj.pack_id
       ),
       artifact_counts AS (
         SELECT
           saved.pack_id,
           COUNT(DISTINCT sa.id)::int AS summary_count,
           COUNT(DISTINCT gn.id)::int AS graph_node_count,
           COUNT(DISTINCT ge.id)::int AS graph_edge_count,
           COUNT(DISTINCT te.id)::int AS timeline_count,
           COUNT(DISTINCT ga.id)::int AS glossary_count,
           COUNT(DISTINCT fa.id)::int AS flashcard_count,
           COUNT(DISTINCT qa.id)::int AS quiz_count
         FROM candidate_saved saved
         LEFT JOIN summary_artifacts sa ON sa.pack_id = saved.pack_id
         LEFT JOIN graph_nodes gn ON gn.pack_id = saved.pack_id
         LEFT JOIN graph_edges ge ON ge.pack_id = saved.pack_id
         LEFT JOIN timeline_events te ON te.pack_id = saved.pack_id
         LEFT JOIN glossary_artifacts ga ON ga.pack_id = saved.pack_id
         LEFT JOIN flashcard_artifacts fa ON fa.pack_id = saved.pack_id
         LEFT JOIN quiz_artifacts qa ON qa.pack_id = saved.pack_id
         GROUP BY saved.pack_id
       )
       SELECT
         sp.id,
         sp.input,
         sp.source_revision_id,
         sp.created_at,
         saved.saved_at,
         lj.id AS job_id,
         lj.status,
         lj.stage,
         lj.progress,
         lj.degradation_state,
         lj.degradation_reason,
         lj.updated_at,
         COALESCE(ac.summary_count, 0)::int AS summary_count,
         COALESCE(ac.graph_node_count, 0)::int AS graph_node_count,
         COALESCE(ac.graph_edge_count, 0)::int AS graph_edge_count,
         COALESCE(ac.timeline_count, 0)::int AS timeline_count,
         COALESCE(ac.glossary_count, 0)::int AS glossary_count,
         COALESCE(ac.flashcard_count, 0)::int AS flashcard_count,
         COALESCE(ac.quiz_count, 0)::int AS quiz_count
       FROM candidate_saved saved
       JOIN study_packs sp ON sp.id = saved.pack_id
       LEFT JOIN latest_jobs lj ON lj.pack_id = sp.id AND lj.row_num = 1
       LEFT JOIN artifact_counts ac ON ac.pack_id = sp.id`,
      [userId, packId, Math.max(1, Math.min(Math.trunc(limit), 50))]
    );
    const currentRow = result.rows.find((row) => row.id === packId);
    if (!currentRow) {
      return undefined;
    }
    const items = result.rows.map((row) =>
      buildSavedPackVersionItem(
        {
          ...historyItemFromRow(row),
          savedAt: new Date(row.saved_at).toISOString()
        },
        artifactCountsFromRow(row),
        packId,
        currentRow.source_revision_id
      )
    );
    return buildSavedPackVersionHistory(items, packId, limit);
  }

  async listSavedPacksForUser(userId: string, limit: number): Promise<StudyPackHistoryItem[]> {
    return (await this.listSavedLibraryForUser(userId, { limit })).items;
  }

  async listSavedLibraryForUser(userId: string, options: SavedLibraryQueryOptions): Promise<SavedLibraryList> {
    const normalized = normalizeSavedLibraryQuery(options);
    const search = normalized.search ? `%${normalized.search.toLowerCase()}%` : null;
    const savedLibraryBaseCte = `WITH candidate_saved AS (
         SELECT saved.pack_id, saved.saved_at, COALESCE(saved.tags, ARRAY[]::TEXT[]) AS tags, saved.collection
         FROM saved_packs saved
         JOIN study_packs sp ON sp.id = saved.pack_id
         WHERE saved.user_id = $1
           AND (
             $2::text IS NULL
             OR LOWER(sp.input) LIKE $2
             OR LOWER(sp.id::text) LIKE $2
             OR LOWER(COALESCE(sp.source_revision_id, '')) LIKE $2
             OR LOWER(COALESCE(saved.collection, '')) LIKE $2
             OR EXISTS (
               SELECT 1
               FROM unnest(COALESCE(saved.tags, ARRAY[]::TEXT[])) AS saved_tag(tag)
               WHERE LOWER(saved_tag.tag) LIKE $2
             )
           )
       ),
       latest_jobs AS (
         SELECT
           gj.*,
           ROW_NUMBER() OVER (PARTITION BY gj.pack_id ORDER BY gj.updated_at DESC, gj.created_at DESC) AS row_num
         FROM generation_jobs gj
         JOIN candidate_saved saved ON saved.pack_id = gj.pack_id
       ),
       artifact_counts AS (
         SELECT
           saved.pack_id,
           COUNT(DISTINCT sa.id)::int AS summary_count,
           COUNT(DISTINCT gn.id)::int AS graph_node_count,
           COUNT(DISTINCT ge.id)::int AS graph_edge_count,
           COUNT(DISTINCT te.id)::int AS timeline_count,
           COUNT(DISTINCT ga.id)::int AS glossary_count,
           COUNT(DISTINCT fa.id)::int AS flashcard_count,
           COUNT(DISTINCT qa.id)::int AS quiz_count
         FROM candidate_saved saved
         LEFT JOIN summary_artifacts sa ON sa.pack_id = saved.pack_id
         LEFT JOIN graph_nodes gn ON gn.pack_id = saved.pack_id
         LEFT JOIN graph_edges ge ON ge.pack_id = saved.pack_id
         LEFT JOIN timeline_events te ON te.pack_id = saved.pack_id
         LEFT JOIN glossary_artifacts ga ON ga.pack_id = saved.pack_id
         LEFT JOIN flashcard_artifacts fa ON fa.pack_id = saved.pack_id
         LEFT JOIN quiz_artifacts qa ON qa.pack_id = saved.pack_id
         GROUP BY saved.pack_id
       ),
       latest_reviews AS (
         SELECT DISTINCT ON (fr.pack_id, fr.card_index)
           fr.pack_id,
           fr.card_index,
           fr.rating,
           fr.next_due_at
         FROM flashcard_reviews fr
         JOIN candidate_saved saved ON saved.pack_id = fr.pack_id
         WHERE fr.user_id = $1
         ORDER BY fr.pack_id, fr.card_index, fr.reviewed_at DESC
       ),
       progress_counts AS (
         SELECT
           lr.pack_id,
           COUNT(*)::int AS reviewed_cards,
           COUNT(*) FILTER (WHERE lr.next_due_at <= NOW())::int AS due_reviewed_cards,
           COALESCE(
             SUM(
               CASE lr.rating
                 WHEN 'again' THEN 0
                 WHEN 'hard' THEN 0.4
                 WHEN 'good' THEN 0.75
                 WHEN 'easy' THEN 1
                 ELSE 0
               END
             ),
             0
           )::float AS mastery_points,
           MIN(lr.next_due_at) AS next_due_at
         FROM latest_reviews lr
         GROUP BY lr.pack_id
       ),
       enriched AS (
         SELECT
           sp.id,
           sp.input,
           sp.source_revision_id,
           sp.created_at,
           saved.saved_at,
           saved.tags,
           saved.collection,
           lj.id AS job_id,
           lj.status,
           lj.stage,
           lj.progress,
           lj.degradation_state,
           lj.degradation_reason,
           lj.updated_at,
           COALESCE(ac.summary_count, 0)::int AS summary_count,
           COALESCE(ac.graph_node_count, 0)::int AS graph_node_count,
           COALESCE(ac.graph_edge_count, 0)::int AS graph_edge_count,
           COALESCE(ac.timeline_count, 0)::int AS timeline_count,
           COALESCE(ac.glossary_count, 0)::int AS glossary_count,
           COALESCE(ac.flashcard_count, 0)::int AS flashcard_count,
           COALESCE(ac.quiz_count, 0)::int AS quiz_count,
           COALESCE(pc.reviewed_cards, 0)::int AS reviewed_cards,
           GREATEST(
             0,
             COALESCE(ac.flashcard_count, 0) - COALESCE(pc.reviewed_cards, 0) + COALESCE(pc.due_reviewed_cards, 0)
           )::int AS due_cards,
           CASE
             WHEN COALESCE(ac.flashcard_count, 0) <= 0 THEN 0
             ELSE LEAST(1, GREATEST(0, COALESCE(pc.mastery_points, 0) / COALESCE(ac.flashcard_count, 0)))
           END AS mastery_score,
           pc.next_due_at,
           CASE
             WHEN COALESCE(ac.summary_count, 0) > 0
              AND (
                COALESCE(ac.graph_node_count, 0) > 0
                OR COALESCE(ac.graph_edge_count, 0) > 0
                OR COALESCE(ac.timeline_count, 0) > 0
              )
              AND COALESCE(ac.glossary_count, 0) > 0
              AND COALESCE(ac.flashcard_count, 0) > 0
              AND COALESCE(ac.quiz_count, 0) > 0
             THEN 'full'
             ELSE 'partial'
           END AS readiness_status
         FROM candidate_saved saved
         JOIN study_packs sp ON sp.id = saved.pack_id
         LEFT JOIN latest_jobs lj ON lj.pack_id = sp.id AND lj.row_num = 1
         LEFT JOIN artifact_counts ac ON ac.pack_id = sp.id
         LEFT JOIN progress_counts pc ON pc.pack_id = sp.id
       )
      `;
    const facetsResult = await this.client.query(
      `${savedLibraryBaseCte}
       SELECT
         counts.total_count,
         counts.readiness_full,
         counts.readiness_partial,
         counts.progress_due,
         counts.progress_reviewed,
         counts.progress_not_started,
         COALESCE(tag_facets.tags, '[]'::json) AS tags,
         COALESCE(collection_facets.collections, '[]'::json) AS collections
       FROM (
         SELECT
           COUNT(*)::int AS total_count,
           COUNT(*) FILTER (WHERE readiness_status = 'full')::int AS readiness_full,
           COUNT(*) FILTER (WHERE readiness_status = 'partial')::int AS readiness_partial,
           COUNT(*) FILTER (WHERE due_cards > 0)::int AS progress_due,
           COUNT(*) FILTER (WHERE reviewed_cards > 0)::int AS progress_reviewed,
           COUNT(*) FILTER (WHERE reviewed_cards = 0)::int AS progress_not_started
         FROM enriched
       ) counts
       CROSS JOIN LATERAL (
         SELECT json_agg(json_build_object('tag', tag, 'count', tag_count) ORDER BY tag_count DESC, tag ASC) AS tags
         FROM (
           SELECT tag, COUNT(*)::int AS tag_count
           FROM enriched
           CROSS JOIN LATERAL unnest(enriched.tags) AS tag(tag)
           WHERE tag <> ''
           GROUP BY tag
           ORDER BY tag_count DESC, tag ASC
           LIMIT 30
         ) ranked_tags
       ) tag_facets
       CROSS JOIN LATERAL (
         SELECT json_agg(json_build_object('collection', collection, 'count', collection_count) ORDER BY collection_count DESC, collection ASC) AS collections
         FROM (
           SELECT collection, COUNT(*)::int AS collection_count
           FROM enriched
           WHERE collection IS NOT NULL AND collection <> ''
           GROUP BY collection
           ORDER BY collection_count DESC, collection ASC
           LIMIT 30
         ) ranked_collections
       ) collection_facets`,
      [userId, search]
    );
    const result = await this.client.query(
      `${savedLibraryBaseCte}
       SELECT
         *
       FROM enriched
       WHERE ($3::text = 'all' OR readiness_status = $3)
         AND (
           $4::text = 'all'
           OR ($4::text = 'due' AND due_cards > 0)
           OR ($4::text = 'reviewed' AND reviewed_cards > 0)
           OR ($4::text = 'not_started' AND reviewed_cards = 0)
         )
         AND ($6::text IS NULL OR $6 = ANY(tags))
         AND ($7::text IS NULL OR collection = $7)
       ORDER BY
         CASE WHEN $5::text = 'saved_asc' THEN saved_at END ASC NULLS LAST,
         CASE WHEN $5::text = 'title_asc' THEN LOWER(input) END ASC NULLS LAST,
         CASE WHEN $5::text = 'title_desc' THEN LOWER(input) END DESC NULLS LAST,
         CASE WHEN $5::text = 'due_desc' THEN due_cards END DESC NULLS LAST,
         CASE WHEN $5::text = 'mastery_desc' THEN mastery_score END DESC NULLS LAST,
         CASE WHEN $5::text = 'saved_desc' THEN saved_at END DESC NULLS LAST,
         saved_at DESC,
         LOWER(input) ASC
       LIMIT $8`,
      [userId, search, normalized.readiness, normalized.progress, normalized.sort, normalized.tag ?? null, normalized.collection ?? null, normalized.limit]
    );
    const items = result.rows.map((row) => {
      const item = historyItemFromRow(row);
      return {
        ...item,
        savedAt: new Date(row.saved_at).toISOString(),
        organization: {
          tags: normalizeDbTextArray(row.tags),
          collection: row.collection ?? undefined
        },
        progress: {
          totalCards: Number(row.flashcard_count ?? 0),
          reviewedCards: Number(row.reviewed_cards ?? 0),
          dueCards: Number(row.due_cards ?? 0),
          masteryScore: Math.max(0, Math.min(1, Number(row.mastery_score ?? 0))),
          nextDueAt: row.next_due_at ? new Date(row.next_due_at).toISOString() : undefined
        }
      };
    });
    const facetRow = facetsResult.rows[0] ?? {};

    return {
      items,
      facets: {
        total: Number(facetRow.total_count ?? 0),
        readiness: {
          full: Number(facetRow.readiness_full ?? 0),
          partial: Number(facetRow.readiness_partial ?? 0)
        },
        progress: {
          due: Number(facetRow.progress_due ?? 0),
          reviewed: Number(facetRow.progress_reviewed ?? 0),
          notStarted: Number(facetRow.progress_not_started ?? 0)
        },
        tags: parseJsonFacetArray(facetRow.tags, 'tag'),
        collections: parseJsonFacetArray(facetRow.collections, 'collection')
      }
    };
  }

}
