import { describe, expect, it } from 'vitest';
import { OutcomesTelemetry, formatOutcomesPrometheus } from '../src/telemetry/outcomes.js';

describe('OutcomesTelemetry', () => {
  it('aggregates completion, failure, and learning metrics', () => {
    const telemetry = new OutcomesTelemetry();
    telemetry.recordCompletion({
      durationMs: 1200,
      citationRate: 1,
      flashcards: 15,
      quizQuestions: 10
    });
    telemetry.recordCompletion({
      durationMs: 800,
      citationRate: 0.5,
      flashcards: 20,
      quizQuestions: 12
    });
    telemetry.recordFailure();
    telemetry.recordQuizAttempt(0.6);
    telemetry.recordQuizAttempt(1);

    const snapshot = telemetry.getSnapshot(Date.parse('2026-01-01T00:00:00.000Z'));
    expect(snapshot.jobs.completed).toBe(2);
    expect(snapshot.jobs.failed).toBe(1);
    expect(snapshot.jobs.avgDurationMs).toBe(1000);
    expect(snapshot.jobs.completionRate).toBeCloseTo(2 / 3, 6);
    expect(snapshot.quality.avgCitationRate).toBe(0.75);
    expect(snapshot.quality.avgFlashcards).toBe(17.5);
    expect(snapshot.quality.avgQuizQuestions).toBe(11);
    expect(snapshot.learning.attempts).toBe(2);
    expect(snapshot.learning.avgAccuracy).toBe(0.8);
    expect(snapshot.slo.p95TimeToFirstArtifactMs).toBe(0);
    expect(snapshot.slo.p95FullPackCompletionMs).toBe(0);
    expect(snapshot.slo.jobSuccessRate).toBeCloseTo(2 / 3, 6);
    expect(snapshot.slo.citationCoverageRate).toBe(0.75);
    expect(snapshot.cost.totalEstimatedUsd).toBe(0);
    expect(snapshot.cost.byStage).toHaveLength(0);
  });

  it('emits prometheus output', () => {
    const telemetry = new OutcomesTelemetry();
    telemetry.recordCompletion({
      durationMs: 500,
      citationRate: 1,
      flashcards: 15,
      quizQuestions: 10
    });
    const metrics = telemetry.toPrometheus();
    expect(metrics).toContain('ultrawiki_jobs_completed_total 1');
    expect(metrics).toContain('ultrawiki_summary_citation_rate_avg');
    expect(metrics).toContain('ultrawiki_slo_time_to_first_artifact_p95_ms');
    expect(metrics).toContain('ultrawiki_slo_full_pack_completion_p95_ms');
    expect(metrics).toContain('ultrawiki_slo_job_success_rate');
    expect(metrics).toContain('ultrawiki_slo_citation_coverage_rate');
    expect(metrics).toContain('ultrawiki_cost_estimated_total_usd 0');
  });

  it('emits maintenance metrics when provided', () => {
    const metrics = formatOutcomesPrometheus(
      {
        generatedAt: '2026-01-01T00:00:00.000Z',
        jobs: { completed: 1, failed: 0, avgDurationMs: 1000, completionRate: 1 },
        quality: { avgCitationRate: 1, avgFlashcards: 15, avgQuizQuestions: 10 },
        learning: { attempts: 2, avgAccuracy: 0.8 },
        slo: {
          p95TimeToFirstArtifactMs: 18000,
          p95FullPackCompletionMs: 42000,
          jobSuccessRate: 1,
          citationCoverageRate: 1
        },
        cost: {
          totalEstimatedUsd: 0.05,
          avgEstimatedUsdPerPack: 0.05,
          byStage: [
            {
              stage: 'summarization',
              events: 1,
              avgTokens: 1800,
              avgLatencyMs: 2500,
              totalEstimatedUsd: 0.05,
              avgEstimatedUsd: 0.05
            }
          ]
        }
      },
      {
        lastRunAt: '2026-01-01T00:00:00.000Z',
        durationMs: 3210,
        outcomesPruned: 11,
        quizAttemptsPruned: 9,
        rollupsRefreshed: 8
      },
      {
        queue: {
          queued: 4,
          running: 2,
          maxQueueDepth: 100,
          globalConcurrencyLimit: 2
        },
        degradation: {
          completedJobs: 10,
          partialJobs: 2,
          partialRate: 0.2
        },
        cache: {
          events: 20,
          hits: 15,
          misses: 5,
          hitRate: 0.75
        }
      },
      {
        suspiciousInputsTotal: 3,
        signatureAlertsTotal: 1,
        signatures: [
          {
            signature: 'ignore_previous_instructions',
            suspiciousInputs: 3,
            alerts: 1
          }
        ]
      }
    );
    expect(metrics).toContain('ultrawiki_outcomes_maintenance_duration_ms 3210');
    expect(metrics).toContain('ultrawiki_outcomes_maintenance_pruned_generation_outcomes_total 11');
    expect(metrics).toContain('ultrawiki_outcomes_maintenance_pruned_quiz_attempts_total 9');
    expect(metrics).toContain('ultrawiki_outcomes_maintenance_rollups_refreshed_total 8');
    expect(metrics).toContain('ultrawiki_slo_time_to_first_artifact_p95_ms 18000.000');
    expect(metrics).toContain('ultrawiki_slo_full_pack_completion_p95_ms 42000.000');
    expect(metrics).toContain('ultrawiki_slo_job_success_rate 1.000000');
    expect(metrics).toContain('ultrawiki_slo_citation_coverage_rate 1.000000');
    expect(metrics).toContain('ultrawiki_cost_estimated_total_usd 0.050000');
    expect(metrics).toContain('ultrawiki_stage_cost_estimated_total_usd{stage="summarization"} 0.050000');
    expect(metrics).toContain('ultrawiki_queue_depth 4');
    expect(metrics).toContain('ultrawiki_queue_running_jobs 2');
    expect(metrics).toContain('ultrawiki_degraded_jobs_total 2');
    expect(metrics).toContain('ultrawiki_degraded_job_rate 0.200000');
    expect(metrics).toContain('ultrawiki_cache_hit_rate 0.750000');
    expect(metrics).toContain('ultrawiki_security_suspicious_inputs_total 3');
    expect(metrics).toContain('ultrawiki_security_signature_alerts_total 1');
    expect(metrics).toContain(
      'ultrawiki_security_suspicious_inputs_by_signature_total{signature="ignore_previous_instructions"} 3'
    );
  });

  it('emits LLM model observability metrics when provided', () => {
    const metrics = formatOutcomesPrometheus(
      {
        generatedAt: '2026-01-01T00:00:00.000Z',
        jobs: { completed: 0, failed: 0, avgDurationMs: 0, completionRate: 0 },
        quality: { avgCitationRate: 0, avgFlashcards: 0, avgQuizQuestions: 0 },
        learning: { attempts: 0, avgAccuracy: 0 },
        slo: {
          p95TimeToFirstArtifactMs: 0,
          p95FullPackCompletionMs: 0,
          jobSuccessRate: 0,
          citationCoverageRate: 0
        },
        cost: {
          totalEstimatedUsd: 0,
          avgEstimatedUsdPerPack: 0,
          byStage: []
        }
      },
      undefined,
      undefined,
      undefined,
      {
        calls: {
          attempted: 3,
          succeeded: 1,
          fallback: 2,
          invalidResponses: 1,
          timeouts: 1,
          timeoutRate: 1 / 3
        },
        byStageModel: [
          {
            provider: 'openai_compatible',
            model: 'qwen2.5-14b-instruct-q4_k_m',
            stage: 'summaries',
            attempted: 3,
            succeeded: 1,
            fallback: 2,
            avgLatencyMs: 250,
            p95LatencyMs: 400
          }
        ],
        fallbacksByReason: [
          {
            provider: 'openai_compatible',
            model: 'qwen2.5-14b-instruct-q4_k_m',
            stage: 'summaries',
            reason: 'invalid_response',
            events: 1
          }
        ],
        errorsByType: [
          {
            provider: 'openai_compatible',
            model: 'qwen2.5-14b-instruct-q4_k_m',
            stage: 'summaries',
            errorType: 'timeout',
            events: 1
          }
        ]
      }
    );

    expect(metrics).toContain('ultrawiki_llm_model_calls_total 3');
    expect(metrics).toContain('ultrawiki_llm_success_total 1');
    expect(metrics).toContain('ultrawiki_llm_fallback_total 2');
    expect(metrics).toContain('ultrawiki_llm_invalid_json_total 1');
    expect(metrics).toContain('ultrawiki_llm_timeout_total 1');
    expect(metrics).toContain('ultrawiki_llm_timeout_rate 0.333333');
    expect(metrics).toContain(
      'ultrawiki_llm_stage_model_calls_total{provider="openai_compatible",model="qwen2.5-14b-instruct-q4_k_m",stage="summaries"} 3'
    );
    expect(metrics).toContain(
      'ultrawiki_llm_stage_latency_p95_ms{provider="openai_compatible",model="qwen2.5-14b-instruct-q4_k_m",stage="summaries"} 400.000'
    );
    expect(metrics).toContain(
      'ultrawiki_llm_fallback_by_reason_total{provider="openai_compatible",model="qwen2.5-14b-instruct-q4_k_m",stage="summaries",reason="invalid_response"} 1'
    );
    expect(metrics).toContain(
      'ultrawiki_llm_errors_by_type_total{provider="openai_compatible",model="qwen2.5-14b-instruct-q4_k_m",stage="summaries",error_type="timeout"} 1'
    );
  });
});
