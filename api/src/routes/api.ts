import type { Express, NextFunction, Request, Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  artifactSchemaVersion,
  costAnalyticsSchema,
  costDrilldownAnalyticsSchema,
  createBatchStudyPackRequestSchema,
  createBatchStudyPackResponseSchema,
  createShareLinkRequestSchema,
  createShareLinkResponseSchema,
  createStudyPackRequestSchema,
  createStudyPackResponseSchema,
  flashcardReviewRequestSchema,
  flashcardReviewResponseSchema,
  generationFeedbackRequestSchema,
  generationFeedbackSchema,
  learningAnalyticsSchema,
  learningProgressSchema,
  learningReminderSchema,
  learningSessionSchema,
  learningSessionStartRequestSchema,
  listShareLinksResponseSchema,
  localLlmRuntimeHealthSchema,
  quizAttemptListResponseSchema,
  outcomesAnalyticsSchema,
  jobStatusSchema,
  promptEvaluationSchema,
  queueStatusSchema,
  realModelSmokeStatusSchema,
  realModelSmokeTriggerRequestSchema,
  quizAttemptRequestSchema,
  quizAttemptResponseSchema,
  revokeShareLinkResponseSchema,
  runtimePresetVisibilitySchema,
  savedPackVersionHistorySchema,
  sharedStudyPackResponseSchema,
  sloAnalyticsSchema,
  studyGoalSchema,
  studyPackHistorySchema,
  studyPackSchema,
  updateSavedPackOrganizationRequestSchema,
  updateSavedPackOrganizationResponseSchema,
  upsertStudyGoalRequestSchema,
  upsertUserProfileRequestSchema,
  userDataDeleteResponseSchema,
  userDataExportSchema,
  userProfileSchema
} from '../contracts/studyPack.js';
import { getConfig } from '../config.js';
import { buildRuntimePresetVisibility } from '../domain/runtimePreset.js';
import { buildPromptEvaluationSnapshot, type PromptEvaluationSnapshot } from '../domain/promptEvaluation.js';
import {
  RealModelSmokeAlreadyRunningError,
  RealModelSmokeController,
  realModelSmokeConfirmation,
  type RealModelSmokeRunner,
  type RealModelSmokeStatus as DomainRealModelSmokeStatus
} from '../domain/realModelSmoke.js';
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
import { buildLearningSession, type LearningSessionPayload } from '../domain/learningSession.js';
import { buildLocalLlmRuntimeHealth } from '../domain/localLlmDoctor.js';
import {
  buildArtifactCacheKey,
  buildSourceCacheKey,
  cachePolicy,
  expiresAtFromNow
} from '../domain/cachePolicy.js';
import { classifyError, nextRetryState } from '../domain/retryPolicy.js';
import { reapStuckJobs } from '../domain/reaper.js';
import { BudgetPolicy } from '../domain/budgetPolicy.js';
import { buildSloStatuses, sloTargets } from '../domain/slo.js';
import {
  isLikelyWikipediaInput,
  sanitizeSourceText,
  securityEventMetrics,
  FixedWindowRateLimiter,
  SecuritySignatureTracker
} from '../domain/security.js';
import { telemetry } from '../telemetry/otel.js';
import { formatOutcomesPrometheus } from '../telemetry/outcomes.js';
import { llmTelemetry } from '../telemetry/llm.js';
import type { Job } from '../domain/jobs.js';
import { logSecurityEvent, redactSensitivePath } from '../logger.js';
import type {
  CacheAdminSnapshot,
  CacheEventRecord,
  CacheInvalidationResult,
  LearningAnalyticsRecord,
  LearningSessionRecord,
  GenerationFeedbackRecord,
  GenerationFeedbackSummary,
  PackRecord,
  QuizAttemptRecord,
  SavedLibraryList,
  SavedLibraryProgressFilter,
  SavedLibraryReadinessFilter,
  SavedPackVersionHistory,
  SavedPackOrganization,
  SavedLibrarySort,
  ShareLinkRecord,
  StudyGoalRecord,
  UserDataDeleteResult,
  UserDataExportRecord,
  UpsertLearningSessionProgressInput
} from '../repo/types.js';
import {
  buildAuthorizationUrl,
  createOAuthStateToken,
  createSessionToken,
  createSignedToken,
  exchangeAuthorizationCode,
  fetchOidcUserInfo,
  userIdFromOidc,
  verifyOAuthStateToken,
  verifySessionToken,
  type AuthSession,
  type OAuthState,
  type OidcConfig
} from '../domain/auth.js';
import {
  activeShareTokenVersion,
  createShareTokenHash,
  expiresAtFromTtl,
  parseShareToken,
  publicShareToken
} from '../domain/shareLinks.js';

const config = getConfig();
const repo = getRepo();
const shareReadRateLimiter = new FixedWindowRateLimiter(
  config.shareReadRateLimitMax,
  config.shareReadRateLimitWindowSeconds
);
const shareReadFailureRateLimiter = new FixedWindowRateLimiter(
  config.shareReadFailedRateLimitMax,
  config.shareReadRateLimitWindowSeconds
);
let generationRateLimiter = new FixedWindowRateLimiter(
  config.generationRateLimitMax,
  config.generationRateLimitWindowSeconds
);
let authRateLimiter = new FixedWindowRateLimiter(config.authRateLimitMax, config.authRateLimitWindowSeconds);
let analyticsRateLimiter = new FixedWindowRateLimiter(
  config.analyticsRateLimitMax,
  config.analyticsRateLimitWindowSeconds
);
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
const realModelSmokeController = new RealModelSmokeController();

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

const parseQueryText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 120) : undefined;
};

const parseTagQueryText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return trimmed.length > 0 ? trimmed.slice(0, 32) : undefined;
};

const parseCollectionQueryText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed.slice(0, 60) : undefined;
};

const parseEnumQuery = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
  if (typeof value !== 'string') return fallback;
  return allowed.includes(value as T) ? (value as T) : fallback;
};

const libraryReadinessFilters = ['all', 'full', 'partial'] as const;
const libraryProgressFilters = ['all', 'due', 'reviewed', 'not_started'] as const;
const librarySorts = ['saved_desc', 'saved_asc', 'title_asc', 'title_desc', 'due_desc', 'mastery_desc'] as const;

const cacheAdminArtifactKinds = ['summaries', 'knowledge_structure', 'glossary', 'active_recall'] as const;
const cacheInvalidationRequestSchema = z
  .object({
    target: z.enum(['expired', 'source', 'artifacts', 'cache_key', 'all']).default('expired'),
    dry_run: z.boolean().default(true),
    cache_key: z.string().min(1).max(400).optional(),
    kind: z.enum(cacheAdminArtifactKinds).optional(),
    source_revision_id: z.string().min(1).max(160).optional(),
    reason: z.string().max(160).optional()
  })
  .superRefine((value, context) => {
    if (value.target === 'cache_key' && !value.cache_key) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cache_key'],
        message: 'cache_key is required when target is cache_key'
      });
    }
    if (value.target === 'source' && !value.cache_key && !value.source_revision_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['target'],
        message: 'source invalidation requires cache_key or source_revision_id'
      });
    }
    if (value.target === 'artifacts' && !value.cache_key && !value.source_revision_id && !value.kind) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['target'],
        message: 'artifact invalidation requires cache_key, source_revision_id, or kind'
      });
    }
  });

type CostAnalyticsPayload = ReturnType<typeof costAnalyticsSchema.parse>;
type CostDrilldownAnalyticsPayload = ReturnType<typeof costDrilldownAnalyticsSchema.parse>;

const serializePromptEvaluationMetrics = (metrics: PromptEvaluationSnapshot['goldenSet']['topicResults'][number]['metrics']) => ({
  summary_quality: metrics.summaryQuality,
  citation_coverage: metrics.citationCoverage,
  quiz_validity: metrics.quizValidity,
  graph_coherence: metrics.graphCoherence
});

const serializeGenerationFeedbackSummary = (summary: GenerationFeedbackSummary) => ({
  dataset: summary.dataset,
  trusted_artifact: summary.trustedArtifact,
  contaminates_golden_set: summary.contaminatesGoldenSet,
  requires_human_review: summary.requiresHumanReview,
  total_feedback: summary.totalFeedback,
  negative_feedback: summary.negativeFeedback,
  average_rating: summary.averageRating,
  latest_feedback_at: summary.latestFeedbackAt ?? null,
  by_artifact: summary.byArtifact.map((artifact) => ({
    artifact_type: artifact.artifactType,
    total_feedback: artifact.totalFeedback,
    negative_feedback: artifact.negativeFeedback,
    average_rating: artifact.averageRating,
    latest_feedback_at: artifact.latestFeedbackAt ?? null,
    signals: artifact.signals
  }))
});

const serializePromptEvaluationSnapshot = (snapshot: PromptEvaluationSnapshot, feedbackSummary: GenerationFeedbackSummary) =>
  promptEvaluationSchema.parse({
    generated_at: snapshot.generatedAt,
    prompt_registry_version: snapshot.promptRegistryVersion,
    dataset: {
      version: snapshot.dataset.version,
      checksum_sha256: snapshot.dataset.checksumSha256,
      topics: snapshot.dataset.topics
    },
    model: snapshot.model,
    golden_set: {
      pass: snapshot.goldenSet.pass,
      topics: snapshot.goldenSet.topics,
      failed_topics: snapshot.goldenSet.failedTopics,
      quality_threshold_version: snapshot.goldenSet.qualityThresholdVersion,
      topic_results: snapshot.goldenSet.topicResults.map((topic) => ({
        topic_id: topic.topicId,
        title: topic.title,
        domain: topic.domain,
        pass: topic.pass,
        checks: topic.checks,
        metrics: serializePromptEvaluationMetrics(topic.metrics),
        quality_failures: topic.qualityFailures
      }))
    },
    prompt_regression: {
      pass: snapshot.promptRegression.pass,
      prompt_id: snapshot.promptRegression.promptId,
      baseline: {
        prompt_version: snapshot.promptRegression.baseline.promptVersion,
        version: snapshot.promptRegression.baseline.version,
        status: snapshot.promptRegression.baseline.status,
        changelog: snapshot.promptRegression.baseline.changelog
      },
      candidate: {
        prompt_version: snapshot.promptRegression.candidate.promptVersion,
        version: snapshot.promptRegression.candidate.version,
        status: snapshot.promptRegression.candidate.status,
        changelog: snapshot.promptRegression.candidate.changelog
      },
      threshold_version: snapshot.promptRegression.thresholdVersion,
      thresholds: {
        max_drop_by_metric: serializePromptEvaluationMetrics(snapshot.promptRegression.thresholds.maxDropByMetric),
        max_average_drop: snapshot.promptRegression.thresholds.maxAverageDrop
      },
      topics: snapshot.promptRegression.topics,
      failed_topics: snapshot.promptRegression.failedTopics,
      average_drop: snapshot.promptRegression.averageDrop,
      topic_results: snapshot.promptRegression.topicResults.map((topic) => ({
        topic_id: topic.topicId,
        title: topic.title,
        domain: topic.domain,
        pass: topic.pass,
        failures: topic.failures,
        average_drop: topic.averageDrop,
        max_metric_drop: topic.maxMetricDrop,
        baseline: serializePromptEvaluationMetrics(topic.baseline),
        candidate: serializePromptEvaluationMetrics(topic.candidate),
        drops: serializePromptEvaluationMetrics(topic.drops)
      }))
    },
    user_feedback: serializeGenerationFeedbackSummary(feedbackSummary)
  });

