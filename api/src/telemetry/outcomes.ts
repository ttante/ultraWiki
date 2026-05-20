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
    byStage: Array<{
      stage: 'ingestion' | 'summarization' | 'active_recall' | 'knowledge_structure';
      events: number;
      avgTokens: number;
      avgLatencyMs: number;
      totalEstimatedUsd: number;
      avgEstimatedUsd: number;
    }>;
  };
};

export type PersistedOutcomesSnapshot = Omit<OutcomesSnapshot, 'generatedAt'>;

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
  private quizAccuracies: number[] = [];

  reset(): void {
    this.completed = 0;
    this.failed = 0;
    this.completions = [];
    this.quizAccuracies = [];
  }

  recordCompletion(sample: CompletionSample): void {
    this.completed += 1;
    this.completions.push(sample);
  }

  recordFailure(): void {
    this.failed += 1;
  }

  recordQuizAttempt(accuracy: number): void {
    this.quizAccuracies.push(accuracy);
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
        attempts: this.quizAccuracies.length,
        avgAccuracy: average(this.quizAccuracies)
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
  maintenance?: MaintenanceMetricsSnapshot
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
      '# HELP ultrawiki_quiz_accuracy_avg Average quiz attempt accuracy',
      '# TYPE ultrawiki_quiz_accuracy_avg gauge',
      `ultrawiki_quiz_accuracy_avg ${snapshot.learning.avgAccuracy.toFixed(6)}`,
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

  return `${lines.join('\n')}\n`;
};

export const outcomesTelemetry = new OutcomesTelemetry();
