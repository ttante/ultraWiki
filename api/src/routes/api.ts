import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  artifactSchemaVersion,
  costAnalyticsSchema,
  createShareLinkRequestSchema,
  createShareLinkResponseSchema,
  createStudyPackRequestSchema,
  createStudyPackResponseSchema,
  flashcardReviewRequestSchema,
  flashcardReviewResponseSchema,
  learningProgressSchema,
  outcomesAnalyticsSchema,
  jobStatusSchema,
  queueStatusSchema,
  quizAttemptRequestSchema,
  quizAttemptResponseSchema,
  sharedStudyPackResponseSchema,
  sloAnalyticsSchema,
  studyPackHistorySchema,
  studyPackSchema,
  upsertUserProfileRequestSchema,
  userProfileSchema
} from '../contracts/studyPack.js';
import { getConfig } from '../config.js';
import { getRepo } from '../repo/index.js';
import { parseTopicInput, fetchWikipediaSections } from '../domain/ingestion.js';
import { generateActiveRecallArtifacts } from '../domain/activeRecall.js';
import { generateGlossaryArtifacts } from '../domain/glossary.js';
import { createLlmArtifactGenerator } from '../domain/llmArtifacts.js';
import { OpenAiCompatibleLlmClient } from '../domain/llmProvider.js';
import { generateKnowledgeStructureArtifacts } from '../domain/knowledgeStructure.js';
import { formatStudyPackExport, parseStudyPackExportFormat } from '../domain/studyPackExport.js';
import { computeGroundingStats, generateGroundedSummaries } from '../domain/summary.js';
import { buildLearnNextRecommendations } from '../domain/recommendations.js';
import {
  buildArtifactCacheKey,
  buildSourceCacheKey,
  cachePolicy,
  expiresAtFromNow
} from '../domain/cachePolicy.js';
import { classifyError, nextRetryState } from '../domain/retryPolicy.js';
import { reapStuckJobs } from '../domain/reaper.js';
import { BudgetPolicy } from '../domain/budgetPolicy.js';
import { sloTargets } from '../domain/slo.js';
import {
  isLikelyWikipediaInput,
  sanitizeSourceText,
  securityEventMetrics,
  SecuritySignatureTracker
} from '../domain/security.js';
import { telemetry } from '../telemetry/otel.js';
import { formatOutcomesPrometheus } from '../telemetry/outcomes.js';
import { llmTelemetry } from '../telemetry/llm.js';
import type { Job } from '../domain/jobs.js';
import { logSecurityEvent } from '../logger.js';
import type { CacheEventRecord, PackRecord } from '../repo/types.js';

const config = getConfig();
const repo = getRepo();
const llmClient =
  config.llmProvider === 'openai_compatible'
    ? new OpenAiCompatibleLlmClient({
        baseUrl: config.llmBaseUrl,
        model: config.llmModel,
        timeoutMs: config.llmTimeoutMs
      })
    : undefined;
const artifactGenerator = createLlmArtifactGenerator({
  client: llmClient,
  model: config.llmModel,
  onEvent: (event) => {
    llmTelemetry.record({
      ...event,
      provider: config.llmProvider,
      model: config.llmModel,
      stage: event.schemaName
    });
  }
});
const budgetPolicy = new BudgetPolicy(config.tokenBudgetPerJob, config.latencyBudgetMs);
const securityTracker = new SecuritySignatureTracker(
  config.securityAlertSignatureThreshold,
  config.securityAlertWindowSeconds
);

const parseWindowHours = (value: unknown, fallback = 24): number => {
  if (typeof value !== 'string') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(720, Math.max(1, parsed));
};

const parseLimit = (value: unknown, fallback = 12): number => {
  if (typeof value !== 'string') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(50, Math.max(1, parsed));
};

let queueProcessorStarted = false;
let queueProcessorBusy = false;

const getSessionId = (req: Request): string => {
  const header = req.header('x-session-id');
  return header && header.length > 0 ? header : `anon-${randomUUID()}`;
};

const getUserId = (req: Request): string | undefined => {
  const header = req.header('x-user-id')?.trim();
  return header && header.length > 0 ? header : undefined;
};

const getUserDisplayName = (req: Request): string | undefined => {
  const header = req.header('x-user-name')?.trim();
  return header && header.length > 0 ? header : undefined;
};

const getCorrelationId = (req: Request): string => req.header('x-request-id') ?? randomUUID();

const estimateWork = (input: string): { estimatedTokens: number; estimatedLatencyMs: number } => ({
  estimatedTokens: Math.ceil(input.length / 3),
  estimatedLatencyMs: 5_000 + Math.ceil(input.length / 2)
});

const estimateTokensFromText = (...parts: string[]): number => {
  const charCount = parts.reduce((acc, part) => acc + part.length, 0);
  return Math.max(1, Math.ceil(charCount / 4));
};

const estimateStageCostUsd = (
  stage: 'ingestion' | 'summarization' | 'knowledge_structure' | 'glossary' | 'active_recall',
  estimatedTokens: number
): number => {
  const usdPer1kTokensByStage = {
    ingestion: 0.0001,
    summarization: 0.008,
    knowledge_structure: 0.006,
    glossary: 0.004,
    active_recall: 0.007
  } as const;
  const usd = (estimatedTokens / 1000) * usdPer1kTokensByStage[stage];
  return Number(usd.toFixed(6));
};