const isLoopbackAddress = (address: string | undefined): boolean => {
  if (!address) return process.env.NODE_ENV === 'test';
  const normalized = address.replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
};

const requestBearerToken = (req: Request): string | undefined => {
  const authorization = req.header('authorization')?.trim();
  return authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
};

const isLocalRealModelSmokeRequest = (req: Request): boolean => {
  const configuredToken = process.env.REAL_MODEL_SMOKE_API_TOKEN?.trim();
  if (configuredToken) {
    return requestBearerToken(req) === configuredToken;
  }
  return isLoopbackAddress(req.socket.remoteAddress);
};

const realModelSmokeControlState = (req: Request): { enabled: boolean; disabledReason?: string } => {
  if (process.env.NODE_ENV === 'production') {
    return { enabled: false, disabledReason: 'disabled_in_production' };
  }
  if (process.env.REAL_MODEL_SMOKE_API_ENABLED !== '1') {
    return { enabled: false, disabledReason: 'set_REAL_MODEL_SMOKE_API_ENABLED_1' };
  }
  if (!isLocalRealModelSmokeRequest(req)) {
    return { enabled: false, disabledReason: 'local_request_or_token_required' };
  }
  return { enabled: true };
};

const nextRealModelSmokeAction = (
  status: DomainRealModelSmokeStatus,
  control: ReturnType<typeof realModelSmokeControlState>
): string => {
  if (!control.enabled) {
    if (control.disabledReason === 'disabled_in_production') {
      return 'Run real-model smoke from a local development environment, not production.';
    }
    if (control.disabledReason === 'local_request_or_token_required') {
      return 'Call this endpoint from loopback, or set REAL_MODEL_SMOKE_API_TOKEN and send a matching bearer token.';
    }
    return 'Set REAL_MODEL_SMOKE_API_ENABLED=1 in local development, then POST the confirmation payload.';
  }
  if (status.status === 'running') return 'Poll GET /api/runtime/llm/smoke for completion.';
  if (status.status === 'failed') return 'Review output_tail, fix the local runtime, then POST the confirmation payload again.';
  return `POST {"confirm":"${realModelSmokeConfirmation}"} to /api/runtime/llm/smoke to start the local smoke.`;
};

const serializeRealModelSmokeStatus = (req: Request, status: DomainRealModelSmokeStatus) => {
  const control = realModelSmokeControlState(req);
  return realModelSmokeStatusSchema.parse({
    generated_at: new Date().toISOString(),
    enabled: control.enabled,
    local_only: true,
    status: control.enabled ? status.status : 'disabled',
    run_id: status.runId,
    command: status.command,
    started_at: status.startedAt,
    completed_at: status.completedAt,
    exit_code: status.exitCode,
    output_tail: status.outputTail,
    error: status.error,
    disabled_reason: control.disabledReason,
    next_action: nextRealModelSmokeAction(status, control)
  });
};

const wantsCsv = (value: unknown): boolean => typeof value === 'string' && value.trim().toLowerCase() === 'csv';

const csvCell = (value: string | number | null | undefined): string => {
  const raw = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
};

const csvDocument = (headers: string[], rows: Array<Array<string | number | null | undefined>>): string =>
  [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');

const sendCsv = (res: Response, filename: string, csv: string): void => {
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${filename}"`);
  res.status(200).send(`${csv}\n`);
};

const formatCostSummaryCsv = (payload: CostAnalyticsPayload): string => {
  const headers = [
    'table',
    'provider',
    'stage',
    'pack_id',
    'prompt_version',
    'model',
    'reason',
    'error_type',
    'events',
    'attempted',
    'succeeded',
    'fallback',
    'estimated_tokens',
    'avg_tokens',
    'avg_latency_ms',
    'p95_latency_ms',
    'total_estimated_usd',
    'avg_estimated_usd'
  ];
  const rows: Array<Array<string | number | null | undefined>> = [
    ...payload.by_stage.map((entry) => [
      'by_stage',
      '',
      entry.stage,
      '',
      '',
      '',
      '',
      '',
      entry.events,
      '',
      '',
      '',
      '',
      entry.avg_tokens,
      entry.avg_latency_ms,
      '',
      entry.total_estimated_usd,
      entry.avg_estimated_usd
    ]),
    ...payload.by_pack.map((entry) => [
      'by_pack',
      '',
      '',
      entry.pack_id,
      '',
      '',
      '',
      '',
      entry.events,
      '',
      '',
      '',
      entry.estimated_tokens,
      '',
      '',
      '',
      entry.total_estimated_usd,
      entry.avg_estimated_usd
    ]),
    ...payload.by_prompt_model.map((entry) => [
      'by_prompt_model',
      '',
      '',
      '',
      entry.prompt_version,
      entry.model,
      '',
      '',
      entry.events,
      '',
      '',
      '',
      entry.estimated_tokens,
      '',
      entry.avg_latency_ms,
      '',
      entry.total_estimated_usd,
      ''
    ]),
    ...payload.llm_ops.by_stage_model.map((entry) => [
      'llm_by_stage_model',
      entry.provider,
      entry.stage,
      '',
      '',
      entry.model,
      '',
      '',
      '',
      entry.attempted,
      entry.succeeded,
      entry.fallback,
      '',
      '',
      entry.avg_latency_ms,
      entry.p95_latency_ms,
      '',
      ''
    ]),
    ...payload.llm_ops.fallbacks_by_reason.map((entry) => [
      'llm_fallbacks_by_reason',
      entry.provider,
      entry.stage,
      '',
      '',
      entry.model,
      entry.reason,
      '',
      entry.events,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ]),
    ...payload.llm_ops.errors_by_type.map((entry) => [
      'llm_errors_by_type',
      entry.provider,
      entry.stage,
      '',
      '',
      entry.model,
      '',
      entry.error_type,
      entry.events,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ])
  ];

  return csvDocument(headers, rows);
};

const formatCostDrilldownCsv = (payload: CostDrilldownAnalyticsPayload): string =>
  csvDocument(
    [
      'window_hours',
      'filter_pack_id',
      'filter_prompt_version',
      'filter_model',
      'filter_stage',
      'pack_id',
      'prompt_version',
      'model',
      'stage',
      'events',
      'estimated_tokens',
      'avg_tokens',
      'avg_latency_ms',
      'total_estimated_usd',
      'avg_estimated_usd',
      'first_recorded_at',
      'last_recorded_at'
    ],
    payload.rows.map((entry) => [
      payload.window_hours,
      payload.filters.pack_id,
      payload.filters.prompt_version,
      payload.filters.model,
      payload.filters.stage,
      entry.pack_id,
      entry.prompt_version,
      entry.model,
      entry.stage,
      entry.events,
      entry.estimated_tokens,
      entry.avg_tokens,
      entry.avg_latency_ms,
      entry.total_estimated_usd,
      entry.avg_estimated_usd,
      entry.first_recorded_at,
      entry.last_recorded_at
    ])
  );

const parseOptionalNonNegativeInt = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
};

const parseOptionalUnitNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.min(1, parsed));
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

const authSessionCookieName = 'ultrawiki_auth_session';
const oauthStateCookieName = 'ultrawiki_oauth_state';
const oauthStateTtlSeconds = 10 * 60;

type AuthPrincipal = {
  userId: string;
  displayName?: string;
  source: 'session' | 'legacy_header';
};

const getStringQuery = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const getTrimmedStringQuery = (value: unknown): string | undefined => {
  const stringValue = getStringQuery(value)?.trim();
  return stringValue ? stringValue : undefined;
};
const costStageValues = ['ingestion', 'summarization', 'knowledge_structure', 'glossary', 'active_recall'] as const;
const parseCostStageQuery = (value: unknown): (typeof costStageValues)[number] | undefined => {
  const stage = getTrimmedStringQuery(value);
  if (!stage) return undefined;
  return costStageValues.includes(stage as (typeof costStageValues)[number]) ? (stage as (typeof costStageValues)[number]) : undefined;
};

const parseCookies = (req: Request): Record<string, string> => {
  const header = req.header('cookie');
  if (!header) {
    return {};
  }

  return header.split(';').reduce<Record<string, string>>((acc, part) => {
    const [name, ...rawValue] = part.trim().split('=');
    if (!name || rawValue.length === 0) {
      return acc;
    }
    try {
      acc[name] = decodeURIComponent(rawValue.join('='));
    } catch {
      acc[name] = rawValue.join('=');
    }
    return acc;
  }, {});
};

const serializeCookie = (name: string, value: string, maxAgeSeconds: number): string => {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (config.oidcRedirectUri?.startsWith('https://')) {
    parts.push('Secure');
  }
  return parts.join('; ');
};

const setAuthCookie = (res: Response, token: string): void => {
  res.append('Set-Cookie', serializeCookie(authSessionCookieName, token, config.authSessionTtlSeconds));
};

const clearAuthCookie = (res: Response): void => {
  res.append('Set-Cookie', serializeCookie(authSessionCookieName, '', 0));
};

const setOAuthStateCookie = (res: Response, state: OAuthState): void => {
  res.append('Set-Cookie', serializeCookie(oauthStateCookieName, createSignedToken(state, config.authSessionSecret), oauthStateTtlSeconds));
};

