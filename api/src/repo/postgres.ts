import { randomUUID } from 'node:crypto';
import type { Flashcard, QuizQuestion } from '../domain/activeRecall.js';
import type { IngestedPage } from '../domain/ingestion.js';
import type { Job } from '../domain/jobs.js';
import type { GraphEdge, GraphNode, TimelineEvent } from '../domain/knowledgeStructure.js';
import type { SummaryArtifact } from '../domain/summary.js';
import type {
  AppRepo,
  IdempotencyResult,
  JobCompletionSample,
  JobFailureSample,
  OutcomesMaintenanceSnapshot,
  OutcomesSnapshot,
  PackRecord,
  QuizAttemptRecord,
  StageCostSample
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
  errors: Array.isArray(row.errors) ? row.errors : [],
  heartbeatAt: new Date(row.heartbeat_at).getTime()
});

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
        (id, pack_id, session_id, stage, status, progress, attempt, retry_state, degradation_state, errors, heartbeat_at, updated_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, to_timestamp($11 / 1000.0), NOW())
       ON CONFLICT (id)
       DO UPDATE SET
        stage = EXCLUDED.stage,
        status = EXCLUDED.status,
        progress = EXCLUDED.progress,
        attempt = EXCLUDED.attempt,
        retry_state = EXCLUDED.retry_state,
        degradation_state = EXCLUDED.degradation_state,
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
      for (const section of page.sections) {
        await this.client.query(
          `INSERT INTO source_sections (pack_id, heading, content)
           VALUES ($1, $2, $3)`,
          [packId, section.heading, section.content]
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
          `INSERT INTO quiz_artifacts (pack_id, question, options, correct_index, explanation, citation, prompt_version, model)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)`,
          [
            packId,
            quiz.question,
            JSON.stringify(quiz.options),
            quiz.correctIndex,
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
          stage: row.stage as 'ingestion' | 'summarization' | 'active_recall' | 'knowledge_structure',
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

  async getPack(packId: string): Promise<PackRecord | undefined> {
    const packResult = await this.client.query('SELECT * FROM study_packs WHERE id = $1', [packId]);
    if (packResult.rows.length === 0) return undefined;

    const sectionResult = await this.client.query(
      'SELECT heading, content FROM source_sections WHERE pack_id = $1 ORDER BY id ASC',
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
    const quizResult = await this.client.query(
      `SELECT question, options, correct_index, explanation, citation, prompt_version, model
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
      sections: sectionResult.rows.map((row) => ({ heading: row.heading, content: row.content })),
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
      quizQuestions: quizResult.rows.map((row) => ({
        question: row.question,
        options: Array.isArray(row.options) ? row.options : [],
        correctIndex: Number(row.correct_index),
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
}
