import { randomUUID } from 'node:crypto';
import type { Flashcard, QuizQuestion } from '../domain/activeRecall.js';
import type { ArtifactCacheKind } from '../domain/cachePolicy.js';
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
  CostTrendSnapshot,
  HistoryMissingArtifact,
  IdempotencyResult,
  JobCompletionSample,
  JobFailureSample,
  OperationalMetricsSnapshot,
  OutcomesMaintenanceSnapshot,
  OutcomesSnapshot,
  PackRecord,
  QuizAttemptRecord,
  StageCostSample,
  StudyPackHistoryItem
} from './types.js';

export type PgClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
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

export class PostgresRepo implements AppRepo {
  constructor(private readonly client: PgClient) {}

  async createOrReuseByIdempotency(key: string, ttlSeconds: number): Promise<IdempotencyResult> {
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

  async saveQuizAttempt(packId: string, selectedIndices: number[]): Promise<QuizAttemptRecord | undefined> {
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

      const inserted = await this.client.query(
        `INSERT INTO quiz_attempts (id, pack_id, total_questions, correct_answers, accuracy)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, pack_id, total_questions, correct_answers, accuracy, submitted_at`,
        [randomUUID(), packId, totalQuestions, correctAnswers, accuracy]
      );

      await this.client.query('COMMIT');
      const row = inserted.rows[0];
      return {
        id: row.id,
        packId: row.pack_id,
        totalQuestions: Number(row.total_questions),
        correctAnswers: Number(row.correct_answers),
        accuracy: toNumber(row.accuracy),
        submittedAt: new Date(row.submitted_at).toISOString()
      };
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
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

  async getOutcomesSnapshot(): Promise<OutcomesSnapshot> {
    const outcomes = await this.client.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         COALESCE(AVG(duration_ms) FILTER (WHERE status = 'completed'), 0)::float8 AS avg_duration_ms,
         COALESCE(AVG(citation_rate) FILTER (WHERE status = 'completed'), 0)::float8 AS avg_citation_rate,
         COALESCE(AVG(flashcards_count) FILTER (WHERE status = 'completed'), 0)::float8 AS avg_flashcards,
         COALESCE(AVG(quiz_questions_count) FILTER (WHERE status = 'completed'), 0)::float8 AS avg_quiz_questions
       FROM generation_outcomes`
    );
    const learning = await this.client.query(
      `SELECT
         COUNT(*)::int AS attempts,
         COALESCE(AVG(accuracy), 0)::float8 AS avg_accuracy
       FROM quiz_attempts`
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
       GROUP BY stage
       ORDER BY stage ASC`
    );
    const costTotals = await this.client.query(
      `SELECT
         COALESCE(SUM(estimated_cost_usd), 0)::float8 AS total_estimated_usd,
         COUNT(DISTINCT pack_id)::int AS distinct_packs
       FROM stage_cost_events`
    );
    const sloPercentiles = await this.client.query(
      `WITH first_artifact AS (
         SELECT
           job_id,
           SUM(latency_ms)::float8 AS time_to_first_artifact_ms
         FROM stage_cost_events
         WHERE stage IN ('ingestion', 'summarization')
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
           ),
           0
         )::float8 AS p95_full_pack_completion_ms
       FROM first_artifact`
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
        avgAccuracy: toNumber(learning.rows[0]?.avg_accuracy)
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
    const result = await this.client.query(
      `WITH latest_jobs AS (
         SELECT
           gj.*,
           ROW_NUMBER() OVER (PARTITION BY gj.pack_id ORDER BY gj.updated_at DESC, gj.created_at DESC) AS row_num
         FROM generation_jobs gj
         WHERE gj.session_id = $1
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
       FROM latest_jobs lj
       JOIN study_packs sp ON sp.id = lj.pack_id
       LEFT JOIN summary_artifacts sa ON sa.pack_id = sp.id
       LEFT JOIN graph_nodes gn ON gn.pack_id = sp.id
       LEFT JOIN graph_edges ge ON ge.pack_id = sp.id
       LEFT JOIN timeline_events te ON te.pack_id = sp.id
       LEFT JOIN glossary_artifacts ga ON ga.pack_id = sp.id
       LEFT JOIN flashcard_artifacts fa ON fa.pack_id = sp.id
       LEFT JOIN quiz_artifacts qa ON qa.pack_id = sp.id
       WHERE lj.row_num = 1
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
       ORDER BY lj.updated_at DESC
       LIMIT $2`,
      [sessionId, Math.max(1, Math.min(limit, 50))]
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

  async listSavedPacksForUser(userId: string, limit: number): Promise<StudyPackHistoryItem[]> {
    const result = await this.client.query(
      `WITH latest_jobs AS (
         SELECT
           gj.*,
           ROW_NUMBER() OVER (PARTITION BY gj.pack_id ORDER BY gj.updated_at DESC, gj.created_at DESC) AS row_num
         FROM generation_jobs gj
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
         COUNT(DISTINCT sa.id)::int AS summary_count,
         COUNT(DISTINCT gn.id)::int AS graph_node_count,
         COUNT(DISTINCT ge.id)::int AS graph_edge_count,
         COUNT(DISTINCT te.id)::int AS timeline_count,
         COUNT(DISTINCT ga.id)::int AS glossary_count,
         COUNT(DISTINCT fa.id)::int AS flashcard_count,
         COUNT(DISTINCT qa.id)::int AS quiz_count
       FROM saved_packs saved
       JOIN study_packs sp ON sp.id = saved.pack_id
       LEFT JOIN latest_jobs lj ON lj.pack_id = sp.id AND lj.row_num = 1
       LEFT JOIN summary_artifacts sa ON sa.pack_id = sp.id
       LEFT JOIN graph_nodes gn ON gn.pack_id = sp.id
       LEFT JOIN graph_edges ge ON ge.pack_id = sp.id
       LEFT JOIN timeline_events te ON te.pack_id = sp.id
       LEFT JOIN glossary_artifacts ga ON ga.pack_id = sp.id
       LEFT JOIN flashcard_artifacts fa ON fa.pack_id = sp.id
       LEFT JOIN quiz_artifacts qa ON qa.pack_id = sp.id
       WHERE saved.user_id = $1
       GROUP BY
         sp.id,
         sp.input,
         sp.source_revision_id,
         sp.created_at,
         saved.saved_at,
         lj.id,
         lj.status,
         lj.stage,
         lj.progress,
         lj.degradation_state,
         lj.degradation_reason,
         lj.updated_at
       ORDER BY saved.saved_at DESC
       LIMIT $2`,
      [userId, Math.max(1, Math.min(limit, 50))]
    );

    return result.rows.map(historyItemFromRow);
  }
}