const clearOAuthStateCookie = (res: Response): void => {
  res.append('Set-Cookie', serializeCookie(oauthStateCookieName, '', 0));
};

const resolveOidcConfig = (): OidcConfig | undefined => {
  if (
    !config.oidcAuthorizationUrl ||
    !config.oidcTokenUrl ||
    !config.oidcUserinfoUrl ||
    !config.oidcClientId ||
    !config.oidcClientSecret ||
    !config.oidcRedirectUri
  ) {
    return undefined;
  }

  return {
    authorizationUrl: config.oidcAuthorizationUrl,
    tokenUrl: config.oidcTokenUrl,
    userinfoUrl: config.oidcUserinfoUrl,
    clientId: config.oidcClientId,
    clientSecret: config.oidcClientSecret,
    redirectUri: config.oidcRedirectUri,
    issuer: config.oidcIssuer,
    scope: config.oidcScope
  };
};

const getBearerToken = (req: Request): string | undefined => {
  const authorization = req.header('authorization')?.trim();
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
};

const resolvePrincipal = (req: Request): AuthPrincipal | undefined => {
  const cookies = parseCookies(req);
  const token = cookies[authSessionCookieName] ?? getBearerToken(req);
  const session = verifySessionToken(token, config.authSessionSecret);
  if (session) {
    return {
      userId: session.userId,
      displayName: session.displayName,
      source: 'session'
    };
  }

  if (!config.authAllowHeaderUser) {
    return undefined;
  }

  const userId = getUserId(req);
  if (!userId) {
    return undefined;
  }

  return {
    userId,
    displayName: getUserDisplayName(req),
    source: 'legacy_header'
  };
};

const auditSecurity = (
  level: 'info' | 'warn' | 'error',
  req: Request,
  eventType: string,
  payload: Omit<Parameters<typeof logSecurityEvent>[1], 'eventType' | 'correlationId' | 'path' | 'method'> = {}
): void => {
  securityEventMetrics.recordSecurityEvent(eventType);
  logSecurityEvent(level, {
    eventType,
    correlationId: getCorrelationId(req),
    path: redactSensitivePath(req.path),
    method: req.method,
    ...payload
  });
};

export const resetShareReadAbuseControlsForTests = (): void => {
  shareReadRateLimiter.reset();
  shareReadFailureRateLimiter.reset();
  generationRateLimiter = new FixedWindowRateLimiter(
    config.generationRateLimitMax,
    config.generationRateLimitWindowSeconds
  );
  authRateLimiter = new FixedWindowRateLimiter(config.authRateLimitMax, config.authRateLimitWindowSeconds);
  analyticsRateLimiter = new FixedWindowRateLimiter(
    config.analyticsRateLimitMax,
    config.analyticsRateLimitWindowSeconds
  );
};

export const configureRateLimitersForTests = (settings: {
  generation?: { max: number; windowSeconds: number };
  auth?: { max: number; windowSeconds: number };
  analytics?: { max: number; windowSeconds: number };
}): void => {
  if (settings.generation) {
    generationRateLimiter = new FixedWindowRateLimiter(settings.generation.max, settings.generation.windowSeconds);
  }
  if (settings.auth) {
    authRateLimiter = new FixedWindowRateLimiter(settings.auth.max, settings.auth.windowSeconds);
  }
  if (settings.analytics) {
    analyticsRateLimiter = new FixedWindowRateLimiter(settings.analytics.max, settings.analytics.windowSeconds);
  }
};

export const resetRealModelSmokeForTests = (): void => {
  realModelSmokeController.resetForTests();
};

export const setRealModelSmokeRunnerForTests = (runner: RealModelSmokeRunner): void => {
  realModelSmokeController.setRunnerForTests(runner);
};

const stableFingerprint = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;

const clientRateLimitKey = (req: Request): string => {
  const forwardedFor =
    req.app.get('trust proxy') === true ? req.header('x-forwarded-for')?.split(',')[0]?.trim() : undefined;
  const clientAddress = forwardedFor || req.ip || req.socket.remoteAddress || 'unknown';
  return stableFingerprint(clientAddress);
};

type RouteRateLimitSource = 'generation' | 'auth' | 'analytics' | 'share_read';
type RouteRateLimitEventType =
  | 'rate_limit.generation_exceeded'
  | 'rate_limit.auth_exceeded'
  | 'rate_limit.analytics_exceeded'
  | 'rate_limit.share_read_exceeded';
type RouteRateLimitLimiter = 'generation_ip' | 'auth_ip' | 'analytics_ip' | 'share_read_ip' | 'share_read_failed_ip';

const routeRateLimitEventTypes: Record<RouteRateLimitSource, RouteRateLimitEventType> = {
  generation: 'rate_limit.generation_exceeded',
  auth: 'rate_limit.auth_exceeded',
  analytics: 'rate_limit.analytics_exceeded',
  share_read: 'rate_limit.share_read_exceeded'
};

const rejectRouteRateLimit = (
  req: Request,
  res: Response,
  decision: ReturnType<FixedWindowRateLimiter['check']>,
  source: RouteRateLimitSource,
  limiter: RouteRateLimitLimiter
): void => {
  auditSecurity('warn', req, routeRateLimitEventTypes[source], {
    source,
    limiter,
    limit: decision.limit,
    retryAfterSeconds: decision.retryAfterSeconds,
    clientFingerprint: clientRateLimitKey(req)
  });
  res.setHeader('Retry-After', String(decision.retryAfterSeconds));
  res.status(429).json({
    error: 'rate_limited',
    retry_after_seconds: decision.retryAfterSeconds
  });
};

const rateLimitMiddleware =
  (source: Exclude<RouteRateLimitSource, 'share_read'>, limiter: Exclude<RouteRateLimitLimiter, 'share_read_ip' | 'share_read_failed_ip'>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const routeLimiter =
      source === 'generation' ? generationRateLimiter : source === 'auth' ? authRateLimiter : analyticsRateLimiter;
    const decision = routeLimiter.check(`${limiter}:${clientRateLimitKey(req)}`);
    if (!decision.allowed) {
      rejectRouteRateLimit(req, res, decision, source, limiter);
      return;
    }
    next();
  };

const generationRateLimit = rateLimitMiddleware('generation', 'generation_ip');
const authRateLimit = rateLimitMiddleware('auth', 'auth_ip');
const analyticsRateLimit = rateLimitMiddleware('analytics', 'analytics_ip');

const requirePrincipal = (req: Request, res: Response): AuthPrincipal | undefined => {
  const principal = resolvePrincipal(req);
  if (!principal) {
    auditSecurity('warn', req, 'auth.authentication_required', { reason: 'missing_or_invalid_session' });
    res.status(401).json({ error: 'authentication_required' });
    return undefined;
  }

  if (principal.source === 'legacy_header') {
    auditSecurity('info', req, 'auth.legacy_header_used', {
      userId: principal.userId,
      source: principal.source
    });
  }

  return principal;
};

const ensureSavedPackPermission = async (
  req: Request,
  res: Response,
  principal: AuthPrincipal,
  packId: string,
  action: string
): Promise<boolean> => {
  if (await repo.isPackSavedForUser(principal.userId, packId)) {
    return true;
  }

  auditSecurity('warn', req, 'auth.permission_denied', {
    userId: principal.userId,
    source: principal.source,
    packId,
    reason: action
  });
  res.status(403).json({ error: 'permission_denied', reason: action });
  return false;
};

const configuredAdminUserIds = (): Set<string> =>
  new Set(
    (process.env.ADMIN_USER_IDS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );

const requireAdminPrincipal = (req: Request, res: Response, action: string): AuthPrincipal | undefined => {
  const principal = requirePrincipal(req, res);
  if (!principal) {
    return undefined;
  }

  const adminUserIds = configuredAdminUserIds();
  const adminAllowed =
    adminUserIds.size > 0 ? adminUserIds.has(principal.userId) : process.env.NODE_ENV !== 'production';
  if (adminAllowed) {
    return principal;
  }

  auditSecurity('warn', req, 'auth.permission_denied', {
    userId: principal.userId,
    source: principal.source,
    reason: action
  });
  res.status(403).json({ error: 'permission_denied', reason: action });
  return undefined;
};

const ensureUserProfile = async (principal: AuthPrincipal) => {
  const existing = await repo.getUserProfile(principal.userId);
  if (existing && (principal.source === 'session' || !principal.displayName)) {
    return existing;
  }

  return repo.upsertUserProfile(principal.userId, principal.displayName);
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

const serializeCacheAdminSnapshot = (snapshot: CacheAdminSnapshot) => ({
  generated_at: snapshot.generatedAt,
  source: snapshot.source,
  artifacts: {
    total: snapshot.artifacts.total,
    fresh: snapshot.artifacts.fresh,
    expired: snapshot.artifacts.expired,
    by_kind: snapshot.artifacts.byKind.map((entry) => ({
      kind: entry.kind,
      total: entry.total,
      expired: entry.expired
    }))
  },
  stale_sources: snapshot.staleSources.map((entry) => ({
    cache_key: entry.cacheKey,
    source_title: entry.sourceTitle,
    source_revision_id: entry.sourceRevisionId,
    parser_version: entry.parserVersion,
    expires_at: entry.expiresAt
  })),
  stale_artifacts: snapshot.staleArtifacts.map((entry) => ({
    cache_key: entry.cacheKey,
    kind: entry.kind,
    source_revision_id: entry.sourceRevisionId,
    prompt_version: entry.promptVersion,
    taxonomy_version: entry.taxonomyVersion,
    expires_at: entry.expiresAt
  })),
  repair_candidates: snapshot.repairCandidates
});

const serializeCacheInvalidationResult = (result: CacheInvalidationResult) => ({
  target: result.target,
  dry_run: result.dryRun,
  cache_key: result.cacheKey,
  kind: result.kind,
  source_revision_id: result.sourceRevisionId,
  reason: result.reason,
  requested_at: result.requestedAt,
  matched: {
    source: result.matchedSource,
    artifacts: result.matchedArtifacts,
    total: result.matchedSource + result.matchedArtifacts
  },
  deleted: {
    source: result.deletedSource,
    artifacts: result.deletedArtifacts,
    total: result.deletedSource + result.deletedArtifacts
  }
});

const serializeHistory = (items: Awaited<ReturnType<typeof repo.listRecentPacksForSession>>) =>
  studyPackHistorySchema.parse({
    items: items.map((item) => ({
      id: item.id,
      input: item.input,
      source_revision_id: item.sourceRevisionId,
      created_at: item.createdAt,
      saved_at: item.savedAt,
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
      },
      progress: item.progress
        ? {
            total_cards: item.progress.totalCards,
            reviewed_cards: item.progress.reviewedCards,
            due_cards: item.progress.dueCards,
            mastery_score: item.progress.masteryScore,
            next_due_at: item.progress.nextDueAt
          }
        : undefined,
      organization: item.organization
        ? {
            tags: item.organization.tags,
            collection: item.organization.collection
          }
        : undefined
    }))
  });

const serializeLibraryHistory = (library: SavedLibraryList) =>
  studyPackHistorySchema.parse({
    ...serializeHistory(library.items),
    facets: {
      total: library.facets.total,
      readiness: {
        full: library.facets.readiness.full,
        partial: library.facets.readiness.partial
      },
      progress: {
        due: library.facets.progress.due,
        reviewed: library.facets.progress.reviewed,
        not_started: library.facets.progress.notStarted
      },
      tags: library.facets.tags,
      collections: library.facets.collections
    }
  });

const serializeSavedPackOrganization = (packId: string, organization: SavedPackOrganization) =>
  updateSavedPackOrganizationResponseSchema.parse({
    pack_id: packId,
    organization: {
      tags: organization.tags,
      collection: organization.collection
    }
  });

const serializeVersionArtifactCounts = (counts: SavedPackVersionHistory['current']['artifactCounts']) => ({
  summaries: counts.summaries,
  glossary: counts.glossary,
  flashcards: counts.flashcards,
  quiz_questions: counts.quizQuestions,
  graph_nodes: counts.graphNodes,
  graph_edges: counts.graphEdges,
  timeline_events: counts.timelineEvents
});

const serializeSavedPackVersionItem = (item: SavedPackVersionHistory['current']) => ({
  id: item.id,
  input: item.input,
  source_revision_id: item.sourceRevisionId,
  created_at: item.createdAt,
  saved_at: item.savedAt,
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
  },
  progress: item.progress
    ? {
        total_cards: item.progress.totalCards,
        reviewed_cards: item.progress.reviewedCards,
        due_cards: item.progress.dueCards,
        mastery_score: item.progress.masteryScore,
        next_due_at: item.progress.nextDueAt
      }
    : undefined,
  organization: item.organization
    ? {
        tags: item.organization.tags,
        collection: item.organization.collection
      }
    : undefined,
  current: item.current,
  source_revision_changed: item.sourceRevisionChanged,
  artifact_counts: serializeVersionArtifactCounts(item.artifactCounts)
});