const deriveWikipediaTitle = (input: string): string => {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/wiki\/([^?#]+)/i);
  if (urlMatch && urlMatch[1]) {
    return decodeURIComponent(urlMatch[1].replace(/_/g, ' '));
  }
  return trimmed;
};

const serializeCacheEvent = (event: CacheEventRecord) => ({
  stage: event.stage,
  cache_key: event.cacheKey,
  hit: event.hit,
  source_revision_id: event.sourceRevisionId,
  parser_version: event.parserVersion,
  prompt_version: event.promptVersion,
  taxonomy_version: event.taxonomyVersion,
  cached_at: event.cachedAt,
  expires_at: event.expiresAt,
  recorded_at: event.recordedAt
});

const serializeHistory = (items: Awaited<ReturnType<typeof repo.listRecentPacksForSession>>) =>
  studyPackHistorySchema.parse({
    items: items.map((item) => ({
      id: item.id,
      input: item.input,
      source_revision_id: item.sourceRevisionId,
      created_at: item.createdAt,
      latest_job: item.latestJob
        ? {
            id: item.latestJob.id,
            status: item.latestJob.status,
            stage: item.latestJob.stage,
            progress: item.latestJob.progress,
            updated_at: item.latestJob.updatedAt,
            degradation_state: item.latestJob.degradationState,
            degradation_reason: item.latestJob.degradationReason
          }
        : null,
      readiness: {
        status: item.readiness.status,
        missing_artifacts: item.readiness.missingArtifacts,
        can_resume: item.readiness.canResume,
        degradation_reason: item.readiness.degradationReason
      }
    }))
  });

const serializeUserProfile = (profile: Awaited<ReturnType<typeof repo.upsertUserProfile>>) =>
  userProfileSchema.parse({
    user_id: profile.userId,
    display_name: profile.displayName,
    created_at: profile.createdAt,
    updated_at: profile.updatedAt
  });

const serializeShareLink = (share: NonNullable<Awaited<ReturnType<typeof repo.getShareLink>>>) => ({
  share_id: share.shareId,
  pack_id: share.packId,
  owner_user_id: share.ownerUserId,
  role: share.role,
  created_at: share.createdAt,
  expires_at: share.expiresAt
});

const serializeLearningProgress = (progress: NonNullable<Awaited<ReturnType<typeof repo.getLearningProgress>>>) =>
  learningProgressSchema.parse({
    user_id: progress.userId,
    pack_id: progress.packId,
    total_cards: progress.totalCards,
    reviewed_cards: progress.reviewedCards,
    due_cards: progress.dueCards,
    mastery_score: progress.masteryScore,
    next_due_at: progress.nextDueAt,
    cards: progress.cards.map((card) => ({
      card_index: card.cardIndex,
      reviewed: card.reviewed,
      due: card.due,
      last_rating: card.lastRating,
      reviewed_at: card.reviewedAt,
      next_due_at: card.nextDueAt
    }))
  });

const buildSourceAttribution = (
  input: string,
  sourceRevisionId: string
): { canonicalUrl: string; revisionUrl: string; license: 'CC BY-SA 4.0' } => {
  const title = deriveWikipediaTitle(input);
  const encodedTitle = encodeURIComponent(title.replace(/\s+/g, '_'));
  const canonicalUrl = `https://en.wikipedia.org/wiki/${encodedTitle}`;
  const revisionUrl = `${canonicalUrl}?oldid=${encodeURIComponent(sourceRevisionId)}`;
  return {
    canonicalUrl,
    revisionUrl,
    license: 'CC BY-SA 4.0'
  };
};

const buildArtifactSourceProvenance = (
  citation: string,
  sourceRevisionId: string,
  revisionUrl: string
): { source_revision_id: string; citation: string; revision_url: string; license: 'CC BY-SA 4.0' } => ({
  source_revision_id: sourceRevisionId,
  citation,
  revision_url: revisionUrl,
  license: 'CC BY-SA 4.0'
});

type MissingArtifact = 'summaries' | 'graph' | 'glossary' | 'flashcards' | 'quiz';

const getMissingArtifacts = (pack: {
  summaries: unknown[];
  graphNodes: unknown[];
  graphEdges: unknown[];
  timelineEvents: unknown[];
  glossary: unknown[];
  flashcards: unknown[];
  quizQuestions: unknown[];
}): MissingArtifact[] => {
  const missing: MissingArtifact[] = [];
  if (pack.summaries.length === 0) missing.push('summaries');
  if (pack.graphNodes.length === 0 && pack.graphEdges.length === 0 && pack.timelineEvents.length === 0) missing.push('graph');
  if (pack.glossary.length === 0) missing.push('glossary');
  if (pack.flashcards.length === 0) missing.push('flashcards');
  if (pack.quizQuestions.length === 0) missing.push('quiz');
  return missing;
};

const shouldDegrade = (startedAt: number, estimatedTokens: number): boolean =>
  estimatedTokens > config.tokenBudgetPerJob || Date.now() - startedAt > config.latencyBudgetMs;

const buildStudyPackPayload = async (pack: PackRecord) => {
  const groundingStats = computeGroundingStats(pack.summaries);
  const sourceAttribution = buildSourceAttribution(pack.input, pack.sourceRevisionId);
  const sourceCacheEvent = pack.cacheEvents.find((event) => event.stage === 'source');
  const latestJob = await repo.getLatestJobForPack(pack.id);
  const missingArtifacts = getMissingArtifacts(pack);
  const recommendations = buildLearnNextRecommendations({
    inputTitle: pack.input,
    sections: pack.sections,
    outgoingLinks: pack.outgoingLinks,
    graphNodes: pack.graphNodes
  });

  return studyPackSchema.parse({
    id: pack.id,
    input: pack.input,
    source_revision_id: pack.sourceRevisionId,
    source_attribution: {
      canonical_url: sourceAttribution.canonicalUrl,
      revision_url: sourceAttribution.revisionUrl,
      license: sourceAttribution.license
    },
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
      model: s.model,
      source_provenance: s.citations.map((citation) =>
        buildArtifactSourceProvenance(citation, pack.sourceRevisionId, sourceAttribution.revisionUrl)
      )
    })),
    glossary: pack.glossary.map((term) => ({
      term: term.term,
      definition: term.definition,
      citation: term.citation,
      prompt_version: term.promptVersion,
      model: term.model,
      source_provenance: buildArtifactSourceProvenance(term.citation, pack.sourceRevisionId, sourceAttribution.revisionUrl)
    })),
    flashcards: pack.flashcards.map((f) => ({
      question: f.question,
      answer: f.answer,
      citation: f.citation,
      prompt_version: f.promptVersion,
      model: f.model,
      source_provenance: buildArtifactSourceProvenance(f.citation, pack.sourceRevisionId, sourceAttribution.revisionUrl)
    })),
    quiz_questions: pack.quizQuestions.map((q) => ({
      question: q.question,
      options: q.options,
      correct_index: q.correctIndex,
      misconceptions: q.misconceptions ?? [],
      explanation: q.explanation,
      citation: q.citation,
      prompt_version: q.promptVersion,
      model: q.model,
      source_provenance: buildArtifactSourceProvenance(q.citation, pack.sourceRevisionId, sourceAttribution.revisionUrl)
    })),
    graph: {
      nodes: pack.graphNodes.map((node) => ({
        id: node.id,
        label: node.label,
        type: node.type,
        citation: node.citation,
        source_provenance: buildArtifactSourceProvenance(node.citation, pack.sourceRevisionId, sourceAttribution.revisionUrl)
      })),
      edges: pack.graphEdges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        relation: edge.relation,
        citation: edge.citation,
        source_provenance: buildArtifactSourceProvenance(edge.citation, pack.sourceRevisionId, sourceAttribution.revisionUrl)
      }))
    },
    timeline: pack.timelineEvents.map((event) => ({
      year: event.year,
      date_label: event.dateLabel,
      description: event.description,
      citation: event.citation,
      source_provenance: buildArtifactSourceProvenance(event.citation, pack.sourceRevisionId, sourceAttribution.revisionUrl)
    })),
    recommendations: recommendations.map((recommendation) => ({
      title: recommendation.title,
      url: recommendation.url,
      rationale: recommendation.rationale,
      score: recommendation.score,
      source_heading: recommendation.sourceHeading
    })),
    cache: {
      source: sourceCacheEvent ? serializeCacheEvent(sourceCacheEvent) : null,
      artifacts: pack.cacheEvents
        .filter((event) => event.stage !== 'source')
        .map((event) => serializeCacheEvent(event))
    },
    readiness: {
      status: missingArtifacts.length === 0 ? 'full' : 'partial',
      missing_artifacts: missingArtifacts,
      can_resume: missingArtifacts.length > 0,
      degradation_reason: latestJob?.degradationReason
    }
  });
};

