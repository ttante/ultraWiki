import type { SecurityMetricsSnapshot } from '../domain/security.js';
import type { LlmMetricsSnapshot } from './llm.js';

type CompletionSample = {
  durationMs: number;
  citationRate: number;
  flashcards: number;
  quizQuestions: number;
};

export type MaintenanceMetricsSnapshot = {
  lastRunAt: string | null;
  durationMs: number;
  outcomesPruned: number;
  quizAttemptsPruned: number;
  rollupsRefreshed: number;
};

export type OutcomesSnapshot = {
  generatedAt: string;
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
    byStage: Array<{
      stage: 'ingestion' | 'summarization' | 'knowledge_structure' | 'glossary' | 'active_recall';
      events: number;
      avgTokens: number;
      avgLatencyMs: number;
      totalEstimatedUsd: number;
      avgEstimatedUsd: number;
    }>;
  };
};

export type PersistedOutcomesSnapshot = Omit<OutcomesSnapshot, 'generatedAt'>;

type QuizAttemptSample = {
  accuracy: number;
  retake?: boolean;
  masteryScore?: number;
  masteryDelta?: number;
};

export type OperationalPrometheusSnapshot = {
  queue: {
    queued: number;
    running: number;
    maxQueueDepth: number;
    globalConcurrencyLimit: number;
  };
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

const escapeLabelValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

const average = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, n) => acc + n, 0) / values.length;
};

export class OutcomesTelemetry {
  private completed = 0;
  private failed = 0;
  private completions: CompletionSample[] = [];
  private quizAttempts: QuizAttemptSample[] = [];

  reset(): void {
    this.completed = 0;
    this.failed = 0;
    this.completions = [];
    this.quizAttempts = [];
  }

  recordCompletion(sample: CompletionSample): void {
    this.completed += 1;
    this.completions.push(sample);
  }

  recordFailure(): void {
    this.failed += 1;
  }

  recordQuizAttempt(sample: number | QuizAttemptSample): void {
    this.quizAttempts.push(typeof sample === 'number' ? { accuracy: sample } : sample);
  }

  getSnapshot(now = Date.now()): OutcomesSnapshot {
    const durations = this.completions.map((c) => c.durationMs);
    const citationRates = this.completions.map((c) => c.citationRate);
    const flashcards = this.completions.map((c) => c.flashcards);
    const quizQuestions = this.completions.map((c) => c.quizQuestions);
    const total = this.completed + this.failed;
    const completionRate = total === 0 ? 0 : this.completed / total;

    return {
      generatedAt: new Date(now).toISOString(),
      jobs: {
        completed: this.completed,
        failed: this.failed,
        avgDurationMs: average(durations),
        completionRate
      },
      quality: {
        avgCitationRate: average(citationRates),
        avgFlashcards: average(flashcards),
        avgQuizQuestions: average(quizQuestions)
      },
      learning: {
        attempts: this.quizAttempts.length,
        retakes: this.quizAttempts.filter((attempt) => attempt.retake).length,
        avgAccuracy: average(this.quizAttempts.map((attempt) => attempt.accuracy)),
        avgMasteryScore: average(this.quizAttempts.map((attempt) => attempt.masteryScore ?? attempt.accuracy)),
        avgMasteryDelta: average(this.quizAttempts.map((attempt) => attempt.masteryDelta ?? 0))
      },
      slo: {
        p95TimeToFirstArtifactMs: 0,
        p95FullPackCompletionMs: 0,
        jobSuccessRate: completionRate,
        citationCoverageRate: average(citationRates)
      },
      cost: {
        totalEstimatedUsd: 0,
        avgEstimatedUsdPerPack: 0,
        byStage: []
      }
    };
  }

  toPrometheus(now = Date.now()): string {
    const snapshot = this.getSnapshot(now);
    return formatOutcomesPrometheus(snapshot);
  }
}