const serializeSavedPackVersionHistory = (history: SavedPackVersionHistory) =>
  savedPackVersionHistorySchema.parse({
    current: serializeSavedPackVersionItem(history.current),
    versions: history.versions.map(serializeSavedPackVersionItem),
    compare: {
      baseline_pack_id: history.compare.baselinePackId,
      baseline_source_revision_id: history.compare.baselineSourceRevisionId,
      source_revision_changed: history.compare.sourceRevisionChanged,
      readiness_changed: history.compare.readinessChanged,
      artifact_deltas: serializeVersionArtifactCounts(history.compare.artifactDeltas),
      missing_artifacts_added: history.compare.missingArtifactsAdded,
      missing_artifacts_removed: history.compare.missingArtifactsRemoved
    }
  });

const serializeUserProfile = (profile: Awaited<ReturnType<typeof repo.upsertUserProfile>>) =>
  userProfileSchema.parse({
    user_id: profile.userId,
    display_name: profile.displayName,
    created_at: profile.createdAt,
    updated_at: profile.updatedAt
  });

const serializeShareLink = (share: ShareLinkRecord) => ({
  share_id: publicShareToken(share.shareId, share.tokenVersion, config.shareTokenSecret),
  pack_id: share.packId,
  owner_user_id: share.ownerUserId,
  role: share.role,
  created_at: share.createdAt,
  expires_at: share.expiresAt,
  revoked_at: share.revokedAt
});