const markPartial = async (job: Job, reason: string): Promise<void> => {
  job.degradationState = 'partial';
  job.degradationReason = reason;
  job.status = 'completed';
  job.stage = 'done';
  job.progress = 100;
  job.heartbeatAt = Date.now();
  await repo.upsertJob(job);
};

const makeJob = (jobId: string, packId: string, sessionId: string): Job => ({
  id: jobId,
  packId,
  sessionId,
  stage: 'ingestion',
  status: 'queued',
  progress: 0,
  attempt: 0,
  retryState: 'none',
  degradationState: 'none',
  degradationReason: undefined,
  errors: [],
  heartbeatAt: Date.now()
});

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
      let cumulativeTokens = 0;

      job.progress = 10;
      job.heartbeatAt = Date.now();
      await repo.upsertJob(job);

      const ingestionStartedAt = Date.now();
      const parsedInput = parseTopicInput(pack.input, config.wikipediaLang);
      const sourceCacheKey = buildSourceCacheKey(config.wikipediaLang, parsedInput.title);
      const cachedSource = await repo.getCachedSource(sourceCacheKey, cachePolicy.sourceParserVersion);
      const page = cachedSource
        ? {
            revisionId: cachedSource.sourceRevisionId,
            title: cachedSource.sourceTitle,
            sections: cachedSource.sections,
            outgoingLinks: cachedSource.outgoingLinks
          }
        : await fetchWikipediaSections(parsedInput.title, config.wikipediaLang);
      if (!cachedSource) {
        const cachedAt = new Date().toISOString();
        await repo.saveCachedSource({
          cacheKey: sourceCacheKey,
          sourceTitle: page.title,
          sourceRevisionId: page.revisionId,
          parserVersion: cachePolicy.sourceParserVersion,
          language: config.wikipediaLang,
          sections: page.sections,
          outgoingLinks: page.outgoingLinks,
          cachedAt,
          expiresAt: expiresAtFromNow(Date.parse(cachedAt), config.cacheTtlSeconds)
        });
      }
      await repo.recordCacheEvent(job.packId, {
        stage: 'source',
        cacheKey: sourceCacheKey,
        hit: Boolean(cachedSource),
        sourceRevisionId: page.revisionId,
        parserVersion: cachePolicy.sourceParserVersion,
        cachedAt: cachedSource?.cachedAt,
        expiresAt: cachedSource?.expiresAt
      });
      await repo.saveIngestedPack(job.packId, pack.input, page);
      const ingestionLatencyMs = Date.now() - ingestionStartedAt;
      const ingestionTokens = cachedSource
        ? 0
        : estimateTokensFromText(pack.input, ...page.sections.map((section) => `${section.heading}\n${section.content}`));
      await repo.recordStageCost({
        jobId: job.id,
        packId: job.packId,
        stage: 'ingestion',
        estimatedTokens: ingestionTokens,
        latencyMs: ingestionLatencyMs,
        estimatedCostUsd: estimateStageCostUsd('ingestion', ingestionTokens),
        promptVersion: cachePolicy.sourceParserVersion,
        model: cachedSource ? 'source-cache' : 'deterministic-parser'
      });
      cumulativeTokens += ingestionTokens;

      job.stage = 'summarization';
      job.progress = 60;
      job.heartbeatAt = Date.now();
      await repo.upsertJob(job);

      const summaryStartedAt = Date.now();
      const summaryCacheKey = buildArtifactCacheKey(
        'summaries',
        page.revisionId,
        cachePolicy.summaryPromptVersion,
        cachePolicy.taxonomyVersion
      );
      const cachedSummariesRecord = await repo.getCachedArtifact(
        'summaries',
        page.revisionId,
        cachePolicy.summaryPromptVersion,
        cachePolicy.taxonomyVersion
      );
      const summariesPayload = cachedSummariesRecord?.payload as { summaries?: ReturnType<typeof generateGroundedSummaries> } | undefined;
      const cachedSummaries = Array.isArray(summariesPayload?.summaries) ? cachedSummariesRecord : undefined;
      const existingSummaries = pack.summaries.length > 0 ? pack.summaries : undefined;
      const summaries = existingSummaries ?? (cachedSummaries && summariesPayload?.summaries
        ? summariesPayload.summaries
        : await artifactGenerator.generateSummaries(page.sections, cachePolicy.summaryPromptVersion));
      if (!existingSummaries && !cachedSummaries) {
        const cachedAt = new Date().toISOString();
        await repo.saveCachedArtifact({
          cacheKey: summaryCacheKey,
          kind: 'summaries',
          sourceRevisionId: page.revisionId,
          promptVersion: cachePolicy.summaryPromptVersion,
          taxonomyVersion: cachePolicy.taxonomyVersion,
          payload: { summaries },
          cachedAt,
          expiresAt: expiresAtFromNow(Date.parse(cachedAt), config.cacheTtlSeconds)
        });
      }
      if (!existingSummaries) {
        await repo.recordCacheEvent(job.packId, {
          stage: 'summaries',
          cacheKey: summaryCacheKey,
          hit: Boolean(cachedSummaries),
          sourceRevisionId: page.revisionId,
          promptVersion: cachePolicy.summaryPromptVersion,
          taxonomyVersion: cachePolicy.taxonomyVersion,
          cachedAt: cachedSummaries?.cachedAt,
          expiresAt: cachedSummaries?.expiresAt
        });
        await repo.saveSummaries(job.packId, summaries);
      }
      const groundingStats = computeGroundingStats(summaries);
      const summarizationLatencyMs = Date.now() - summaryStartedAt;
      const summarizationTokens = existingSummaries || cachedSummaries
        ? 0
        : estimateTokensFromText(...summaries.map((summary) => `${summary.text}\n${summary.citations.join('\n')}`));
      await repo.recordStageCost({
        jobId: job.id,
        packId: job.packId,
        stage: 'summarization',
        estimatedTokens: summarizationTokens,
        latencyMs: summarizationLatencyMs,
        estimatedCostUsd: estimateStageCostUsd('summarization', summarizationTokens),
        promptVersion: cachePolicy.summaryPromptVersion,
        model: existingSummaries ? 'existing-pack' : cachedSummaries ? 'artifact-cache' : summaries[0]?.model ?? 'local-rule-based'
      });
      cumulativeTokens += summarizationTokens;
      if (!existingSummaries && shouldDegrade(startedAt, cumulativeTokens)) {
        const reason = 'budget_or_time_exceeded_after_summaries';
        await markPartial(job, reason);
        await repo.recordJobCompletion({
          jobId: job.id,
          packId: job.packId,
          durationMs: Date.now() - startedAt,
          citationRate: groundingStats.citationRate,
          flashcards: pack.flashcards.length,
          quizQuestions: pack.quizQuestions.length
        });
        return;
      }

      job.stage = 'knowledge_structure';
      job.progress = 78;
      job.heartbeatAt = Date.now();
      await repo.upsertJob(job);

      const knowledgeStartedAt = Date.now();
      const knowledgeCacheKey = buildArtifactCacheKey(
        'knowledge_structure',
        page.revisionId,
        cachePolicy.knowledgePromptVersion,
        cachePolicy.taxonomyVersion
      );
      const cachedKnowledgeRecord = await repo.getCachedArtifact(
        'knowledge_structure',
        page.revisionId,
        cachePolicy.knowledgePromptVersion,
        cachePolicy.taxonomyVersion
      );
      const knowledgePayload = cachedKnowledgeRecord?.payload as ReturnType<typeof generateKnowledgeStructureArtifacts> | undefined;
      const cachedKnowledge =
        Array.isArray(knowledgePayload?.nodes) && Array.isArray(knowledgePayload?.edges) && Array.isArray(knowledgePayload?.timeline)
          ? cachedKnowledgeRecord
          : undefined;
      const existingKnowledge =
        pack.graphNodes.length > 0 || pack.graphEdges.length > 0 || pack.timelineEvents.length > 0
          ? {
              nodes: pack.graphNodes,
              edges: pack.graphEdges,
              timeline: pack.timelineEvents
            }
          : undefined;
      const knowledge = existingKnowledge ?? (cachedKnowledge && knowledgePayload
        ? knowledgePayload
        : await artifactGenerator.generateKnowledge(page.sections, cachePolicy.knowledgePromptVersion));
      if (!existingKnowledge && !cachedKnowledge) {
        const cachedAt = new Date().toISOString();
        await repo.saveCachedArtifact({
          cacheKey: knowledgeCacheKey,
          kind: 'knowledge_structure',
          sourceRevisionId: page.revisionId,
          promptVersion: cachePolicy.knowledgePromptVersion,
          taxonomyVersion: cachePolicy.taxonomyVersion,
          payload: knowledge,
          cachedAt,
          expiresAt: expiresAtFromNow(Date.parse(cachedAt), config.cacheTtlSeconds)
        });
      }
      if (!existingKnowledge) {
        await repo.recordCacheEvent(job.packId, {
          stage: 'knowledge_structure',
          cacheKey: knowledgeCacheKey,
          hit: Boolean(cachedKnowledge),
          sourceRevisionId: page.revisionId,
          promptVersion: cachePolicy.knowledgePromptVersion,
          taxonomyVersion: cachePolicy.taxonomyVersion,
          cachedAt: cachedKnowledge?.cachedAt,
          expiresAt: cachedKnowledge?.expiresAt
        });
        await repo.saveKnowledgeStructure(job.packId, knowledge.nodes, knowledge.edges, knowledge.timeline);
      }
      const knowledgeLatencyMs = Date.now() - knowledgeStartedAt;
      const knowledgeTokens = existingKnowledge || cachedKnowledge
        ? 0
        : estimateTokensFromText(
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
        promptVersion: cachePolicy.knowledgePromptVersion,
        model: existingKnowledge ? 'existing-pack' : cachedKnowledge ? 'artifact-cache' : 'local-rule-based'
      });
      cumulativeTokens += knowledgeTokens;
      if (!existingKnowledge && shouldDegrade(startedAt, cumulativeTokens)) {
        const reason = 'budget_or_time_exceeded_after_graph';
        await markPartial(job, reason);
        await repo.recordJobCompletion({
          jobId: job.id,
          packId: job.packId,
          durationMs: Date.now() - startedAt,
          citationRate: groundingStats.citationRate,
          flashcards: pack.flashcards.length,
          quizQuestions: pack.quizQuestions.length
        });
        return;
      }

      job.stage = 'glossary';
      job.progress = 84;
      job.heartbeatAt = Date.now();
      await repo.upsertJob(job);

      const glossaryStartedAt = Date.now();
      const glossaryCacheKey = buildArtifactCacheKey(
        'glossary',
        page.revisionId,
        cachePolicy.glossaryPromptVersion,
        cachePolicy.taxonomyVersion
      );
      const cachedGlossaryRecord = await repo.getCachedArtifact(
        'glossary',
        page.revisionId,
        cachePolicy.glossaryPromptVersion,
        cachePolicy.taxonomyVersion
      );
      const glossaryPayload = cachedGlossaryRecord?.payload as ReturnType<typeof generateGlossaryArtifacts> | undefined;
      const cachedGlossary = Array.isArray(glossaryPayload?.glossary) ? cachedGlossaryRecord : undefined;
      const existingGlossary = pack.glossary.length > 0 ? { glossary: pack.glossary } : undefined;
      const glossary = existingGlossary ?? (cachedGlossary && glossaryPayload
        ? glossaryPayload
        : await artifactGenerator.generateGlossary(page.sections, cachePolicy.glossaryPromptVersion));
      if (!existingGlossary && !cachedGlossary) {
        const cachedAt = new Date().toISOString();
        await repo.saveCachedArtifact({
          cacheKey: glossaryCacheKey,
          kind: 'glossary',
          sourceRevisionId: page.revisionId,
          promptVersion: cachePolicy.glossaryPromptVersion,
          taxonomyVersion: cachePolicy.taxonomyVersion,
          payload: glossary,
          cachedAt,
          expiresAt: expiresAtFromNow(Date.parse(cachedAt), config.cacheTtlSeconds)
        });
      }
      if (!existingGlossary) {
        await repo.recordCacheEvent(job.packId, {
          stage: 'glossary',
          cacheKey: glossaryCacheKey,
          hit: Boolean(cachedGlossary),
          sourceRevisionId: page.revisionId,
          promptVersion: cachePolicy.glossaryPromptVersion,
          taxonomyVersion: cachePolicy.taxonomyVersion,
          cachedAt: cachedGlossary?.cachedAt,
          expiresAt: cachedGlossary?.expiresAt
        });
        await repo.saveGlossary(job.packId, glossary.glossary);
      }
      const glossaryLatencyMs = Date.now() - glossaryStartedAt;
      const glossaryTokens = existingGlossary || cachedGlossary
        ? 0
        : estimateTokensFromText(...glossary.glossary.map((term) => `${term.term}\n${term.definition}`));
      await repo.recordStageCost({
        jobId: job.id,
        packId: job.packId,
        stage: 'glossary',
        estimatedTokens: glossaryTokens,
        latencyMs: glossaryLatencyMs,
        estimatedCostUsd: estimateStageCostUsd('glossary', glossaryTokens),
        promptVersion: cachePolicy.glossaryPromptVersion,
        model: existingGlossary ? 'existing-pack' : cachedGlossary ? 'artifact-cache' : glossary.glossary[0]?.model ?? 'local-rule-based'
      });
      cumulativeTokens += glossaryTokens;
      if (!existingGlossary && shouldDegrade(startedAt, cumulativeTokens)) {
        const reason = 'budget_or_time_exceeded_after_glossary';
        await markPartial(job, reason);
        await repo.recordJobCompletion({
          jobId: job.id,
          packId: job.packId,
          durationMs: Date.now() - startedAt,
          citationRate: groundingStats.citationRate,
          flashcards: pack.flashcards.length,
          quizQuestions: pack.quizQuestions.length
        });
        return;
      }

      job.stage = 'active_recall';
      job.progress = 90;
      job.heartbeatAt = Date.now();
      await repo.upsertJob(job);

      const activeRecallStartedAt = Date.now();
      const activeRecallCacheKey = buildArtifactCacheKey(
        'active_recall',
        page.revisionId,
        cachePolicy.activeRecallPromptVersion,
        cachePolicy.taxonomyVersion
      );
      const cachedActiveRecallRecord = await repo.getCachedArtifact(
        'active_recall',
        page.revisionId,
        cachePolicy.activeRecallPromptVersion,
        cachePolicy.taxonomyVersion
      );
      const activeRecallPayload = cachedActiveRecallRecord?.payload as ReturnType<typeof generateActiveRecallArtifacts> | undefined;
      const cachedActiveRecall =
        Array.isArray(activeRecallPayload?.flashcards) && Array.isArray(activeRecallPayload?.quizQuestions)
          ? cachedActiveRecallRecord
          : undefined;
      const existingFlashcards = pack.flashcards.length > 0 ? pack.flashcards : undefined;
      const existingQuizQuestions = pack.quizQuestions.length > 0 ? pack.quizQuestions : undefined;
      const existingQuizQuestionCount = pack.quizQuestions.length;
      const activeRecall = existingFlashcards && existingQuizQuestions
        ? { flashcards: existingFlashcards, quizQuestions: existingQuizQuestions }
        : cachedActiveRecall && activeRecallPayload
          ? activeRecallPayload
          : await artifactGenerator.generateActiveRecall(page.sections, cachePolicy.activeRecallPromptVersion);
      if (!existingFlashcards && !existingQuizQuestions && !cachedActiveRecall) {
        const cachedAt = new Date().toISOString();
        await repo.saveCachedArtifact({
          cacheKey: activeRecallCacheKey,
          kind: 'active_recall',
          sourceRevisionId: page.revisionId,
          promptVersion: cachePolicy.activeRecallPromptVersion,
          taxonomyVersion: cachePolicy.taxonomyVersion,
          payload: activeRecall,
          cachedAt,
          expiresAt: expiresAtFromNow(Date.parse(cachedAt), config.cacheTtlSeconds)
        });
      }
      if (!existingFlashcards || !existingQuizQuestions) {
        await repo.recordCacheEvent(job.packId, {
          stage: 'active_recall',
          cacheKey: activeRecallCacheKey,
          hit: Boolean(cachedActiveRecall),
          sourceRevisionId: page.revisionId,
          promptVersion: cachePolicy.activeRecallPromptVersion,
          taxonomyVersion: cachePolicy.taxonomyVersion,
          cachedAt: cachedActiveRecall?.cachedAt,
          expiresAt: cachedActiveRecall?.expiresAt
        });
      }
      const activeRecallLatencyMs = Date.now() - activeRecallStartedAt;
      const flashcardTokens = existingFlashcards || cachedActiveRecall
        ? 0
        : estimateTokensFromText(...activeRecall.flashcards.map((card) => `${card.question}\n${card.answer}`));
      const quizTokens = existingQuizQuestions || cachedActiveRecall
        ? 0
        : estimateTokensFromText(
            ...activeRecall.quizQuestions.map(
              (question) => `${question.question}\n${question.options.join('\n')}\n${question.explanation}`
            )
          );
      const nextFlashcards = existingFlashcards ?? activeRecall.flashcards;
      const nextQuizQuestions = existingQuizQuestions ?? activeRecall.quizQuestions;
      cumulativeTokens += flashcardTokens;
      if (!existingFlashcards && shouldDegrade(startedAt, cumulativeTokens)) {
        await repo.saveActiveRecall(job.packId, nextFlashcards, existingQuizQuestions ?? []);
        const reason = 'budget_or_time_exceeded_after_flashcards';
        await repo.recordStageCost({
          jobId: job.id,
          packId: job.packId,
          stage: 'active_recall',
          estimatedTokens: flashcardTokens,
          latencyMs: activeRecallLatencyMs,
          estimatedCostUsd: estimateStageCostUsd('active_recall', flashcardTokens),
          promptVersion: cachePolicy.activeRecallPromptVersion,
          model: cachedActiveRecall ? 'artifact-cache' : 'local-rule-based'
        });
        await markPartial(job, reason);
        await repo.recordJobCompletion({
          jobId: job.id,
          packId: job.packId,
          durationMs: Date.now() - startedAt,
          citationRate: groundingStats.citationRate,
          flashcards: nextFlashcards.length,
          quizQuestions: 0
        });
        return;
      }
      cumulativeTokens += quizTokens;
      if (!existingQuizQuestions && shouldDegrade(startedAt, cumulativeTokens)) {
        await repo.saveActiveRecall(job.packId, nextFlashcards, existingQuizQuestions ?? []);
        const reason = 'budget_or_time_exceeded_before_quiz';
        await repo.recordStageCost({
          jobId: job.id,
          packId: job.packId,
          stage: 'active_recall',
          estimatedTokens: flashcardTokens,
          latencyMs: activeRecallLatencyMs,
          estimatedCostUsd: estimateStageCostUsd('active_recall', flashcardTokens),
          promptVersion: cachePolicy.activeRecallPromptVersion,
          model: cachedActiveRecall ? 'artifact-cache' : 'local-rule-based'
        });
        await markPartial(job, reason);
        await repo.recordJobCompletion({
          jobId: job.id,
          packId: job.packId,
          durationMs: Date.now() - startedAt,
          citationRate: groundingStats.citationRate,
          flashcards: nextFlashcards.length,
          quizQuestions: existingQuizQuestionCount
        });
        return;
      }
      if (!existingFlashcards || !existingQuizQuestions) {
        await repo.saveActiveRecall(job.packId, nextFlashcards, nextQuizQuestions);
      }
      await repo.recordStageCost({
        jobId: job.id,
        packId: job.packId,
        stage: 'active_recall',
        estimatedTokens: flashcardTokens + quizTokens,
        latencyMs: activeRecallLatencyMs,
        estimatedCostUsd: estimateStageCostUsd('active_recall', flashcardTokens + quizTokens),
        promptVersion: cachePolicy.activeRecallPromptVersion,
        model: existingFlashcards && existingQuizQuestions
          ? 'existing-pack'
          : cachedActiveRecall
            ? 'artifact-cache'
            : activeRecall.flashcards[0]?.model ?? activeRecall.quizQuestions[0]?.model ?? 'local-rule-based'
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
        flashcards: nextFlashcards.length,
        quizQuestions: nextQuizQuestions.length
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

  app.get('/api/study-packs', async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    const items = await repo.listRecentPacksForSession(sessionId, parseLimit(req.query.limit));
    res.status(200).json(serializeHistory(items));
  });

  app.get('/api/library', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(400).json({ error: 'missing_user_id' });
      return;
    }
    const items = await repo.listSavedPacksForUser(userId, parseLimit(req.query.limit));
    res.status(200).json(serializeHistory(items));
  });

  app.get('/api/me', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(400).json({ error: 'missing_user_id' });
      return;
    }
    const profile = await repo.upsertUserProfile(userId, getUserDisplayName(req));
    res.status(200).json(serializeUserProfile(profile));
  });

  app.post('/api/me', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(400).json({ error: 'missing_user_id' });
      return;
    }
    const parsed = upsertUserProfileRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const profile = await repo.upsertUserProfile(userId, parsed.data.display_name);
    res.status(200).json(serializeUserProfile(profile));
  });

  app.post('/api/study-packs', async (req: Request, res: Response) => {
    const parsed = createStudyPackRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const correlationId = getCorrelationId(req);
    const sanitizedInput = sanitizeSourceText(parsed.data.title_or_url);
    if (sanitizedInput.flagged) {
      securityEventMetrics.recordSuspiciousInput(sanitizedInput.signatures);
      logSecurityEvent('warn', {
        eventType: 'security.suspicious_input_detected',
        correlationId,
        signatures: sanitizedInput.signatures,
        inputPreview: sanitizedInput.sanitized.slice(0, 120)
      });

      for (const update of securityTracker.record(sanitizedInput.signatures)) {
        if (update.alert) {
          securityEventMetrics.recordSignatureAlert(update.signature);
          logSecurityEvent('error', {
            eventType: 'security.signature_alert_threshold_exceeded',
            correlationId,
            signature: update.signature,
            occurrenceCount: update.count,
            threshold: config.securityAlertSignatureThreshold,
            windowSeconds: config.securityAlertWindowSeconds
          });
        }
      }
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
    const userId = getUserId(req);
    if (userId) {
      await repo.upsertUserProfile(userId, getUserDisplayName(req));
    }
    const idempotent = await repo.createOrReuseByIdempotency(parsed.data.idempotency_key, config.idempotencyTtlSeconds);
    if (idempotent.reused) {
      if (userId) {
        await repo.savePackForUser(userId, idempotent.packId);
      }
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
    if (userId) {
      await repo.savePackForUser(userId, idempotent.packId);
    }
    await repo.upsertJob(makeJob(idempotent.jobId, idempotent.packId, sessionId));

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

  app.get('/api/queue/status', async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    const queued = await repo.countQueuedJobs();
    const running = await repo.countRunningJobs();
    const sessionInflight = await repo.countInflightJobsForSession(sessionId);
    const capacityState =
      queued >= config.maxQueueDepth
        ? 'queue_full'
        : running >= config.globalConcurrencyLimit
          ? 'global_limit'
          : sessionInflight >= config.sessionConcurrencyLimit
            ? 'session_limit'
            : 'open';

    const payload = queueStatusSchema.parse({
      queued,
      running,
      max_queue_depth: config.maxQueueDepth,
      global_concurrency_limit: config.globalConcurrencyLimit,
      session_inflight: sessionInflight,
      session_concurrency_limit: config.sessionConcurrencyLimit,
      capacity_state: capacityState
    });
    res.status(200).json(payload);
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
      degradation_reason: job.degradationReason,
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

  app.post('/api/study-packs/:id/save', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(400).json({ error: 'missing_user_id' });
      return;
    }

    const pack = await repo.getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    await repo.upsertUserProfile(userId, getUserDisplayName(req));
    await repo.savePackForUser(userId, pack.id);
    res.status(200).json({ pack_id: pack.id, saved: true, saved_at: new Date().toISOString() });
  });

  app.post('/api/study-packs/:id/share', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(400).json({ error: 'missing_user_id' });
      return;
    }
    const parsed = createShareLinkRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const pack = await repo.getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    await repo.upsertUserProfile(userId, getUserDisplayName(req));
    const share = await repo.createShareLink(userId, pack.id, parsed.data.role);
    if (!share) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    const payload = createShareLinkResponseSchema.parse({
      share: serializeShareLink(share),
      share_path: `/api/shared/${share.shareId}`
    });
    res.status(201).json(payload);
  });

  app.get('/api/study-packs/:id/progress', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(400).json({ error: 'missing_user_id' });
      return;
    }
    const pack = await repo.getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    await repo.upsertUserProfile(userId, getUserDisplayName(req));
    const progress = await repo.getLearningProgress(userId, pack.id);
    if (!progress) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }
    res.status(200).json(serializeLearningProgress(progress));
  });

  app.post('/api/study-packs/:id/flashcards/:cardIndex/reviews', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(400).json({ error: 'missing_user_id' });
      return;
    }
    const parsed = flashcardReviewRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const cardIndex = Number.parseInt(req.params.cardIndex, 10);
    if (!Number.isInteger(cardIndex) || cardIndex < 0) {
      res.status(400).json({ error: 'invalid_card_index' });
      return;
    }
    const pack = await repo.getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }
    if (cardIndex >= pack.flashcards.length) {
      res.status(404).json({ error: 'flashcard_not_found' });
      return;
    }

    await repo.upsertUserProfile(userId, getUserDisplayName(req));
    const review = await repo.recordFlashcardReview(userId, pack.id, cardIndex, parsed.data.rating);
    const progress = await repo.getLearningProgress(userId, pack.id);
    if (!review || !progress) {
      res.status(409).json({ error: 'flashcards_not_ready' });
      return;
    }

    const payload = flashcardReviewResponseSchema.parse({
      review: {
        review_id: review.id,
        user_id: review.userId,
        pack_id: review.packId,
        card_index: review.cardIndex,
        rating: review.rating,
        reviewed_at: review.reviewedAt,
        next_due_at: review.nextDueAt
      },
      progress: serializeLearningProgress(progress)
    });
    res.status(200).json(payload);
  });

  app.post('/api/study-packs/:id/resume', async (req: Request, res: Response) => {
    const pack = await repo.getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    const missingArtifacts = getMissingArtifacts(pack);
    if (missingArtifacts.length === 0) {
      res.status(409).json({ error: 'pack_already_complete' });
      return;
    }

    const existingInflight = await repo.countInflightJobsForPack(pack.id);
    if (existingInflight > 0) {
      const latest = await repo.getLatestJobForPack(pack.id);
      res.status(409).json({ error: 'pack_already_in_progress', job_id: latest?.id });
      return;
    }

    const sessionId = getSessionId(req);
    const userId = getUserId(req);
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

    const jobId = randomUUID();
    await repo.upsertJob(makeJob(jobId, pack.id, sessionId));
    if (userId) {
      await repo.upsertUserProfile(userId, getUserDisplayName(req));
      await repo.savePackForUser(userId, pack.id);
    }
    void processOneQueuedJob();

    const payload = createStudyPackResponseSchema.parse({
      pack_id: pack.id,
      job_id: jobId,
      accepted_at: new Date().toISOString()
    });
    res.status(202).json(payload);
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

  app.get('/api/analytics/costs', async (req: Request, res: Response) => {
    const windowHours = parseWindowHours(req.query.window_hours);
    const snapshot = await repo.getCostTrendSnapshot(windowHours);
    const payload = costAnalyticsSchema.parse({
      generated_at: new Date().toISOString(),
      window_hours: snapshot.windowHours,
      total_estimated_usd: snapshot.totalEstimatedUsd,
      avg_estimated_usd_per_pack: snapshot.avgEstimatedUsdPerPack,
      by_stage: snapshot.byStage.map((entry) => ({
        stage: entry.stage,
        events: entry.events,
        avg_tokens: entry.avgTokens,
        avg_latency_ms: entry.avgLatencyMs,
        total_estimated_usd: entry.totalEstimatedUsd,
        avg_estimated_usd: entry.avgEstimatedUsd
      })),
      by_pack: snapshot.byPack.map((entry) => ({
        pack_id: entry.packId,
        events: entry.events,
        estimated_tokens: entry.estimatedTokens,
        total_estimated_usd: entry.totalEstimatedUsd,
        avg_estimated_usd: entry.avgEstimatedUsd
      })),
      by_prompt_model: snapshot.byPromptModel.map((entry) => ({
        prompt_version: entry.promptVersion,
        model: entry.model,
        events: entry.events,
        avg_latency_ms: entry.avgLatencyMs,
        estimated_tokens: entry.estimatedTokens,
        total_estimated_usd: entry.totalEstimatedUsd
      })),
      llm_ops: (() => {
        const llm = llmTelemetry.getSnapshot();
        return {
          calls: {
            attempted: llm.calls.attempted,
            succeeded: llm.calls.succeeded,
            fallback: llm.calls.fallback,
            invalid_responses: llm.calls.invalidResponses,
            timeouts: llm.calls.timeouts,
            timeout_rate: llm.calls.timeoutRate
          },
          by_stage_model: llm.byStageModel.map((entry) => ({
            provider: entry.provider,
            model: entry.model,
            stage: entry.stage,
            attempted: entry.attempted,
            succeeded: entry.succeeded,
            fallback: entry.fallback,
            avg_latency_ms: entry.avgLatencyMs,
            p95_latency_ms: entry.p95LatencyMs
          })),
          fallbacks_by_reason: llm.fallbacksByReason.map((entry) => ({
            provider: entry.provider,
            model: entry.model,
            stage: entry.stage,
            reason: entry.reason,
            events: entry.events
          }))
        };
      })()
    });

    res.status(200).json(payload);
  });

  app.get('/api/analytics/slo', async (_req: Request, res: Response) => {
    const snapshot = await repo.getOutcomesSnapshot();
    const payload = sloAnalyticsSchema.parse({
      generated_at: new Date().toISOString(),
      targets: sloTargets,
      current: {
        p95_time_to_first_artifact_ms: snapshot.slo.p95TimeToFirstArtifactMs,
        p95_full_pack_completion_ms: snapshot.slo.p95FullPackCompletionMs,
        job_success_rate: snapshot.slo.jobSuccessRate,
        citation_coverage_rate: snapshot.slo.citationCoverageRate
      }
    });

    res.status(200).json(payload);
  });

  app.get('/api/metrics/outcomes', async (_req: Request, res: Response) => {
    const snapshot = await repo.getOutcomesSnapshot();
    const maintenance = await repo.getOutcomesMaintenanceSnapshot();
    const operational = await repo.getOperationalMetricsSnapshot();
    const queued = await repo.countQueuedJobs();
    const running = await repo.countRunningJobs();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.status(200).send(
      formatOutcomesPrometheus(
        {
          generatedAt: new Date().toISOString(),
          jobs: snapshot.jobs,
          quality: snapshot.quality,
          learning: snapshot.learning,
          slo: snapshot.slo,
          cost: snapshot.cost
        },
        maintenance,
        {
          queue: {
            queued,
            running,
            maxQueueDepth: config.maxQueueDepth,
            globalConcurrencyLimit: config.globalConcurrencyLimit
          },
          degradation: operational.degradation,
          cache: operational.cache
        },
        securityEventMetrics.getSnapshot(),
        llmTelemetry.getSnapshot()
      )
    );
  });

  app.get('/api/shared/:shareId', async (req: Request, res: Response) => {
    const share = await repo.getShareLink(req.params.shareId);
    if (!share) {
      res.status(404).json({ error: 'share_not_found' });
      return;
    }
    const pack = await repo.getPack(share.packId);
    if (!pack) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    const payload = sharedStudyPackResponseSchema.parse({
      share: serializeShareLink(share),
      pack: await buildStudyPackPayload(pack)
    });
    res.status(200).json(payload);
  });

  app.get('/api/study-packs/:id/export', async (req: Request, res: Response) => {
    const pack = await repo.getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    const format = parseStudyPackExportFormat(req.query.format ?? 'markdown');
    if (!format) {
      res.status(400).json({ error: 'unsupported_export_format', supported_formats: ['json', 'markdown', 'anki_csv'] });
      return;
    }

    const payload = await buildStudyPackPayload(pack);
    const exported = formatStudyPackExport(payload, format);
    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.status(200).send(exported.body);
  });

  app.get('/api/study-packs/:id', async (req: Request, res: Response) => {
    const pack = await repo.getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }
    const payload = await buildStudyPackPayload(pack);

    res.status(200).json(payload);
  });
};
