import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  artifactSchemaVersion,
  createStudyPackRequestSchema,
  createStudyPackResponseSchema,
  outcomesAnalyticsSchema,
  jobStatusSchema,
  quizAttemptRequestSchema,
  quizAttemptResponseSchema,
  studyPackSchema
} from '../contracts/studyPack.js';
import { getConfig } from '../config.js';
import { getRepo } from '../repo/index.js';
import { parseTopicInput, fetchWikipediaSections } from '../domain/ingestion.js';
import { generateActiveRecallArtifacts } from '../domain/activeRecall.js';
import { generateKnowledgeStructureArtifacts } from '../domain/knowledgeStructure.js';
import { computeGroundingStats, generateGroundedSummaries } from '../domain/summary.js';
import { classifyError, nextRetryState } from '../domain/retryPolicy.js';
import { reapStuckJobs } from '../domain/reaper.js';
import { BudgetPolicy } from '../domain/budgetPolicy.js';
import { isLikelyWikipediaInput } from '../domain/security.js';
import { telemetry } from '../telemetry/otel.js';
import { formatOutcomesPrometheus } from '../telemetry/outcomes.js';
import type { Job } from '../domain/jobs.js';

const config = getConfig();
const repo = getRepo();
const budgetPolicy = new BudgetPolicy(config.tokenBudgetPerJob, config.latencyBudgetMs);

let queueProcessorStarted = false;
let queueProcessorBusy = false;

const getSessionId = (req: Request): string => {
  const header = req.header('x-session-id');
  return header && header.length > 0 ? header : `anon-${randomUUID()}`;
};

const estimateWork = (input: string): { estimatedTokens: number; estimatedLatencyMs: number } => ({
  estimatedTokens: Math.ceil(input.length / 3),
  estimatedLatencyMs: 5_000 + Math.ceil(input.length / 2)
});

const estimateTokensFromText = (...parts: string[]): number => {
  const charCount = parts.reduce((acc, part) => acc + part.length, 0);
  return Math.max(1, Math.ceil(charCount / 4));
};

const estimateStageCostUsd = (
  stage: 'ingestion' | 'summarization' | 'active_recall' | 'knowledge_structure',
  estimatedTokens: number
): number => {
  const usdPer1kTokensByStage = {
    ingestion: 0.0001,
    summarization: 0.008,
    active_recall: 0.007,
    knowledge_structure: 0.006
  } as const;
  const usd = (estimatedTokens / 1000) * usdPer1kTokensByStage[stage];
  return Number(usd.toFixed(6));
};