const serializeShareManagementItem = (share: ShareLinkRecord) => ({
  share: serializeShareLink(share),
  share_path: `/api/shared/${publicShareToken(share.shareId, share.tokenVersion, config.shareTokenSecret)}`
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

const serializeQuizAttempt = (attempt: QuizAttemptRecord) =>
  quizAttemptResponseSchema.parse({
    attempt_id: attempt.id,
    user_id: attempt.userId,
    pack_id: attempt.packId,
    attempt_number: attempt.attemptNumber,
    selected_indices: attempt.selectedIndices,
    total_questions: attempt.totalQuestions,
    correct_answers: attempt.correctAnswers,
    accuracy: attempt.accuracy,
    previous_accuracy: attempt.previousAccuracy,
    accuracy_delta: attempt.accuracyDelta,
    card_mastery_score: attempt.cardMasteryScore,
    mastery_score: attempt.masteryScore,
    mastery_delta: attempt.masteryDelta,
    submitted_at: attempt.submittedAt
  });

const serializeLearningAnalytics = (analytics: LearningAnalyticsRecord) =>
  learningAnalyticsSchema.parse({
    user_id: analytics.userId,
    generated_at: analytics.generatedAt,
    total_cards: analytics.totalCards,
    reviewed_cards: analytics.reviewedCards,
    due_cards: analytics.dueCards,
    due_packs: analytics.duePacks,
    streak: {
      current_days: analytics.streak.currentDays,
      longest_days: analytics.streak.longestDays,
      last_activity_at: analytics.streak.lastActivityAt
    },
    goal: {
      daily_target_reviews: analytics.goal.dailyTargetReviews,
      reviews_today: analytics.goal.reviewsToday,
      remaining_today: analytics.goal.remainingToday,
      target_met: analytics.goal.targetMet,
      created_at: analytics.goal.createdAt,
      updated_at: analytics.goal.updatedAt
    },
    retention: {
      reviewed_cards: analytics.retention.reviewedCards,
      retained_cards: analytics.retention.retainedCards,
      due_reviewed_cards: analytics.retention.dueReviewedCards,
      retention_rate: analytics.retention.retentionRate
    },
    mastery: {
      average_score: analytics.mastery.averageScore,
      average_delta: analytics.mastery.averageDelta,
      trend: analytics.mastery.trend.map((point) => ({
        source: point.source,
        pack_id: point.packId,
        recorded_at: point.recordedAt,
        mastery_score: point.masteryScore,
        mastery_delta: point.masteryDelta
      }))
    },
    accuracy: {
      attempts: analytics.accuracy.attempts,
      retakes: analytics.accuracy.retakes,
      average_accuracy: analytics.accuracy.averageAccuracy,
      latest_accuracy: analytics.accuracy.latestAccuracy,
      accuracy_delta: analytics.accuracy.accuracyDelta,
      trend: analytics.accuracy.trend.map((point) => ({
        pack_id: point.packId,
        attempt_number: point.attemptNumber,
        submitted_at: point.submittedAt,
        accuracy: point.accuracy,
        accuracy_delta: point.accuracyDelta,
        mastery_score: point.masteryScore
      }))
    },
    packs: analytics.packs.map((pack) => ({
      pack_id: pack.packId,
      total_cards: pack.totalCards,
      reviewed_cards: pack.reviewedCards,
      due_cards: pack.dueCards,
      retained_cards: pack.retainedCards,
      retention_rate: pack.retentionRate,
      mastery_score: pack.masteryScore,
      next_due_at: pack.nextDueAt,
      last_reviewed_at: pack.lastReviewedAt,
      quiz_attempts: pack.quizAttempts,
      latest_accuracy: pack.latestAccuracy,
      accuracy_delta: pack.accuracyDelta
    }))
  });

const earliestIso = (values: Array<string | undefined>): string | undefined => {
  const ordered = values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  return ordered[0];
};

const serializeLearningReminder = (analytics: LearningAnalyticsRecord) => {
  const duePacks = analytics.packs
    .filter((pack) => pack.dueCards > 0)
    .sort((left, right) => right.dueCards - left.dueCards || (left.nextDueAt ?? '').localeCompare(right.nextDueAt ?? ''));
  const futureNextDueAt = earliestIso(analytics.packs.map((pack) => pack.nextDueAt));
  const nextDueAt = analytics.dueCards > 0 ? analytics.generatedAt : futureNextDueAt;

  return learningReminderSchema.parse({
    user_id: analytics.userId,
    generated_at: analytics.generatedAt,
    due_cards: analytics.dueCards,
    due_packs: analytics.duePacks,
    next_due_at: nextDueAt,
    poll_after_seconds: analytics.dueCards > 0 ? 300 : 3600,
    delivery: 'local_poll',
    external_notifications: false,
    packs: duePacks.map((pack) => ({
      pack_id: pack.packId,
      due_cards: pack.dueCards,
      next_due_at: pack.dueCards > 0 ? analytics.generatedAt : pack.nextDueAt,
      last_reviewed_at: pack.lastReviewedAt
    }))
  });
};

const serializeSecurityAnalytics = () => {
  const security = securityEventMetrics.getSnapshot();

  return {
    suspicious_inputs_total: security.suspiciousInputsTotal,
    signature_alerts_total: security.signatureAlertsTotal,
    security_events_total: security.securityEventsTotal,
    rate_limit_events_total: security.rateLimitEventsTotal,
    event_categories: security.eventCategories.map((event) => ({
      category: event.category,
      count: event.count
    })),
    rate_limit_events: security.rateLimitEvents.map((event) => ({
      event_type: event.eventType,
      count: event.count
    })),
    events: security.events.map((event) => ({
      event_type: event.eventType,
      count: event.count
    }))
  };
};

const serializeStudyGoal = (
  userId: string,
  goal: StudyGoalRecord | undefined,
  analytics?: LearningAnalyticsRecord
) =>
  studyGoalSchema.parse({
    user_id: userId,
    daily_target_reviews: goal?.dailyTargetReviews ?? analytics?.goal.dailyTargetReviews ?? 0,
    reviews_today: analytics?.goal.reviewsToday,
    remaining_today: analytics?.goal.remainingToday,
    target_met: analytics?.goal.targetMet,
    created_at: goal?.createdAt,
    updated_at: goal?.updatedAt
  });

const serializeGenerationFeedback = (feedback: GenerationFeedbackRecord) =>
  generationFeedbackSchema.parse({
    feedback_id: feedback.id,
    user_id: feedback.userId,
    pack_id: feedback.packId,
    artifact_type: feedback.artifactType,
    artifact_id: feedback.artifactId,
    rating: feedback.rating,
    signal: feedback.signal,
    comment: feedback.comment,
    prompt_version: feedback.promptVersion,
    model: feedback.model,
    created_at: feedback.createdAt,
    governance: {
      dataset: 'user_feedback',
      trusted_artifact: feedback.trustedArtifact,
      eval_candidate: feedback.evalCandidate,
      contaminates_golden_set: false,
      requires_human_review: true
    }
  });

const serializeUserDataShare = (share: ShareLinkRecord) => ({
  share_id: share.shareId,
  pack_id: share.packId,
  owner_user_id: share.ownerUserId,
  role: share.role,
  created_at: share.createdAt,
  expires_at: share.expiresAt,
  revoked_at: share.revokedAt
});

const serializeUserDataReview = (review: UserDataExportRecord['flashcardReviews'][number]) => ({
  review_id: review.id,
  user_id: review.userId,
  pack_id: review.packId,
  card_index: review.cardIndex,
  rating: review.rating,
  reviewed_at: review.reviewedAt,
  next_due_at: review.nextDueAt
});

const serializeUserDataLearningSession = (session: LearningSessionRecord) => ({
  session_id: session.id,
  user_id: session.userId,
  pack_id: session.packId,
  status: session.status,
  started_at: session.startedAt,
  completed_at: session.completedAt,
  baseline_due_cards: session.baselineDueCards,
  baseline_mastery_score: session.baselineMasteryScore,
  reviewed_count: session.reviewedCount,
  outcome: {
    completed_cards: session.outcome.completedCards,
    remaining_cards: session.outcome.remainingCards,
    mastery_score: session.outcome.masteryScore,
    mastery_delta: session.outcome.masteryDelta
  }
});

const serializeUserDataExport = (exported: UserDataExportRecord) =>
  userDataExportSchema.parse({
    user_id: exported.userId,
    exported_at: exported.exportedAt,
    profile: exported.profile ? serializeUserProfile(exported.profile) : undefined,
    library: exported.library.map((item) => ({
      pack_id: item.packId,
      saved_at: item.savedAt,
      organization: item.organization
        ? {
            tags: item.organization.tags,
            collection: item.organization.collection
          }
        : undefined
    })),
    shares: exported.shares.map(serializeUserDataShare),
    flashcard_reviews: exported.flashcardReviews.map(serializeUserDataReview),
    learning_sessions: exported.learningSessions.map(serializeUserDataLearningSession),
    quiz_attempts: exported.quizAttempts.map(serializeQuizAttempt),
    study_goal: exported.studyGoal ? serializeStudyGoal(exported.userId, exported.studyGoal) : undefined,
    generation_feedback: exported.generationFeedback.map(serializeGenerationFeedback)
  });

const serializeUserDataDelete = (result: UserDataDeleteResult) =>
  userDataDeleteResponseSchema.parse({
    user_id: result.userId,
    deleted_at: result.deletedAt,
    deleted: {
      profile: result.deleted.profile,
      library: result.deleted.library,
      shares: result.deleted.shares,
      flashcard_reviews: result.deleted.flashcardReviews,
      learning_sessions: result.deleted.learningSessions,
      quiz_attempts: result.deleted.quizAttempts,
      study_goals: result.deleted.studyGoals,
      generation_feedback: result.deleted.generationFeedback
    }
  });

const serializeLearningSession = (
  pack: PackRecord,
  progress: NonNullable<Awaited<ReturnType<typeof repo.getLearningProgress>>>,
  baseline: { dueCards?: number; masteryScore?: number },
  persisted?: LearningSessionRecord
) => {
  const session = buildLearningSession(pack, progress, baseline);
  return {
    payload: learningSessionSchema.parse({
      session_id: persisted?.id,
      started_at: persisted?.startedAt,
      completed_at: persisted?.completedAt,
      reviewed_count: persisted?.reviewedCount,
      user_id: session.userId,
      pack_id: session.packId,
      status: session.status,
      queue: session.queue.map((card) => ({
        position: card.position,
        card_index: card.cardIndex,
        question: card.question,
        answer: card.answer,
        citation: card.citation,
        prompt_version: card.promptVersion,
        model: card.model,
        reviewed: card.reviewed,
        due: card.due,
        last_rating: card.lastRating,
        reviewed_at: card.reviewedAt,
        next_due_at: card.nextDueAt
      })),
      metrics: {
        total_cards: session.metrics.totalCards,
        reviewed_cards: session.metrics.reviewedCards,
        due_cards: session.metrics.dueCards,
        session_total: session.metrics.sessionTotal,
        completed_cards: session.metrics.completedCards,
        remaining_cards: session.metrics.remainingCards,
        mastery_score: session.metrics.masteryScore,
        mastery_delta: session.metrics.masteryDelta
      }
    }),
    session
  };
};

const learningSessionProgressInput = (session: LearningSessionPayload): UpsertLearningSessionProgressInput => ({
  status: session.status === 'complete' ? 'completed' : 'active',
  reviewedCount: session.metrics.completedCards,
  outcome: {
    completedCards: session.metrics.completedCards,
    remainingCards: session.metrics.remainingCards,
    masteryScore: session.metrics.masteryScore,
    masteryDelta: session.metrics.masteryDelta
  }
});

const persistedLearningSessionBaseline = (session: LearningSessionRecord) => ({
  dueCards: session.baselineDueCards,
  masteryScore: session.baselineMasteryScore
});

const persistedLearningSessionResponse = async (
  pack: PackRecord,
  progress: NonNullable<Awaited<ReturnType<typeof repo.getLearningProgress>>>,
  persisted: LearningSessionRecord
) => {
  const initial = serializeLearningSession(pack, progress, persistedLearningSessionBaseline(persisted), persisted);
  const updated = await repo.updateLearningSessionProgress(
    persisted.userId,
    persisted.packId,
    persisted.id,
    learningSessionProgressInput(initial.session)
  );
  return serializeLearningSession(pack, progress, persistedLearningSessionBaseline(updated ?? persisted), updated ?? persisted).payload;
};

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

const buildBatchTopicIdempotencyKey = (batchKey: string, index: number, topic: string): string => {
  const topicHash = createHash('sha256').update(topic.trim().toLowerCase()).digest('hex').slice(0, 16);
  return `${batchKey}:${index}:${topicHash}`;
};

const getQueueCapacitySnapshot = async (sessionId: string) => {
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

  return queueStatusSchema.parse({
    queued,
    running,
    max_queue_depth: config.maxQueueDepth,
    global_concurrency_limit: config.globalConcurrencyLimit,
    session_inflight: sessionInflight,
    session_concurrency_limit: config.sessionConcurrencyLimit,
    capacity_state: capacityState
  });
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

export const processNextQueuedJobForTests = async (): Promise<void> => {
  await processOneQueuedJob();
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

  app.get('/api/auth/login', authRateLimit, (req: Request, res: Response) => {
    const oidcConfig = resolveOidcConfig();
    if (!oidcConfig) {
      auditSecurity('error', req, 'auth.oidc_config_missing', { provider: 'oidc' });
      res.status(503).json({ error: 'oidc_not_configured' });
      return;
    }

    const redirectPath = getStringQuery(req.query.redirect_path) ?? '/';
    const state = createOAuthStateToken(redirectPath, config.authSessionSecret, oauthStateTtlSeconds * 1000);
    setOAuthStateCookie(res, state);
    res.redirect(302, buildAuthorizationUrl(oidcConfig, state.state));
  });

  app.get('/api/auth/callback', authRateLimit, async (req: Request, res: Response) => {
    const oidcConfig = resolveOidcConfig();
    if (!oidcConfig) {
      auditSecurity('error', req, 'auth.oidc_config_missing', { provider: 'oidc' });
      res.status(503).json({ error: 'oidc_not_configured' });
      return;
    }

    const code = getStringQuery(req.query.code);
    const callbackState = getStringQuery(req.query.state);
    const state = verifyOAuthStateToken(
      parseCookies(req)[oauthStateCookieName],
      callbackState,
      config.authSessionSecret
    );
    if (!code || !state) {
      auditSecurity('warn', req, 'auth.oidc_callback_rejected', { provider: 'oidc', reason: 'invalid_state_or_code' });
      clearOAuthStateCookie(res);
      res.status(400).json({ error: 'invalid_oidc_callback' });
      return;
    }

    try {
      const token = await exchangeAuthorizationCode(oidcConfig, code);
      if (!token.access_token) {
        throw new Error('oidc_access_token_missing');
      }
      const userInfo = await fetchOidcUserInfo(oidcConfig, token.access_token);
      const displayName = userInfo.name ?? userInfo.preferred_username ?? userInfo.email ?? userInfo.sub;
      const userId = userIdFromOidc(oidcConfig.issuer, userInfo.sub);
      await repo.upsertUserProfile(userId, displayName);

      const session: AuthSession = {
        userId,
        displayName,
        provider: 'oidc',
        expiresAt: Date.now() + config.authSessionTtlSeconds * 1000
      };
      setAuthCookie(res, createSessionToken(session, config.authSessionSecret));
      clearOAuthStateCookie(res);
      auditSecurity('info', req, 'auth.login_succeeded', {
        userId,
        provider: 'oidc',
        source: 'session'
      });
      res.redirect(302, state.redirectPath);
    } catch (error) {
      auditSecurity('error', req, 'auth.login_failed', {
        provider: 'oidc',
        reason: error instanceof Error ? error.message : 'unknown'
      });
      clearOAuthStateCookie(res);
      res.status(502).json({ error: 'oidc_login_failed' });
    }
  });

  app.get('/api/auth/session', authRateLimit, async (req: Request, res: Response) => {
    const principal = resolvePrincipal(req);
    if (!principal) {
      res.status(200).json({ authenticated: false });
      return;
    }

    const profile = await ensureUserProfile(principal);
    res.status(200).json({
      authenticated: true,
      source: principal.source,
      user: serializeUserProfile(profile)
    });
  });

  app.post('/api/auth/logout', authRateLimit, (req: Request, res: Response) => {
    const principal = resolvePrincipal(req);
    clearAuthCookie(res);
    if (principal) {
      auditSecurity('info', req, 'auth.logout', {
        userId: principal.userId,
        source: principal.source
      });
    }
    res.status(200).json({ authenticated: false });
  });

  app.get('/api/study-packs', async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    const items = await repo.listRecentPacksForSession(sessionId, parseLimit(req.query.limit));
    res.status(200).json(serializeHistory(items));
  });

  app.get('/api/library', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }
    const library = await repo.listSavedLibraryForUser(principal.userId, {
      limit: parseLimit(req.query.limit),
      search: parseQueryText(req.query.q ?? req.query.search),
      readiness: parseEnumQuery<SavedLibraryReadinessFilter>(req.query.readiness, libraryReadinessFilters, 'all'),
      progress: parseEnumQuery<SavedLibraryProgressFilter>(req.query.progress, libraryProgressFilters, 'all'),
      sort: parseEnumQuery<SavedLibrarySort>(req.query.sort, librarySorts, 'saved_desc'),
      tag: parseTagQueryText(req.query.tag),
      collection: parseCollectionQueryText(req.query.collection)
    });
    res.status(200).json(serializeLibraryHistory(library));
  });

  app.patch('/api/library/:packId/organization', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }
    const parsed = updateSavedPackOrganizationRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_library_organization' });
      return;
    }
    const organization = await repo.updateSavedPackOrganization(principal.userId, req.params.packId, {
      tags: parsed.data.tags,
      collection: parsed.data.collection ?? undefined
    });
    if (!organization) {
      res.status(404).json({ error: 'saved_pack_not_found' });
      return;
    }
    res.status(200).json(serializeSavedPackOrganization(req.params.packId, organization));
  });

  app.get('/api/library/:packId/versions', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }
    const history = await repo.getSavedPackVersionHistory(
      principal.userId,
      req.params.packId,
      parseLimit(req.query.limit, 10)
    );
    if (!history) {
      res.status(404).json({ error: 'saved_pack_not_found' });
      return;
    }
    res.status(200).json(serializeSavedPackVersionHistory(history));
  });

  app.get('/api/me', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }
    const profile = await ensureUserProfile(principal);
    res.status(200).json(serializeUserProfile(profile));
  });

  app.post('/api/me', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }
    const parsed = upsertUserProfileRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const profile = parsed.data.display_name
      ? await repo.upsertUserProfile(principal.userId, parsed.data.display_name)
      : await ensureUserProfile(principal);
    res.status(200).json(serializeUserProfile(profile));
  });

  app.get('/api/me/export', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }
    const exported = await repo.exportUserData(principal.userId);
    auditSecurity('info', req, 'auth.user_data_exported', {
      userId: principal.userId,
      source: principal.source
    });
    res.status(200).json(serializeUserDataExport(exported));
  });

  app.delete('/api/me', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }
    const result = await repo.deleteUserData(principal.userId);
    clearAuthCookie(res);
    auditSecurity('info', req, 'auth.user_data_deleted', {
      userId: principal.userId,
      source: principal.source
    });
    res.status(200).json(serializeUserDataDelete(result));
  });

  app.post('/api/study-packs', generationRateLimit, async (req: Request, res: Response) => {
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
    const principal = resolvePrincipal(req);
    if (principal) {
      if (principal.source === 'legacy_header') {
        auditSecurity('info', req, 'auth.legacy_header_used', {
          userId: principal.userId,
          source: principal.source
        });
      }
      await ensureUserProfile(principal);
    }
    const idempotent = await repo.createOrReuseByIdempotency(parsed.data.idempotency_key, config.idempotencyTtlSeconds);
    if (idempotent.reused) {
      if (principal) {
        await repo.savePackForUser(principal.userId, idempotent.packId);
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
    if (principal) {
      await repo.savePackForUser(principal.userId, idempotent.packId);
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

  app.post('/api/study-packs/batch', generationRateLimit, async (req: Request, res: Response) => {
    const parsed = createBatchStudyPackRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const sessionId = getSessionId(req);
    const principal = resolvePrincipal(req);
    if (principal) {
      if (principal.source === 'legacy_header') {
        auditSecurity('info', req, 'auth.legacy_header_used', {
          userId: principal.userId,
          source: principal.source
        });
      }
      await ensureUserProfile(principal);
    }

    const capacityBefore = await getQueueCapacitySnapshot(sessionId);
    let queuedForecast = capacityBefore.queued;
    let sessionInflightForecast = capacityBefore.session_inflight;
    const seenTopics = new Set<string>();
    const acceptedAt = new Date().toISOString();
    const items: Array<{
      index: number;
      title_or_url: string;
      status: 'accepted' | 'reused' | 'rejected' | 'deferred';
      pack_id?: string;
      job_id?: string;
      reason?: string;
    }> = [];

    for (const [index, rawTopic] of parsed.data.topics.entries()) {
      const topic = rawTopic.trim().replace(/\s+/g, ' ');
      const normalizedTopic = topic.toLowerCase();
      if (seenTopics.has(normalizedTopic)) {
        items.push({ index, title_or_url: topic, status: 'rejected', reason: 'duplicate_topic' });
        continue;
      }
      seenTopics.add(normalizedTopic);

      const correlationId = getCorrelationId(req);
      const sanitizedInput = sanitizeSourceText(topic);
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

      if (!isLikelyWikipediaInput(topic)) {
        items.push({ index, title_or_url: topic, status: 'rejected', reason: 'invalid_wikipedia_input' });
        continue;
      }

      const budget = budgetPolicy.evaluate(estimateWork(topic));
      if (!budget.allowed) {
        items.push({ index, title_or_url: topic, status: 'rejected', reason: budget.reason ?? 'budget_exceeded' });
        continue;
      }

      const idempotencyKey = buildBatchTopicIdempotencyKey(parsed.data.idempotency_key, index, topic);
      const existingIdempotent = await repo.getIdempotency(idempotencyKey, config.idempotencyTtlSeconds);
      if (existingIdempotent) {
        if (principal) {
          await repo.savePackForUser(principal.userId, existingIdempotent.packId);
        }
        items.push({
          index,
          title_or_url: topic,
          status: 'reused',
          pack_id: existingIdempotent.packId,
          job_id: existingIdempotent.jobId
        });
        continue;
      }

      if (queuedForecast >= config.maxQueueDepth) {
        items.push({ index, title_or_url: topic, status: 'deferred', reason: 'queue_full' });
        continue;
      }
      if (sessionInflightForecast >= config.sessionConcurrencyLimit) {
        items.push({ index, title_or_url: topic, status: 'deferred', reason: 'session_limit' });
        continue;
      }

      const idempotent = await repo.createOrReuseByIdempotency(idempotencyKey, config.idempotencyTtlSeconds);
      if (idempotent.reused) {
        if (principal) {
          await repo.savePackForUser(principal.userId, idempotent.packId);
        }
        items.push({
          index,
          title_or_url: topic,
          status: 'reused',
          pack_id: idempotent.packId,
          job_id: idempotent.jobId
        });
        continue;
      }

      await repo.createPendingPack(idempotent.packId, topic);
      if (principal) {
        await repo.savePackForUser(principal.userId, idempotent.packId);
      }
      await repo.upsertJob(makeJob(idempotent.jobId, idempotent.packId, sessionId));
      queuedForecast += 1;
      sessionInflightForecast += 1;
      items.push({
        index,
        title_or_url: topic,
        status: 'accepted',
        pack_id: idempotent.packId,
        job_id: idempotent.jobId
      });
    }

    const capacityAfter = await getQueueCapacitySnapshot(sessionId);
    if (items.some((item) => item.status === 'accepted')) {
      void processOneQueuedJob();
    }

    const summary = {
      requested: parsed.data.topics.length,
      accepted: items.filter((item) => item.status === 'accepted').length,
      reused: items.filter((item) => item.status === 'reused').length,
      rejected: items.filter((item) => item.status === 'rejected').length,
      deferred: items.filter((item) => item.status === 'deferred').length
    };

    const payload = createBatchStudyPackResponseSchema.parse({
      batch_idempotency_key: parsed.data.idempotency_key,
      accepted_at: acceptedAt,
      summary,
      capacity_before: capacityBefore,
      capacity_after: capacityAfter,
      items
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
    res.status(200).json(await getQueueCapacitySnapshot(sessionId));
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

  app.get('/api/admin/cache', async (req: Request, res: Response) => {
    if (!requireAdminPrincipal(req, res, 'read_cache_admin')) {
      return;
    }
    const snapshot = await repo.getCacheAdminSnapshot();
    res.status(200).json(serializeCacheAdminSnapshot(snapshot));
  });

  app.post('/api/admin/cache/invalidate', async (req: Request, res: Response) => {
    if (!requireAdminPrincipal(req, res, 'invalidate_cache')) {
      return;
    }
    const parsed = cacheInvalidationRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_cache_invalidation_request', issues: parsed.error.flatten() });
      return;
    }

    const result = await repo.invalidateCache({
      target: parsed.data.target,
      dryRun: parsed.data.dry_run,
      cacheKey: parsed.data.cache_key,
      kind: parsed.data.kind,
      sourceRevisionId: parsed.data.source_revision_id,
      reason: parsed.data.reason
    });
    res.status(200).json(serializeCacheInvalidationResult(result));
  });

  app.get('/api/study-packs/:id/quiz-attempts', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }
    const pack = await repo.getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    await ensureUserProfile(principal);
    if (!(await ensureSavedPackPermission(req, res, principal, pack.id, 'read_quiz_attempts'))) {
      return;
    }

    const attempts = await repo.listQuizAttempts(principal.userId, pack.id, parseLimit(req.query.limit));
    res.status(200).json(quizAttemptListResponseSchema.parse({ items: attempts.map(serializeQuizAttempt) }));
  });

  app.get('/api/learning/analytics', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }

    await ensureUserProfile(principal);
    const analytics = await repo.getLearningAnalytics(principal.userId);
    res.status(200).json(serializeLearningAnalytics(analytics));
  });

  app.get('/api/learning/reminders', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }

    await ensureUserProfile(principal);
    const analytics = await repo.getLearningAnalytics(principal.userId);
    res.status(200).json(serializeLearningReminder(analytics));
  });

  app.get('/api/learning/goal', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }

    await ensureUserProfile(principal);
    const [goal, analytics] = await Promise.all([
      repo.getStudyGoal(principal.userId),
      repo.getLearningAnalytics(principal.userId)
    ]);
    res.status(200).json(serializeStudyGoal(principal.userId, goal, analytics));
  });

  app.put('/api/learning/goal', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }

    const parsed = upsertStudyGoalRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    await ensureUserProfile(principal);
    const goal = await repo.upsertStudyGoal(principal.userId, parsed.data.daily_target_reviews);
    const analytics = await repo.getLearningAnalytics(principal.userId);
    res.status(200).json(serializeStudyGoal(principal.userId, goal, analytics));
  });

  app.post('/api/quiz-attempts', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }
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

    await ensureUserProfile(principal);
    if (!(await ensureSavedPackPermission(req, res, principal, pack.id, 'submit_quiz_attempt'))) {
      return;
    }
    const progress = await repo.getLearningProgress(principal.userId, pack.id);
    const savedAttempt = await repo.saveQuizAttempt(
      principal.userId,
      parsed.data.pack_id,
      parsed.data.selected_indices,
      progress?.masteryScore ?? 0
    );
    if (!savedAttempt) {
      res.status(409).json({ error: 'quiz_not_ready' });
      return;
    }

    res.status(200).json(serializeQuizAttempt(savedAttempt));
  });

  app.post('/api/study-packs/:id/save', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }

    const pack = await repo.getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    await ensureUserProfile(principal);
    await repo.savePackForUser(principal.userId, pack.id);
    res.status(200).json({ pack_id: pack.id, saved: true, saved_at: new Date().toISOString() });
  });

  app.post('/api/study-packs/:id/feedback', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }
    const parsed = generationFeedbackRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const pack = await repo.getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    await ensureUserProfile(principal);
    if (!(await ensureSavedPackPermission(req, res, principal, pack.id, 'submit_generation_feedback'))) {
      return;
    }

    const feedback = await repo.recordGenerationFeedback({
      userId: principal.userId,
      packId: pack.id,
      artifactType: parsed.data.artifact_type,
      artifactId: parsed.data.artifact_id,
      rating: parsed.data.rating,
      signal: parsed.data.signal,
      comment: parsed.data.comment,
      promptVersion: parsed.data.prompt_version,
      model: parsed.data.model
    });
    if (!feedback) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    res.status(201).json(serializeGenerationFeedback(feedback));
  });

  app.post('/api/study-packs/:id/share', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
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

    await ensureUserProfile(principal);
    if (!(await ensureSavedPackPermission(req, res, principal, pack.id, 'share_pack'))) {
      return;
    }
    const shareId = randomUUID();
    const share = await repo.createShareLink(principal.userId, pack.id, parsed.data.role, {
      shareId,
      tokenHash: createShareTokenHash(shareId, config.shareTokenSecret),
      tokenVersion: activeShareTokenVersion,
      expiresAt: expiresAtFromTtl(config.shareLinkTtlSeconds)
    });
    if (!share) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }
    const serializedShare = serializeShareLink(share);
    auditSecurity('info', req, 'share.created', {
      userId: principal.userId,
      source: principal.source,
      packId: pack.id,
      shareId: share.shareId,
      role: parsed.data.role
    });

    const payload = createShareLinkResponseSchema.parse({
      share: serializedShare,
      share_path: `/api/shared/${serializedShare.share_id}`
    });
    res.status(201).json(payload);
  });

  app.get('/api/study-packs/:id/shares', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }

    const pack = await repo.getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    await ensureUserProfile(principal);
    if (!(await ensureSavedPackPermission(req, res, principal, pack.id, 'manage_shares'))) {
      return;
    }

    const shares = await repo.listShareLinksForOwner(principal.userId, pack.id, parseLimit(req.query.limit));
    const payload = listShareLinksResponseSchema.parse({
      items: shares.map(serializeShareManagementItem)
    });
    res.status(200).json(payload);
  });

  app.delete('/api/study-packs/:id/shares/:shareId', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }

    const pack = await repo.getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    await ensureUserProfile(principal);
    if (!(await ensureSavedPackPermission(req, res, principal, pack.id, 'manage_shares'))) {
      return;
    }

    const lookup = parseShareToken(req.params.shareId);
    if (!lookup) {
      res.status(404).json({ error: 'share_not_found' });
      return;
    }

    const revoked = await repo.revokeShareLink(principal.userId, pack.id, lookup.shareId, lookup.tokenHash);
    if (!revoked) {
      res.status(404).json({ error: 'share_not_found' });
      return;
    }
    const publicToken = publicShareToken(revoked.shareId, revoked.tokenVersion, config.shareTokenSecret);

    auditSecurity('info', req, 'share.revoked', {
      userId: principal.userId,
      source: principal.source,
      packId: pack.id,
      shareId: revoked.shareId,
      role: revoked.role
    });
    const payload = revokeShareLinkResponseSchema.parse({
      share_id: publicToken,
      revoked: true,
      revoked_at: revoked.revokedAt
    });
    res.status(200).json(payload);
  });

  app.get('/api/study-packs/:id/progress', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }
    const pack = await repo.getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    await ensureUserProfile(principal);
    if (!(await ensureSavedPackPermission(req, res, principal, pack.id, 'read_learning_progress'))) {
      return;
    }
    const progress = await repo.getLearningProgress(principal.userId, pack.id);
    if (!progress) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }
    res.status(200).json(serializeLearningProgress(progress));
  });

  app.get('/api/study-packs/:id/learning-session', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }
    const pack = await repo.getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    await ensureUserProfile(principal);
    if (!(await ensureSavedPackPermission(req, res, principal, pack.id, 'learning_session'))) {
      return;
    }
    const progress = await repo.getLearningProgress(principal.userId, pack.id);
    if (!progress) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id : undefined;
    if (sessionId) {
      const persisted = await repo.getLearningSession(principal.userId, pack.id, sessionId);
      if (!persisted) {
        res.status(404).json({ error: 'learning_session_not_found' });
        return;
      }
      res.status(200).json(await persistedLearningSessionResponse(pack, progress, persisted));
      return;
    }

    res.status(200).json(
      serializeLearningSession(pack, progress, {
        dueCards: parseOptionalNonNegativeInt(req.query.baseline_due_cards),
        masteryScore: parseOptionalUnitNumber(req.query.baseline_mastery_score)
      }).payload
    );
  });

  app.post('/api/study-packs/:id/learning-session', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
      return;
    }
    const parsed = learningSessionStartRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const pack = await repo.getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    await ensureUserProfile(principal);
    if (!(await ensureSavedPackPermission(req, res, principal, pack.id, 'learning_session'))) {
      return;
    }
    const progress = await repo.getLearningProgress(principal.userId, pack.id);
    if (!progress) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    const baseline = {
      dueCards: parsed.data.baseline_due_cards ?? progress.dueCards,
      masteryScore: parsed.data.baseline_mastery_score ?? progress.masteryScore
    };
    const initial = serializeLearningSession(pack, progress, baseline);
    const persisted = await repo.createLearningSession(
      principal.userId,
      pack.id,
      initial.session.metrics.sessionTotal,
      baseline.masteryScore,
      learningSessionProgressInput(initial.session)
    );
    if (!persisted) {
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    res.status(201).json(serializeLearningSession(pack, progress, persistedLearningSessionBaseline(persisted), persisted).payload);
  });

  app.post('/api/study-packs/:id/flashcards/:cardIndex/reviews', async (req: Request, res: Response) => {
    const principal = requirePrincipal(req, res);
    if (!principal) {
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

    await ensureUserProfile(principal);
    if (!(await ensureSavedPackPermission(req, res, principal, pack.id, 'review_flashcard'))) {
      return;
    }
    const review = await repo.recordFlashcardReview(principal.userId, pack.id, cardIndex, parsed.data.rating);
    const progress = await repo.getLearningProgress(principal.userId, pack.id);
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

  app.post('/api/study-packs/:id/resume', generationRateLimit, async (req: Request, res: Response) => {
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
    const principal = resolvePrincipal(req);
    if (principal?.source === 'legacy_header') {
      auditSecurity('info', req, 'auth.legacy_header_used', {
        userId: principal.userId,
        source: principal.source
      });
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

    const jobId = randomUUID();
    await repo.upsertJob(makeJob(jobId, pack.id, sessionId));
    if (principal) {
      await ensureUserProfile(principal);
      await repo.savePackForUser(principal.userId, pack.id);
    }
    void processOneQueuedJob();

    const payload = createStudyPackResponseSchema.parse({
      pack_id: pack.id,
      job_id: jobId,
      accepted_at: new Date().toISOString()
    });
    res.status(202).json(payload);
  });

  app.get('/api/analytics/outcomes', analyticsRateLimit, async (req: Request, res: Response) => {
    const windowHours = parseWindowHours(req.query.window_hours);
    const snapshot = await repo.getOutcomesSnapshot(windowHours);
    const payload = outcomesAnalyticsSchema.parse({
      generated_at: new Date().toISOString(),
      window_hours: windowHours,
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
        retakes: snapshot.learning.retakes,
        avg_accuracy: snapshot.learning.avgAccuracy,
        avg_mastery_score: snapshot.learning.avgMasteryScore,
        avg_mastery_delta: snapshot.learning.avgMasteryDelta
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
      },
      security: serializeSecurityAnalytics()
    });

    res.status(200).json(payload);
  });

  app.get('/api/analytics/costs', analyticsRateLimit, async (req: Request, res: Response) => {
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
          })),
          errors_by_type: llm.errorsByType.map((entry) => ({
            provider: entry.provider,
            model: entry.model,
            stage: entry.stage,
            error_type: entry.errorType,
            events: entry.events
          }))
        };
      })()
    });

    if (wantsCsv(req.query.format)) {
      sendCsv(res, `ops-cost-summary-${windowHours}h.csv`, formatCostSummaryCsv(payload));
      return;
    }

    res.status(200).json(payload);
  });

  app.get('/api/runtime/llm/health', async (_req: Request, res: Response) => {
    const llm = llmTelemetry.getSnapshot();
    const health = buildLocalLlmRuntimeHealth({
      provider: config.llmProvider,
      model: config.llmModel,
      baseUrl: config.llmBaseUrl,
      runtimePreset: config.runtimePreset,
      quantization: config.llmQuantization,
      contextWindow: config.llmContextWindow,
      chunkSize: config.llmChunkSize,
      concurrency: config.llmConcurrency,
      timeoutMs: config.llmTimeoutMs,
      calls: {
        attempted: llm.calls.attempted,
        succeeded: llm.calls.succeeded,
        fallback: llm.calls.fallback,
        timeouts: llm.calls.timeouts,
        timeoutRate: llm.calls.timeoutRate
      },
      byStageModel: llm.byStageModel
    });
    const payload = localLlmRuntimeHealthSchema.parse({
      generated_at: health.generatedAt,
      provider: health.provider,
      model: health.model,
      base_url: health.baseUrl,
      runtime_preset: health.runtimePreset,
      quantization: health.quantization,
      context_window: health.contextWindow,
      chunk_size: health.chunkSize,
      concurrency: health.concurrency,
      timeout_ms: health.timeoutMs,
      status: health.status,
      fallback_mode: health.fallbackMode,
      timeout_status: health.timeoutStatus,
      calls: {
        attempted: health.calls.attempted,
        succeeded: health.calls.succeeded,
        fallback: health.calls.fallback,
        timeouts: health.calls.timeouts,
        timeout_rate: health.calls.timeoutRate
      },
      latency: {
        avg_ms: health.latency.avgMs,
        p95_ms: health.latency.p95Ms
      },
      stages: health.stages.map((stage) => ({
        provider: stage.provider,
        model: stage.model,
        stage: stage.stage,
        attempted: stage.attempted,
        succeeded: stage.succeeded,
        fallback: stage.fallback,
        avg_latency_ms: stage.avgLatencyMs,
        p95_latency_ms: stage.p95LatencyMs
      }))
    });

    res.status(200).json(payload);
  });

  app.get('/api/runtime/llm/presets', async (_req: Request, res: Response) => {
    const visibility = buildRuntimePresetVisibility({
      currentPresetId: config.runtimePreset,
      provider: config.llmProvider,
      model: config.llmModel,
      quantization: config.llmQuantization,
      contextWindow: config.llmContextWindow,
      chunkSize: config.llmChunkSize,
      concurrency: config.llmConcurrency,
      timeoutMs: config.llmTimeoutMs
    });
    const payload = runtimePresetVisibilitySchema.parse({
      generated_at: new Date().toISOString(),
      provider: visibility.provider,
      model: visibility.model,
      default_preset_id: visibility.defaultPresetId,
      current_preset_id: visibility.currentPresetId,
      fallback_mode: visibility.fallbackMode,
      current_config: {
        quantization: visibility.quantization,
        context_window: visibility.contextWindow,
        chunk_size: visibility.chunkSize,
        concurrency: visibility.concurrency,
        timeout_ms: visibility.timeoutMs
      },
      presets: visibility.presets.map((preset) => ({
        id: preset.id,
        model: preset.model,
        hardware: preset.hardware,
        quantization: preset.quantization,
        context_window: preset.contextWindow,
        chunk_size: preset.chunkSize,
        concurrency: preset.concurrency,
        validated: preset.validated,
        selected: preset.selected,
        default: preset.default
      }))
    });

    res.status(200).json(payload);
  });

  app.get('/api/runtime/llm/smoke', async (req: Request, res: Response) => {
    res.status(200).json(serializeRealModelSmokeStatus(req, realModelSmokeController.getStatus()));
  });

  app.post('/api/runtime/llm/smoke', async (req: Request, res: Response) => {
    const control = realModelSmokeControlState(req);
    if (!control.enabled) {
      res.status(403).json(serializeRealModelSmokeStatus(req, realModelSmokeController.getStatus()));
      return;
    }

    const parsed = realModelSmokeTriggerRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'real_model_smoke_confirmation_required',
        expected_confirm: realModelSmokeConfirmation,
        status: serializeRealModelSmokeStatus(req, realModelSmokeController.getStatus())
      });
      return;
    }

    try {
      const status = realModelSmokeController.trigger();
      res.status(202).json(serializeRealModelSmokeStatus(req, status));
    } catch (error) {
      if (error instanceof RealModelSmokeAlreadyRunningError) {
        res.status(409).json(serializeRealModelSmokeStatus(req, realModelSmokeController.getStatus()));
        return;
      }
      throw error;
    }
  });

  app.get('/api/evaluation/prompts', async (_req: Request, res: Response) => {
    const [snapshot, feedbackSummary] = await Promise.all([
      buildPromptEvaluationSnapshot({
      model: 'local-rule-based'
      }),
      repo.getGenerationFeedbackSummary()
    ]);
    res.status(200).json(serializePromptEvaluationSnapshot(snapshot, feedbackSummary));
  });

  app.get('/api/analytics/costs/drilldown', analyticsRateLimit, async (req: Request, res: Response) => {
    const rawStage = getTrimmedStringQuery(req.query.stage);
    const stage = parseCostStageQuery(req.query.stage);
    if (rawStage && !stage) {
      res.status(400).json({ error: 'invalid_stage', allowed: costStageValues });
      return;
    }

    const windowHours = parseWindowHours(req.query.window_hours);
    const filters = {
      packId: getTrimmedStringQuery(req.query.pack_id),
      promptVersion: getTrimmedStringQuery(req.query.prompt_version),
      model: getTrimmedStringQuery(req.query.model),
      stage,
      limit: parseLimit(req.query.limit, 50)
    };
    const snapshot = await repo.getCostDrilldownSnapshot(windowHours, filters);
    const payload = costDrilldownAnalyticsSchema.parse({
      generated_at: new Date().toISOString(),
      window_hours: snapshot.windowHours,
      limit: snapshot.filters.limit,
      filters: {
        pack_id: snapshot.filters.packId ?? null,
        prompt_version: snapshot.filters.promptVersion ?? null,
        model: snapshot.filters.model ?? null,
        stage: snapshot.filters.stage ?? null
      },
      totals: {
        events: snapshot.totalEvents,
        estimated_tokens: snapshot.totalEstimatedTokens,
        total_estimated_usd: snapshot.totalEstimatedUsd,
        avg_estimated_usd: snapshot.avgEstimatedUsd,
        avg_latency_ms: snapshot.avgLatencyMs,
        distinct_packs: snapshot.distinctPacks
      },
      rows: snapshot.rows.map((entry) => ({
        pack_id: entry.packId,
        prompt_version: entry.promptVersion,
        model: entry.model,
        stage: entry.stage,
        events: entry.events,
        estimated_tokens: entry.estimatedTokens,
        avg_tokens: entry.avgTokens,
        avg_latency_ms: entry.avgLatencyMs,
        total_estimated_usd: entry.totalEstimatedUsd,
        avg_estimated_usd: entry.avgEstimatedUsd,
        first_recorded_at: entry.firstRecordedAt,
        last_recorded_at: entry.lastRecordedAt
      }))
    });

    if (wantsCsv(req.query.format)) {
      sendCsv(res, `ops-cost-drilldown-${windowHours}h.csv`, formatCostDrilldownCsv(payload));
      return;
    }

    res.status(200).json(payload);
  });

  app.get('/api/analytics/slo', analyticsRateLimit, async (req: Request, res: Response) => {
    const windowHours = parseWindowHours(req.query.window_hours);
    const snapshot = await repo.getOutcomesSnapshot(windowHours);
    const current = {
      p95_time_to_first_artifact_ms: snapshot.slo.p95TimeToFirstArtifactMs,
      p95_full_pack_completion_ms: snapshot.slo.p95FullPackCompletionMs,
      job_success_rate: snapshot.slo.jobSuccessRate,
      citation_coverage_rate: snapshot.slo.citationCoverageRate
    };
    const payload = sloAnalyticsSchema.parse({
      generated_at: new Date().toISOString(),
      window_hours: windowHours,
      targets: sloTargets,
      current,
      statuses: buildSloStatuses(current)
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
    const clientKey = clientRateLimitKey(req);
    const readDecision = shareReadRateLimiter.check(clientKey);
    if (!readDecision.allowed) {
      rejectRouteRateLimit(req, res, readDecision, 'share_read', 'share_read_ip');
      return;
    }

    const rawShareToken = req.params.shareId;
    const tokenFingerprint = stableFingerprint(rawShareToken);
    const lookup = parseShareToken(rawShareToken);
    const share = lookup ? await repo.getShareLink(lookup.shareId, lookup.tokenHash) : undefined;
    if (!share) {
      auditSecurity('warn', req, 'share.read_failed', {
        ...(lookup ? { shareId: lookup.shareId } : {}),
        tokenFingerprint,
        reason: lookup ? 'share_not_found_or_inactive' : 'malformed_share_token'
      });
      const failureDecision = shareReadFailureRateLimiter.check(clientKey);
      if (!failureDecision.allowed) {
        rejectRouteRateLimit(req, res, failureDecision, 'share_read', 'share_read_failed_ip');
        return;
      }
      res.status(404).json({ error: 'share_not_found' });
      return;
    }
    const pack = await repo.getPack(share.packId);
    if (!pack) {
      auditSecurity('warn', req, 'share.read_failed', {
        shareId: share.shareId,
        packId: share.packId,
        tokenFingerprint,
        reason: 'pack_not_found'
      });
      const failureDecision = shareReadFailureRateLimiter.check(clientKey);
      if (!failureDecision.allowed) {
        rejectRouteRateLimit(req, res, failureDecision, 'share_read', 'share_read_failed_ip');
        return;
      }
      res.status(404).json({ error: 'pack_not_found' });
      return;
    }

    auditSecurity('info', req, 'share.read', {
      shareId: share.shareId,
      packId: share.packId,
      role: share.role
    });
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

    const principal = resolvePrincipal(req);
    if (principal?.source === 'legacy_header') {
      auditSecurity('info', req, 'auth.legacy_header_used', {
        userId: principal.userId,
        source: principal.source
      });
    }
    const progress =
      principal && (await repo.isPackSavedForUser(principal.userId, pack.id))
        ? await repo.getLearningProgress(principal.userId, pack.id)
        : undefined;

    const payload = await buildStudyPackPayload(pack);
    const exported = formatStudyPackExport(payload, format, {
      progress: progress ? serializeLearningProgress(progress) : undefined
    });
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
