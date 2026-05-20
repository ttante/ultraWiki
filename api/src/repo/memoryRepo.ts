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

type JobOutcomeRecord =
  | {
      status: 'completed';
      durationMs: number;
      citationRate: number;
      flashcards: number;
      quizQuestions: number;
    }
  | {
      status: 'failed';
    };

const average = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
};

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(p * sorted.length) - 1;
  const bounded = Math.min(sorted.length - 1, Math.max(0, index));
  return sorted[bounded];
};

export class MemoryRepo implements AppRepo {
  private idempotency = new Map<string, { packId: string; jobId: string; createdAt: number }>();
  private jobs = new Map<string, Job>();
  private packs = new Map<string, PackRecord>();
  private quizAttempts: QuizAttemptRecord[] = [];
  private outcomes = new Map<string, JobOutcomeRecord>();
  private stageCosts: StageCostSample[] = [];

  resetForTests(): void {
    this.idempotency.clear();
    this.jobs.clear();
    this.packs.clear();
    this.quizAttempts = [];
    this.outcomes.clear();
    this.stageCosts = [];
  }

  async createOrReuseByIdempotency(key: string, ttlSeconds: number): Promise<IdempotencyResult> {
    const now = Date.now();
    const existing = this.idempotency.get(key);
    if (existing && now - existing.createdAt < ttlSeconds * 1000) {
      return { packId: existing.packId, jobId: existing.jobId, reused: true };
    }

    const packId = randomUUID();
    const jobId = randomUUID();
    this.idempotency.set(key, { packId, jobId, createdAt: now });
    return { packId, jobId, reused: false };
  }

  async createPendingPack(packId: string, input: string): Promise<void> {
    this.packs.set(packId, {
      id: packId,
      input,
      sourceRevisionId: 'pending',
      sections: [],
      summaries: [],
      flashcards: [],
      quizQuestions: [],
      graphNodes: [],
      graphEdges: [],
      timelineEvents: []
    });
  }

  async upsertJob(job: Job): Promise<void> {
    this.jobs.set(job.id, { ...job });
  }

  async getJob(jobId: string): Promise<Job | undefined> {
    const job = this.jobs.get(jobId);
    return job ? { ...job, errors: [...job.errors] } : undefined;
  }

  async listJobs(): Promise<Job[]> {
    return Array.from(this.jobs.values()).map((job) => ({ ...job, errors: [...job.errors] }));
  }

  async claimNextQueuedJob(): Promise<Job | undefined> {
    const queued = Array.from(this.jobs.values())
      .filter((j) => j.status === 'queued')
      .sort((a, b) => a.heartbeatAt - b.heartbeatAt)[0];

    if (!queued) {
      return undefined;
    }

    queued.status = 'running';
    queued.attempt += 1;
    queued.retryState = 'none';
    queued.heartbeatAt = Date.now();
    this.jobs.set(queued.id, queued);
    return { ...queued, errors: [...queued.errors] };
  }

  async countQueuedJobs(): Promise<number> {
    return Array.from(this.jobs.values()).filter((j) => j.status === 'queued').length;
  }

  async countRunningJobs(): Promise<number> {
    return Array.from(this.jobs.values()).filter((j) => j.status === 'running').length;
  }

  async countInflightJobsForSession(sessionId: string): Promise<number> {
    return Array.from(this.jobs.values()).filter(
      (j) => j.sessionId === sessionId && (j.status === 'queued' || j.status === 'running')
    ).length;
  }

  async saveIngestedPack(packId: string, input: string, page: IngestedPage): Promise<void> {
    const current = this.packs.get(packId);
    this.packs.set(packId, {
      id: packId,
      input,
      sourceRevisionId: page.revisionId,
      sections: page.sections,
      summaries: current?.summaries ?? [],
      flashcards: current?.flashcards ?? [],
      quizQuestions: current?.quizQuestions ?? [],
      graphNodes: current?.graphNodes ?? [],
      graphEdges: current?.graphEdges ?? [],
      timelineEvents: current?.timelineEvents ?? []
    });
  }

  async saveSummaries(packId: string, summaries: SummaryArtifact[]): Promise<void> {
    const current = this.packs.get(packId);
    if (!current) return;
    this.packs.set(packId, {
      ...current,
      summaries: summaries.map((s) => ({ ...s, citations: [...s.citations] }))
    });
  }

  async saveActiveRecall(packId: string, flashcards: Flashcard[], quizQuestions: QuizQuestion[]): Promise<void> {
    const current = this.packs.get(packId);
    if (!current) return;
    this.packs.set(packId, {
      ...current,
      flashcards: flashcards.map((f) => ({ ...f })),
      quizQuestions: quizQuestions.map((q) => ({ ...q, options: [...q.options] }))
    });
  }

  async saveKnowledgeStructure(
    packId: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    timeline: TimelineEvent[]
  ): Promise<void> {
    const current = this.packs.get(packId);
    if (!current) return;
    this.packs.set(packId, {
      ...current,
      graphNodes: nodes.map((n) => ({ ...n })),
      graphEdges: edges.map((e) => ({ ...e })),
      timelineEvents: timeline.map((t) => ({ ...t }))
    });
  }