const processOneQueuedJob = async (): Promise<void> => {
  if (queueProcessorBusy) {
    return;
  }

  queueProcessorBusy = true;
  let job: Job | undefined;
  let sessionIdToRelease: string | undefined;
  let startedAt = 0;

  try {
    const activeGlobal = await repo.countRunningJobs();
    if (activeGlobal >= config.globalConcurrencyLimit) {
      return;
    }

    job = await repo.claimNextQueuedJob();
    if (!job) {
      return;
    }

    sessionIdToRelease = job.sessionId;
    startedAt = Date.now();
    const span = telemetry.startSpan('job.ingestion');
    telemetry.setAttribute(span, 'job.id', job.id);
    telemetry.setAttribute(span, 'pack.id', job.packId);

    try {
      const pack = await repo.getPack(job.packId);
      if (!pack) {
        throw new Error('pack_not_found');
      }

      job.progress = 10;
      job.heartbeatAt = Date.now();
      await repo.upsertJob(job);

      const ingestionStartedAt = Date.now();
      const parsedInput = parseTopicInput(pack.input, config.wikipediaLang);
      const page = await fetchWikipediaSections(parsedInput.title, config.wikipediaLang);
      await repo.saveIngestedPack(job.packId, pack.input, page);
      const ingestionLatencyMs = Date.now() - ingestionStartedAt;
      const ingestionTokens = estimateTokensFromText(
        pack.input,
        ...page.sections.map((section) => `${section.heading}\n${section.content}`)
      );
      await repo.recordStageCost({
        jobId: job.id,
        packId: job.packId,
        stage: 'ingestion',
        estimatedTokens: ingestionTokens,
        latencyMs: ingestionLatencyMs,
        estimatedCostUsd: estimateStageCostUsd('ingestion', ingestionTokens),
        promptVersion: 'wikipedia-parser@1.0.0',
        model: 'deterministic-parser'
      });

      job.stage = 'summarization';
      job.progress = 60;
      job.heartbeatAt = Date.now();
      await repo.upsertJob(job);

      const summaryStartedAt = Date.now();
      const summaries = generateGroundedSummaries(page.sections);
      await repo.saveSummaries(job.packId, summaries);
      const groundingStats = computeGroundingStats(summaries);
      const summarizationLatencyMs = Date.now() - summaryStartedAt;
      const summarizationTokens = estimateTokensFromText(
        ...summaries.map((summary) => `${summary.text}\n${summary.citations.join('\n')}`)
      );
      await repo.recordStageCost({
        jobId: job.id,
        packId: job.packId,
        stage: 'summarization',
        estimatedTokens: summarizationTokens,
        latencyMs: summarizationLatencyMs,
        estimatedCostUsd: estimateStageCostUsd('summarization', summarizationTokens),
        promptVersion: summaries[0]?.promptVersion ?? 'summary-by-level@1.0.0',
        model: summaries[0]?.model ?? 'local-rule-based'
      });

      job.stage = 'active_recall';
      job.progress = 80;
      job.heartbeatAt = Date.now();
      await repo.upsertJob(job);

      const activeRecallStartedAt = Date.now();
      const activeRecall = generateActiveRecallArtifacts(page.sections);
      await repo.saveActiveRecall(job.packId, activeRecall.flashcards, activeRecall.quizQuestions);
      const activeRecallLatencyMs = Date.now() - activeRecallStartedAt;
      const activeRecallTokens = estimateTokensFromText(
        ...activeRecall.flashcards.map((card) => `${card.question}\n${card.answer}`),
        ...activeRecall.quizQuestions.map(
          (question) => `${question.question}\n${question.options.join('\n')}\n${question.explanation}`
        )
      );
      await repo.recordStageCost({
        jobId: job.id,
        packId: job.packId,
        stage: 'active_recall',
        estimatedTokens: activeRecallTokens,
        latencyMs: activeRecallLatencyMs,
        estimatedCostUsd: estimateStageCostUsd('active_recall', activeRecallTokens),
        promptVersion:
          activeRecall.flashcards[0]?.promptVersion ??
          activeRecall.quizQuestions[0]?.promptVersion ??
          'active-recall@1.0.0',
        model: activeRecall.flashcards[0]?.model ?? activeRecall.quizQuestions[0]?.model ?? 'local-rule-based'
      });

      job.stage = 'knowledge_structure';
      job.progress = 90;
      job.heartbeatAt = Date.now();
      await repo.upsertJob(job);

      const knowledgeStartedAt = Date.now();
      const knowledge = generateKnowledgeStructureArtifacts(page.sections);
      await repo.saveKnowledgeStructure(job.packId, knowledge.nodes, knowledge.edges, knowledge.timeline);
      const knowledgeLatencyMs = Date.now() - knowledgeStartedAt;
      const knowledgeTokens = estimateTokensFromText(
        ...knowledge.nodes.map((node) => `${node.label}\n${node.type}`),
        ...knowledge.edges.map((edge) => `${edge.source}\n${edge.target}\n${edge.relation}`),
        ...knowledge.timeline.map((event) => `${event.dateLabel}\n${event.description}`)
      );
      await repo.recordStageCost({
        jobId: job.id,
        packId: job.packId,
        stage: 'knowledge_structure',
        estimatedTokens: knowledgeTokens,
        latencyMs: knowledgeLatencyMs,
        estimatedCostUsd: estimateStageCostUsd('knowledge_structure', knowledgeTokens),
        promptVersion: 'knowledge-structure-rules@1.0.0',
        model: 'local-rule-based'
      });

      job.progress = 100;
      job.stage = 'done';
      job.status = 'completed';
      job.heartbeatAt = Date.now();
      await repo.upsertJob(job);
      await repo.recordJobCompletion({
        jobId: job.id,
        packId: job.packId,
        durationMs: Date.now() - startedAt,
        citationRate: groundingStats.citationRate,
        flashcards: activeRecall.flashcards.length,
        quizQuestions: activeRecall.quizQuestions.length
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      const failureType = classifyError(message);
      job.status = 'failed';
      job.retryState = nextRetryState(job.attempt, 3, failureType);
      job.errors.push(message);
      if (job.retryState === 'retrying') {
        job.status = 'queued';
      } else {
        await repo.recordJobFailure({ jobId: job.id, packId: job.packId });
      }
      await repo.upsertJob(job);
    } finally {
      telemetry.endSpan(span);
    }
  } finally {
    queueProcessorBusy = false;
    void sessionIdToRelease;
  }
};

const startQueueProcessor = (): void => {
  if (queueProcessorStarted) {
    return;
  }
  if (process.env.DISABLE_QUEUE_POLLING === '1') {
    return;
  }

  queueProcessorStarted = true;
  const handle = setInterval(() => {
    void processOneQueuedJob();
  }, 500);
  handle.unref();
};

export const registerApiRoutes = (app: Express): void => {
  startQueueProcessor();

  app.post('/api/study-packs', async (req: Request, res: Response) => {
    const parsed = createStudyPackRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    if (!isLikelyWikipediaInput(parsed.data.title_or_url)) {
      res.status(400).json({ error: 'Input must be an English Wikipedia URL or title' });
      return;
    }

    const budget = budgetPolicy.evaluate(estimateWork(parsed.data.title_or_url));
    if (!budget.allowed) {
      res.status(422).json({
        error: 'budget_exceeded',
        reason: budget.reason
      });
      return;
    }

    const sessionId = getSessionId(req);
    const idempotent = await repo.createOrReuseByIdempotency(parsed.data.idempotency_key, config.idempotencyTtlSeconds);
    if (idempotent.reused) {
      const payload = createStudyPackResponseSchema.parse({
        pack_id: idempotent.packId,
        job_id: idempotent.jobId,
        accepted_at: new Date().toISOString()
      });
      res.status(202).json(payload);
      return;
    }

    const queueDepth = await repo.countQueuedJobs();
    const sessionInflight = await repo.countInflightJobsForSession(sessionId);
    if (queueDepth >= config.maxQueueDepth) {
      res.status(429).json({ error: 'admission_denied', reason: 'queue_full' });
      return;
    }
    if (sessionInflight >= config.sessionConcurrencyLimit) {
      res.status(429).json({ error: 'admission_denied', reason: 'session_limit' });
      return;
    }

    await repo.createPendingPack(idempotent.packId, parsed.data.title_or_url);
    await repo.upsertJob({
      id: idempotent.jobId,
      packId: idempotent.packId,
      sessionId,
      stage: 'ingestion',
      status: 'queued',
      progress: 0,
      attempt: 0,
      retryState: 'none',
      degradationState: 'none',
      errors: [],
      heartbeatAt: Date.now()
    });

    void processOneQueuedJob();

    const payload = createStudyPackResponseSchema.parse({
      pack_id: idempotent.packId,
      job_id: idempotent.jobId,
      accepted_at: new Date().toISOString()
    });

    res.status(202).json(payload);
  });

  app.post('/api/internal/reaper', async (_req: Request, res: Response) => {
    const jobs = await repo.listJobs();
    const result = reapStuckJobs(jobs, Date.now(), 30_000);
    const changedIds = new Set([...result.recovered, ...result.quarantined]);

    await Promise.all(
      jobs.filter((job) => changedIds.has(job.id)).map(async (job) => {
        await repo.upsertJob(job);
      })
    );

    res.status(200).json(result);
  });

  app.get('/api/jobs/:id', async (req: Request, res: Response) => {
    const job = await repo.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'job_not_found' });
      return;
    }

    const payload = jobStatusSchema.parse({
      id: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      attempt: job.attempt,
      retry_state: job.retryState,
      degradation_state: job.degradationState,
      errors: job.errors.length > 0 ? job.errors : undefined
    });
    res.status(200).json(payload);
  });

  app.post('/api/quiz-attempts', async (req: Request, res: Response) => {
    const parsed = quizAttemptRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const pack = await repo.getPack(parsed.data.pack_id);
    if (!pack) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    if (pack.quizQuestions.length === 0) {
      res.status(409).json({ error: 'quiz_not_ready' });
      return;
    }

    if (parsed.data.selected_indices.length !== pack.quizQuestions.length) {
      res.status(400).json({
        error: 'invalid_attempt_payload',
        reason: `expected ${pack.quizQuestions.length} answers`
      });
      return;
    }

    const savedAttempt = await repo.saveQuizAttempt(parsed.data.pack_id, parsed.data.selected_indices);
    if (!savedAttempt) {
      res.status(409).json({ error: 'quiz_not_ready' });
      return;
    }

    const payload = quizAttemptResponseSchema.parse({
      attempt_id: savedAttempt.id,
      pack_id: savedAttempt.packId,
      total_questions: savedAttempt.totalQuestions,
      correct_answers: savedAttempt.correctAnswers,
      accuracy: savedAttempt.accuracy,
      submitted_at: savedAttempt.submittedAt
    });
    res.status(200).json(payload);
  });

  app.get('/api/analytics/outcomes', async (_req: Request, res: Response) => {
    const snapshot = await repo.getOutcomesSnapshot();
    const payload = outcomesAnalyticsSchema.parse({
      generated_at: new Date().toISOString(),
      jobs: {
        completed: snapshot.jobs.completed,
        failed: snapshot.jobs.failed,
        avg_duration_ms: snapshot.jobs.avgDurationMs,
        completion_rate: snapshot.jobs.completionRate
      },
      quality: {
        avg_citation_rate: snapshot.quality.avgCitationRate,
        avg_flashcards: snapshot.quality.avgFlashcards,
        avg_quiz_questions: snapshot.quality.avgQuizQuestions
      },
      learning: {
        attempts: snapshot.learning.attempts,
        avg_accuracy: snapshot.learning.avgAccuracy
      },
      slo: {
        p95_time_to_first_artifact_ms: snapshot.slo.p95TimeToFirstArtifactMs,
        p95_full_pack_completion_ms: snapshot.slo.p95FullPackCompletionMs,
        job_success_rate: snapshot.slo.jobSuccessRate,
        citation_coverage_rate: snapshot.slo.citationCoverageRate
      },
      cost: {
        total_estimated_usd: snapshot.cost.totalEstimatedUsd,
        avg_estimated_usd_per_pack: snapshot.cost.avgEstimatedUsdPerPack,
        by_stage: snapshot.cost.byStage.map((entry) => ({
          stage: entry.stage,
          events: entry.events,
          avg_tokens: entry.avgTokens,
          avg_latency_ms: entry.avgLatencyMs,
          total_estimated_usd: entry.totalEstimatedUsd,
          avg_estimated_usd: entry.avgEstimatedUsd
        }))
      }
    });

    res.status(200).json(payload);
  });

  app.get('/api/metrics/outcomes', async (_req: Request, res: Response) => {
    const snapshot = await repo.getOutcomesSnapshot();
    const maintenance = await repo.getOutcomesMaintenanceSnapshot();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.status(200).send(
      formatOutcomesPrometheus({
        generatedAt: new Date().toISOString(),
        jobs: snapshot.jobs,
        quality: snapshot.quality,
        learning: snapshot.learning,
        slo: snapshot.slo,
        cost: snapshot.cost
      }, maintenance)
    );
  });

  app.get('/api/study-packs/:id', async (req: Request, res: Response) => {
    const pack = await repo.getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }
    const groundingStats = computeGroundingStats(pack.summaries);

    const payload = studyPackSchema.parse({
      id: pack.id,
      input: pack.input,
      source_revision_id: pack.sourceRevisionId,
      schema_version: artifactSchemaVersion,
      grounding_stats: {
        citation_rate: groundingStats.citationRate,
        unsupported_claims: groundingStats.unsupportedClaims
      },
      sections: pack.sections,
      summaries: pack.summaries.map((s) => ({
        level: s.level,
        text: s.text,
        citations: s.citations,
        prompt_version: s.promptVersion,
        model: s.model
      })),
      flashcards: pack.flashcards.map((f) => ({
        question: f.question,
        answer: f.answer,
        citation: f.citation,
        prompt_version: f.promptVersion,
        model: f.model
      })),
      quiz_questions: pack.quizQuestions.map((q) => ({
        question: q.question,
        options: q.options,
        correct_index: q.correctIndex,
        explanation: q.explanation,
        citation: q.citation,
        prompt_version: q.promptVersion,
        model: q.model
      })),
      graph: {
        nodes: pack.graphNodes.map((node) => ({
          id: node.id,
          label: node.label,
          type: node.type,
          citation: node.citation
        })),
        edges: pack.graphEdges.map((edge) => ({
          source: edge.source,
          target: edge.target,
          relation: edge.relation,
          citation: edge.citation
        }))
      },
      timeline: pack.timelineEvents.map((event) => ({
        year: event.year,
        date_label: event.dateLabel,
        description: event.description,
        citation: event.citation
      }))
    });

    res.status(200).json(payload);
  });
};