export const formatOutcomesPrometheus = (
  snapshot: OutcomesSnapshot,
  maintenance?: MaintenanceMetricsSnapshot,
  operational?: OperationalPrometheusSnapshot,
  security?: SecurityMetricsSnapshot,
  llm?: LlmMetricsSnapshot
): string => {
  const lines = [
      '# HELP ultrawiki_jobs_completed_total Total completed study-pack jobs',
      '# TYPE ultrawiki_jobs_completed_total counter',
      `ultrawiki_jobs_completed_total ${snapshot.jobs.completed}`,
      '# HELP ultrawiki_jobs_failed_total Total failed study-pack jobs',
      '# TYPE ultrawiki_jobs_failed_total counter',
      `ultrawiki_jobs_failed_total ${snapshot.jobs.failed}`,
      '# HELP ultrawiki_job_duration_avg_ms Average completed job duration in milliseconds',
      '# TYPE ultrawiki_job_duration_avg_ms gauge',
      `ultrawiki_job_duration_avg_ms ${snapshot.jobs.avgDurationMs.toFixed(3)}`,
      '# HELP ultrawiki_job_completion_rate Completed / total jobs',
      '# TYPE ultrawiki_job_completion_rate gauge',
      `ultrawiki_job_completion_rate ${snapshot.jobs.completionRate.toFixed(6)}`,
      '# HELP ultrawiki_summary_citation_rate_avg Average citation rate for summary outputs',
      '# TYPE ultrawiki_summary_citation_rate_avg gauge',
      `ultrawiki_summary_citation_rate_avg ${snapshot.quality.avgCitationRate.toFixed(6)}`,
      '# HELP ultrawiki_flashcards_avg Average flashcards generated per completed job',
      '# TYPE ultrawiki_flashcards_avg gauge',
      `ultrawiki_flashcards_avg ${snapshot.quality.avgFlashcards.toFixed(3)}`,
      '# HELP ultrawiki_quiz_questions_avg Average quiz questions generated per completed job',
      '# TYPE ultrawiki_quiz_questions_avg gauge',
      `ultrawiki_quiz_questions_avg ${snapshot.quality.avgQuizQuestions.toFixed(3)}`,
      '# HELP ultrawiki_quiz_attempts_total Total quiz attempts submitted',
      '# TYPE ultrawiki_quiz_attempts_total counter',
      `ultrawiki_quiz_attempts_total ${snapshot.learning.attempts}`,
      '# HELP ultrawiki_quiz_retakes_total Total quiz retake attempts submitted',
      '# TYPE ultrawiki_quiz_retakes_total counter',
      `ultrawiki_quiz_retakes_total ${snapshot.learning.retakes}`,
      '# HELP ultrawiki_quiz_accuracy_avg Average quiz attempt accuracy',
      '# TYPE ultrawiki_quiz_accuracy_avg gauge',
      `ultrawiki_quiz_accuracy_avg ${snapshot.learning.avgAccuracy.toFixed(6)}`,
      '# HELP ultrawiki_mastery_score_avg Average combined quiz and card mastery score',
      '# TYPE ultrawiki_mastery_score_avg gauge',
      `ultrawiki_mastery_score_avg ${snapshot.learning.avgMasteryScore.toFixed(6)}`,
      '# HELP ultrawiki_mastery_delta_avg Average mastery delta across quiz attempts and card reviews',
      '# TYPE ultrawiki_mastery_delta_avg gauge',
      `ultrawiki_mastery_delta_avg ${snapshot.learning.avgMasteryDelta.toFixed(6)}`,
      '# HELP ultrawiki_slo_time_to_first_artifact_p95_ms P95 time to first artifact in milliseconds',
      '# TYPE ultrawiki_slo_time_to_first_artifact_p95_ms gauge',
      `ultrawiki_slo_time_to_first_artifact_p95_ms ${snapshot.slo.p95TimeToFirstArtifactMs.toFixed(3)}`,
      '# HELP ultrawiki_slo_full_pack_completion_p95_ms P95 full pack completion time in milliseconds',
      '# TYPE ultrawiki_slo_full_pack_completion_p95_ms gauge',
      `ultrawiki_slo_full_pack_completion_p95_ms ${snapshot.slo.p95FullPackCompletionMs.toFixed(3)}`,
      '# HELP ultrawiki_slo_job_success_rate Job success SLO signal (completed / total)',
      '# TYPE ultrawiki_slo_job_success_rate gauge',
      `ultrawiki_slo_job_success_rate ${snapshot.slo.jobSuccessRate.toFixed(6)}`,
      '# HELP ultrawiki_slo_citation_coverage_rate Citation coverage SLO signal',
      '# TYPE ultrawiki_slo_citation_coverage_rate gauge',
      `ultrawiki_slo_citation_coverage_rate ${snapshot.slo.citationCoverageRate.toFixed(6)}`,
      '# HELP ultrawiki_cost_estimated_total_usd Total estimated generation cost in USD',
      '# TYPE ultrawiki_cost_estimated_total_usd gauge',
      `ultrawiki_cost_estimated_total_usd ${snapshot.cost.totalEstimatedUsd.toFixed(6)}`,
      '# HELP ultrawiki_cost_estimated_avg_usd_per_pack Average estimated generation cost per pack in USD',
      '# TYPE ultrawiki_cost_estimated_avg_usd_per_pack gauge',
      `ultrawiki_cost_estimated_avg_usd_per_pack ${snapshot.cost.avgEstimatedUsdPerPack.toFixed(6)}`
    ];

  if (snapshot.cost.byStage.length > 0) {
    lines.push(
      '# HELP ultrawiki_stage_cost_events_total Number of stage cost telemetry events by stage',
      '# TYPE ultrawiki_stage_cost_events_total gauge',
      '# HELP ultrawiki_stage_tokens_estimated_avg Average estimated token usage by stage',
      '# TYPE ultrawiki_stage_tokens_estimated_avg gauge',
      '# HELP ultrawiki_stage_latency_avg_ms Average stage latency in milliseconds',
      '# TYPE ultrawiki_stage_latency_avg_ms gauge',
      '# HELP ultrawiki_stage_cost_estimated_total_usd Total estimated stage cost in USD',
      '# TYPE ultrawiki_stage_cost_estimated_total_usd gauge',
      '# HELP ultrawiki_stage_cost_estimated_avg_usd Average estimated stage cost in USD per event',
      '# TYPE ultrawiki_stage_cost_estimated_avg_usd gauge'
    );
  }

  for (const entry of snapshot.cost.byStage) {
    lines.push(
      `ultrawiki_stage_cost_events_total{stage="${entry.stage}"} ${entry.events}`,
      `ultrawiki_stage_tokens_estimated_avg{stage="${entry.stage}"} ${entry.avgTokens.toFixed(3)}`,
      `ultrawiki_stage_latency_avg_ms{stage="${entry.stage}"} ${entry.avgLatencyMs.toFixed(3)}`,
      `ultrawiki_stage_cost_estimated_total_usd{stage="${entry.stage}"} ${entry.totalEstimatedUsd.toFixed(6)}`,
      `ultrawiki_stage_cost_estimated_avg_usd{stage="${entry.stage}"} ${entry.avgEstimatedUsd.toFixed(6)}`
    );
  }

  if (operational) {
    lines.push(
      '# HELP ultrawiki_queue_depth Current queued generation jobs',
      '# TYPE ultrawiki_queue_depth gauge',
      `ultrawiki_queue_depth ${operational.queue.queued}`,
      '# HELP ultrawiki_queue_running_jobs Current running generation jobs',
      '# TYPE ultrawiki_queue_running_jobs gauge',
      `ultrawiki_queue_running_jobs ${operational.queue.running}`,
      '# HELP ultrawiki_queue_max_depth Configured maximum queue depth',
      '# TYPE ultrawiki_queue_max_depth gauge',
      `ultrawiki_queue_max_depth ${operational.queue.maxQueueDepth}`,
      '# HELP ultrawiki_queue_global_concurrency_limit Configured global generation concurrency limit',
      '# TYPE ultrawiki_queue_global_concurrency_limit gauge',
      `ultrawiki_queue_global_concurrency_limit ${operational.queue.globalConcurrencyLimit}`,
      '# HELP ultrawiki_degraded_jobs_total Completed jobs that returned partial output',
      '# TYPE ultrawiki_degraded_jobs_total gauge',
      `ultrawiki_degraded_jobs_total ${operational.degradation.partialJobs}`,
      '# HELP ultrawiki_degraded_job_rate Partial completed jobs divided by completed jobs',
      '# TYPE ultrawiki_degraded_job_rate gauge',
      `ultrawiki_degraded_job_rate ${operational.degradation.partialRate.toFixed(6)}`,
      '# HELP ultrawiki_cache_events_total Cache provenance events recorded for packs',
      '# TYPE ultrawiki_cache_events_total gauge',
      `ultrawiki_cache_events_total ${operational.cache.events}`,
      '# HELP ultrawiki_cache_hits_total Cache provenance events that were hits',
      '# TYPE ultrawiki_cache_hits_total gauge',
      `ultrawiki_cache_hits_total ${operational.cache.hits}`,
      '# HELP ultrawiki_cache_misses_total Cache provenance events that were misses',
      '# TYPE ultrawiki_cache_misses_total gauge',
      `ultrawiki_cache_misses_total ${operational.cache.misses}`,
      '# HELP ultrawiki_cache_hit_rate Cache hits divided by cache events',
      '# TYPE ultrawiki_cache_hit_rate gauge',
      `ultrawiki_cache_hit_rate ${operational.cache.hitRate.toFixed(6)}`
    );
  }

  if (security) {
    lines.push(
      '# HELP ultrawiki_security_suspicious_inputs_total Source input events flagged by sanitizer',
      '# TYPE ultrawiki_security_suspicious_inputs_total counter',
      `ultrawiki_security_suspicious_inputs_total ${security.suspiciousInputsTotal}`,
      '# HELP ultrawiki_security_signature_alerts_total Repeated suspicious signatures that crossed alert threshold',
      '# TYPE ultrawiki_security_signature_alerts_total counter',
      `ultrawiki_security_signature_alerts_total ${security.signatureAlertsTotal}`,
      '# HELP ultrawiki_security_events_total Audited security events across auth, sharing, rate limits, and security controls',
      '# TYPE ultrawiki_security_events_total counter',
      `ultrawiki_security_events_total ${security.securityEventsTotal}`,
      '# HELP ultrawiki_rate_limit_events_total Audited rate-limit events across protected routes',
      '# TYPE ultrawiki_rate_limit_events_total counter',
      `ultrawiki_rate_limit_events_total ${security.rateLimitEventsTotal}`
    );

    if (security.eventCategories.length > 0) {
      lines.push(
        '# HELP ultrawiki_security_events_by_category_total Audited security events by category',
        '# TYPE ultrawiki_security_events_by_category_total counter'
      );
    }

    for (const entry of security.eventCategories) {
      lines.push(`ultrawiki_security_events_by_category_total{category="${entry.category}"} ${entry.count}`);
    }

    if (security.signatures.length > 0) {
      lines.push(
        '# HELP ultrawiki_security_suspicious_inputs_by_signature_total Suspicious source input events by signature',
        '# TYPE ultrawiki_security_suspicious_inputs_by_signature_total counter',
        '# HELP ultrawiki_security_signature_alerts_by_signature_total Signature threshold alerts by signature',
        '# TYPE ultrawiki_security_signature_alerts_by_signature_total counter'
      );
    }

    for (const entry of security.signatures) {
      const signature = escapeLabelValue(entry.signature);
      lines.push(
        `ultrawiki_security_suspicious_inputs_by_signature_total{signature="${signature}"} ${entry.suspiciousInputs}`,
        `ultrawiki_security_signature_alerts_by_signature_total{signature="${signature}"} ${entry.alerts}`
      );
    }

    if (security.rateLimitEvents.length > 0) {
      lines.push(
        '# HELP ultrawiki_rate_limit_events_by_type_total Audited rate-limit events by event type',
        '# TYPE ultrawiki_rate_limit_events_by_type_total counter'
      );
    }

    for (const entry of security.rateLimitEvents) {
      const eventType = escapeLabelValue(entry.eventType);
      lines.push(`ultrawiki_rate_limit_events_by_type_total{event_type="${eventType}"} ${entry.count}`);
    }

    if (security.events.length > 0) {
      lines.push(
        '# HELP ultrawiki_security_events_by_type_total Audited security events by event type',
        '# TYPE ultrawiki_security_events_by_type_total counter'
      );
    }

    for (const entry of security.events) {
      const eventType = escapeLabelValue(entry.eventType);
      lines.push(`ultrawiki_security_events_by_type_total{event_type="${eventType}"} ${entry.count}`);
    }
  }

  if (maintenance) {
    lines.push(
      '# HELP ultrawiki_outcomes_maintenance_duration_ms Duration of latest outcomes maintenance run in milliseconds',
      '# TYPE ultrawiki_outcomes_maintenance_duration_ms gauge',
      `ultrawiki_outcomes_maintenance_duration_ms ${maintenance.durationMs}`,
      '# HELP ultrawiki_outcomes_maintenance_pruned_generation_outcomes_total Rows pruned from generation_outcomes in latest maintenance run',
      '# TYPE ultrawiki_outcomes_maintenance_pruned_generation_outcomes_total gauge',
      `ultrawiki_outcomes_maintenance_pruned_generation_outcomes_total ${maintenance.outcomesPruned}`,
      '# HELP ultrawiki_outcomes_maintenance_pruned_quiz_attempts_total Rows pruned from quiz_attempts in latest maintenance run',
      '# TYPE ultrawiki_outcomes_maintenance_pruned_quiz_attempts_total gauge',
      `ultrawiki_outcomes_maintenance_pruned_quiz_attempts_total ${maintenance.quizAttemptsPruned}`,
      '# HELP ultrawiki_outcomes_maintenance_rollups_refreshed_total Daily rollup rows refreshed in latest maintenance run',
      '# TYPE ultrawiki_outcomes_maintenance_rollups_refreshed_total gauge',
      `ultrawiki_outcomes_maintenance_rollups_refreshed_total ${maintenance.rollupsRefreshed}`,
      '# HELP ultrawiki_outcomes_maintenance_last_run_timestamp_seconds Unix timestamp for latest successful maintenance run',
      '# TYPE ultrawiki_outcomes_maintenance_last_run_timestamp_seconds gauge',
      `ultrawiki_outcomes_maintenance_last_run_timestamp_seconds ${maintenance.lastRunAt ? Math.floor(Date.parse(maintenance.lastRunAt) / 1000) : 0}`
    );
  }

  if (llm) {
    lines.push(
      '# HELP ultrawiki_llm_model_calls_total OpenAI-compatible LLM calls attempted',
      '# TYPE ultrawiki_llm_model_calls_total counter',
      `ultrawiki_llm_model_calls_total ${llm.calls.attempted}`,
      '# HELP ultrawiki_llm_success_total LLM generations accepted without fallback',
      '# TYPE ultrawiki_llm_success_total counter',
      `ultrawiki_llm_success_total ${llm.calls.succeeded}`,
      '# HELP ultrawiki_llm_fallback_total LLM generations that used fallback artifacts',
      '# TYPE ultrawiki_llm_fallback_total counter',
      `ultrawiki_llm_fallback_total ${llm.calls.fallback}`,
      '# HELP ultrawiki_llm_invalid_json_total LLM generations rejected because response JSON was invalid for the schema',
      '# TYPE ultrawiki_llm_invalid_json_total counter',
      `ultrawiki_llm_invalid_json_total ${llm.calls.invalidResponses}`,
      '# HELP ultrawiki_llm_timeout_total LLM calls that timed out or were aborted',
      '# TYPE ultrawiki_llm_timeout_total counter',
      `ultrawiki_llm_timeout_total ${llm.calls.timeouts}`,
      '# HELP ultrawiki_llm_timeout_rate LLM timeouts divided by attempted LLM calls',
      '# TYPE ultrawiki_llm_timeout_rate gauge',
      `ultrawiki_llm_timeout_rate ${llm.calls.timeoutRate.toFixed(6)}`
    );

    if (llm.byStageModel.length > 0) {
      lines.push(
        '# HELP ultrawiki_llm_stage_model_calls_total LLM call attempts by provider, model, and stage',
        '# TYPE ultrawiki_llm_stage_model_calls_total counter',
        '# HELP ultrawiki_llm_stage_model_success_total Accepted LLM generations by provider, model, and stage',
        '# TYPE ultrawiki_llm_stage_model_success_total counter',
        '# HELP ultrawiki_llm_stage_model_fallback_total Fallback generations by provider, model, and stage',
        '# TYPE ultrawiki_llm_stage_model_fallback_total counter',
        '# HELP ultrawiki_llm_stage_latency_avg_ms Average LLM call latency by provider, model, and stage',
        '# TYPE ultrawiki_llm_stage_latency_avg_ms gauge',
        '# HELP ultrawiki_llm_stage_latency_p95_ms P95 LLM call latency by provider, model, and stage',
        '# TYPE ultrawiki_llm_stage_latency_p95_ms gauge'
      );
    }

    for (const entry of llm.byStageModel) {
      const provider = escapeLabelValue(entry.provider);
      const model = escapeLabelValue(entry.model);
      const stage = escapeLabelValue(entry.stage);
      const labels = `provider="${provider}",model="${model}",stage="${stage}"`;
      lines.push(
        `ultrawiki_llm_stage_model_calls_total{${labels}} ${entry.attempted}`,
        `ultrawiki_llm_stage_model_success_total{${labels}} ${entry.succeeded}`,
        `ultrawiki_llm_stage_model_fallback_total{${labels}} ${entry.fallback}`,
        `ultrawiki_llm_stage_latency_avg_ms{${labels}} ${entry.avgLatencyMs.toFixed(3)}`,
        `ultrawiki_llm_stage_latency_p95_ms{${labels}} ${entry.p95LatencyMs.toFixed(3)}`
      );
    }

    if (llm.fallbacksByReason.length > 0) {
      lines.push(
        '# HELP ultrawiki_llm_fallback_by_reason_total LLM fallback generations by provider, model, stage, and reason',
        '# TYPE ultrawiki_llm_fallback_by_reason_total counter'
      );
    }
    for (const entry of llm.fallbacksByReason) {
      lines.push(
        `ultrawiki_llm_fallback_by_reason_total{provider="${escapeLabelValue(entry.provider)}",model="${escapeLabelValue(entry.model)}",stage="${escapeLabelValue(entry.stage)}",reason="${escapeLabelValue(entry.reason)}"} ${entry.events}`
      );
    }

    if (llm.errorsByType.length > 0) {
      lines.push(
        '# HELP ultrawiki_llm_errors_by_type_total LLM generation errors by provider, model, stage, and error type',
        '# TYPE ultrawiki_llm_errors_by_type_total counter'
      );
    }
    for (const entry of llm.errorsByType) {
      lines.push(
        `ultrawiki_llm_errors_by_type_total{provider="${escapeLabelValue(entry.provider)}",model="${escapeLabelValue(entry.model)}",stage="${escapeLabelValue(entry.stage)}",error_type="${escapeLabelValue(entry.errorType)}"} ${entry.events}`
      );
    }
  }

  return `${lines.join('\n')}\n`;
};

export const outcomesTelemetry = new OutcomesTelemetry();