  async saveQuizAttempt(packId: string, selectedIndices: number[]): Promise<QuizAttemptRecord | undefined> {
    const pack = this.packs.get(packId);
    if (!pack || pack.quizQuestions.length === 0) {
      return undefined;
    }

    if (selectedIndices.length !== pack.quizQuestions.length) {
      return undefined;
    }

    const correctAnswers = pack.quizQuestions.reduce((acc, question, index) => {
      return selectedIndices[index] === question.correctIndex ? acc + 1 : acc;
    }, 0);
    const totalQuestions = pack.quizQuestions.length;
    const attempt: QuizAttemptRecord = {
      id: randomUUID(),
      packId,
      totalQuestions,
      correctAnswers,
      accuracy: correctAnswers / totalQuestions,
      submittedAt: new Date().toISOString()
    };
    this.quizAttempts.push(attempt);
    return attempt;
  }

  async recordJobCompletion(sample: JobCompletionSample): Promise<void> {
    this.outcomes.set(sample.jobId, {
      status: 'completed',
      durationMs: sample.durationMs,
      citationRate: sample.citationRate,
      flashcards: sample.flashcards,
      quizQuestions: sample.quizQuestions
    });
  }

  async recordJobFailure(sample: JobFailureSample): Promise<void> {
    this.outcomes.set(sample.jobId, { status: 'failed' });
  }

  async recordStageCost(sample: StageCostSample): Promise<void> {
    this.stageCosts.push({ ...sample });
  }

  async getOutcomesSnapshot(): Promise<OutcomesSnapshot> {
    const outcomeRows = Array.from(this.outcomes.values());
    const completedRows = outcomeRows.filter((row) => row.status === 'completed');
    const completed = completedRows.length;
    const failed = outcomeRows.filter((row) => row.status === 'failed').length;
    const total = completed + failed;

    const byStage = (['ingestion', 'summarization', 'active_recall', 'knowledge_structure'] as const)
      .map((stage) => {
        const rows = this.stageCosts.filter((entry) => entry.stage === stage);
        if (rows.length === 0) {
          return null;
        }
        const totalEstimatedUsd = rows.reduce((acc, entry) => acc + entry.estimatedCostUsd, 0);
        return {
          stage,
          events: rows.length,
          avgTokens: average(rows.map((entry) => entry.estimatedTokens)),
          avgLatencyMs: average(rows.map((entry) => entry.latencyMs)),
          totalEstimatedUsd,
          avgEstimatedUsd: totalEstimatedUsd / rows.length
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const totalEstimatedUsd = this.stageCosts.reduce((acc, entry) => acc + entry.estimatedCostUsd, 0);
    const uniquePackCount = new Set(this.stageCosts.map((entry) => entry.packId)).size;
    const firstArtifactDurations = Array.from(
      this.stageCosts.reduce((acc, entry) => {
        const prior = acc.get(entry.jobId) ?? { ingestionMs: 0, summarizationMs: 0 };
        if (entry.stage === 'ingestion') prior.ingestionMs = entry.latencyMs;
        if (entry.stage === 'summarization') prior.summarizationMs = entry.latencyMs;
        acc.set(entry.jobId, prior);
        return acc;
      }, new Map<string, { ingestionMs: number; summarizationMs: number }>())
    )
      .map(([, stages]) => stages.ingestionMs + stages.summarizationMs)
      .filter((duration) => duration > 0);
    const fullPackDurations = completedRows.map((row) => row.durationMs);
    const citationCoverageRate = average(completedRows.map((row) => row.citationRate));

    return {
      jobs: {
        completed,
        failed,
        avgDurationMs: average(completedRows.map((row) => row.durationMs)),
        completionRate: total === 0 ? 0 : completed / total
      },
      quality: {
        avgCitationRate: citationCoverageRate,
        avgFlashcards: average(completedRows.map((row) => row.flashcards)),
        avgQuizQuestions: average(completedRows.map((row) => row.quizQuestions))
      },
      learning: {
        attempts: this.quizAttempts.length,
        avgAccuracy: average(this.quizAttempts.map((attempt) => attempt.accuracy))
      },
      slo: {
        p95TimeToFirstArtifactMs: percentile(firstArtifactDurations, 0.95),
        p95FullPackCompletionMs: percentile(fullPackDurations, 0.95),
        jobSuccessRate: total === 0 ? 0 : completed / total,
        citationCoverageRate
      },
      cost: {
        totalEstimatedUsd,
        avgEstimatedUsdPerPack: uniquePackCount === 0 ? 0 : totalEstimatedUsd / uniquePackCount,
        byStage
      }
    };
  }

  async getOutcomesMaintenanceSnapshot(): Promise<OutcomesMaintenanceSnapshot> {
    return {
      lastRunAt: null,
      durationMs: 0,
      outcomesPruned: 0,
      quizAttemptsPruned: 0,
      rollupsRefreshed: 0
    };
  }

  async getPack(packId: string): Promise<PackRecord | undefined> {
    const pack = this.packs.get(packId);
    return pack
      ? {
          ...pack,
          sections: pack.sections.map((s) => ({ ...s })),
          summaries: pack.summaries.map((s) => ({ ...s, citations: [...s.citations] })),
          flashcards: pack.flashcards.map((f) => ({ ...f })),
          quizQuestions: pack.quizQuestions.map((q) => ({ ...q, options: [...q.options] })),
          graphNodes: pack.graphNodes.map((n) => ({ ...n })),
          graphEdges: pack.graphEdges.map((e) => ({ ...e })),
          timelineEvents: pack.timelineEvents.map((t) => ({ ...t }))
        }
      : undefined;
  }
}

export const memoryRepo = new MemoryRepo();
