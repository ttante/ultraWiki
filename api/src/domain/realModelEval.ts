import type { Flashcard, QuizQuestion } from './activeRecall.js';
import type { BenchmarkHarnessResult } from './benchmarkHarness.js';
import type { GraphEdge, GraphNode, TimelineEvent } from './knowledgeStructure.js';
import type { LlmFallbackEvent } from './llmProvider.js';
import type { SummaryArtifact } from './summary.js';

export type RealModelEvalThresholds = {
  version: string;
  runtime_profile: string;
  model: string;
  max_total_duration_ms: number;
  max_failure_rate: number;
  min_memory_headroom_mb: number;
  min_citation_rate: number;
  min_summaries: number;
  min_flashcards: number;
  min_quiz_questions: number;
  min_graph_nodes: number;
  min_graph_edges: number;
  min_timeline_events: number;
  max_stage_p95_ms: {
    summarization: number;
    active_recall: number;
    knowledge_structure: number;
  };
};

export type RealModelEvalInput = {
  expectedModel: string;
  benchmark: BenchmarkHarnessResult;
  fallbackEvents: LlmFallbackEvent[];
  summaries: SummaryArtifact[];
  flashcards: Flashcard[];
  quizQuestions: QuizQuestion[];
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  timelineEvents: TimelineEvent[];
  citationRate: number;
  thresholds: RealModelEvalThresholds;
};

export type RealModelEvalResult = {
  pass: boolean;
  failures: string[];
  metrics: {
    model: string;
    totalDurationMs: number;
    failureRate: number;
    memoryHeadroomMb: number;
    citationRate: number;
    summaries: number;
    flashcards: number;
    quizQuestions: number;
    graphNodes: number;
    graphEdges: number;
    timelineEvents: number;
    fallbackEvents: number;
  };
};

const isPositiveNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

export const validateRealModelEvalThresholds = (thresholds: RealModelEvalThresholds): string[] => {
  const errors: string[] = [];

  if (!thresholds.version?.trim()) errors.push('version is required');
  if (!thresholds.runtime_profile?.trim()) errors.push('runtime_profile is required');
  if (!thresholds.model?.trim()) errors.push('model is required');
  if (!isPositiveNumber(thresholds.max_total_duration_ms)) errors.push('max_total_duration_ms must be positive');
  if (typeof thresholds.max_failure_rate !== 'number' || thresholds.max_failure_rate < 0 || thresholds.max_failure_rate > 1) {
    errors.push('max_failure_rate must be between 0 and 1');
  }
  if (!isPositiveNumber(thresholds.min_memory_headroom_mb)) errors.push('min_memory_headroom_mb must be positive');
  if (typeof thresholds.min_citation_rate !== 'number' || thresholds.min_citation_rate < 0 || thresholds.min_citation_rate > 1) {
    errors.push('min_citation_rate must be between 0 and 1');
  }

  const countFields = [
    'min_summaries',
    'min_flashcards',
    'min_quiz_questions',
    'min_graph_nodes',
    'min_graph_edges',
    'min_timeline_events'
  ] as const;
  for (const field of countFields) {
    if (!Number.isInteger(thresholds[field]) || thresholds[field] < 0) {
      errors.push(`${field} must be a non-negative integer`);
    }
  }

  if (!isPositiveNumber(thresholds.max_stage_p95_ms?.summarization)) {
    errors.push('max_stage_p95_ms.summarization must be positive');
  }
  if (!isPositiveNumber(thresholds.max_stage_p95_ms?.active_recall)) {
    errors.push('max_stage_p95_ms.active_recall must be positive');
  }
  if (!isPositiveNumber(thresholds.max_stage_p95_ms?.knowledge_structure)) {
    errors.push('max_stage_p95_ms.knowledge_structure must be positive');
  }

  return errors;
};

export const evaluateRealModelEval = (input: RealModelEvalInput): RealModelEvalResult => {
  const failures = validateRealModelEvalThresholds(input.thresholds);
  const metrics = {
    model: input.benchmark.model,
    totalDurationMs: input.benchmark.totalDurationMs,
    failureRate: input.benchmark.failureRate,
    memoryHeadroomMb: input.benchmark.memoryHeadroomMb,
    citationRate: input.citationRate,
    summaries: input.summaries.length,
    flashcards: input.flashcards.length,
    quizQuestions: input.quizQuestions.length,
    graphNodes: input.graphNodes.length,
    graphEdges: input.graphEdges.length,
    timelineEvents: input.timelineEvents.length,
    fallbackEvents: input.fallbackEvents.length
  };

  if (input.thresholds.model !== input.expectedModel) {
    failures.push(`threshold model=${input.thresholds.model} does not match expected=${input.expectedModel}`);
  }
  if (input.benchmark.runtimeProfile !== input.thresholds.runtime_profile) {
    failures.push(
      `runtime_profile current=${input.benchmark.runtimeProfile} expected=${input.thresholds.runtime_profile}`
    );
  }
  if (input.benchmark.model !== input.expectedModel) {
    failures.push(`benchmark model=${input.benchmark.model} expected=${input.expectedModel}`);
  }
  if (input.fallbackEvents.length > 0) {
    failures.push(`real model fallback used: ${input.fallbackEvents.map((event) => `${event.schemaName}:${event.reason}`).join(',')}`);
  }
  const artifactModels = [
    ...input.summaries.map((summary) => summary.model),
    ...input.flashcards.map((card) => card.model),
    ...input.quizQuestions.map((question) => question.model)
  ];
  const unexpectedModels = [...new Set(artifactModels.filter((model) => model !== input.expectedModel))];
  if (unexpectedModels.length > 0) {
    failures.push(`artifact model mismatch expected=${input.expectedModel} actual=${unexpectedModels.join(',')}`);
  }

  if (metrics.totalDurationMs > input.thresholds.max_total_duration_ms) {
    failures.push(
      `total_duration_ms current=${metrics.totalDurationMs.toFixed(2)} max=${input.thresholds.max_total_duration_ms}`
    );
  }
  if (metrics.failureRate > input.thresholds.max_failure_rate) {
    failures.push(`failure_rate current=${metrics.failureRate.toFixed(4)} max=${input.thresholds.max_failure_rate}`);
  }
  if (metrics.memoryHeadroomMb < input.thresholds.min_memory_headroom_mb) {
    failures.push(
      `memory_headroom_mb current=${metrics.memoryHeadroomMb.toFixed(2)} min=${input.thresholds.min_memory_headroom_mb}`
    );
  }
  if (input.benchmark.stageLatencyMs.summarizationP95Ms > input.thresholds.max_stage_p95_ms.summarization) {
    failures.push(
      `summarization_p95_ms current=${input.benchmark.stageLatencyMs.summarizationP95Ms.toFixed(2)} max=${input.thresholds.max_stage_p95_ms.summarization}`
    );
  }
  if (input.benchmark.stageLatencyMs.activeRecallP95Ms > input.thresholds.max_stage_p95_ms.active_recall) {
    failures.push(
      `active_recall_p95_ms current=${input.benchmark.stageLatencyMs.activeRecallP95Ms.toFixed(2)} max=${input.thresholds.max_stage_p95_ms.active_recall}`
    );
  }
  if (input.benchmark.stageLatencyMs.knowledgeStructureP95Ms > input.thresholds.max_stage_p95_ms.knowledge_structure) {
    failures.push(
      `knowledge_structure_p95_ms current=${input.benchmark.stageLatencyMs.knowledgeStructureP95Ms.toFixed(2)} max=${input.thresholds.max_stage_p95_ms.knowledge_structure}`
    );
  }
  if (metrics.citationRate < input.thresholds.min_citation_rate) {
    failures.push(`citation_rate current=${metrics.citationRate.toFixed(4)} min=${input.thresholds.min_citation_rate}`);
  }
  if (metrics.summaries < input.thresholds.min_summaries) {
    failures.push(`summaries current=${metrics.summaries} min=${input.thresholds.min_summaries}`);
  }
  if (metrics.flashcards < input.thresholds.min_flashcards) {
    failures.push(`flashcards current=${metrics.flashcards} min=${input.thresholds.min_flashcards}`);
  }
  if (metrics.quizQuestions < input.thresholds.min_quiz_questions) {
    failures.push(`quiz_questions current=${metrics.quizQuestions} min=${input.thresholds.min_quiz_questions}`);
  }
  if (metrics.graphNodes < input.thresholds.min_graph_nodes) {
    failures.push(`graph_nodes current=${metrics.graphNodes} min=${input.thresholds.min_graph_nodes}`);
  }
  if (metrics.graphEdges < input.thresholds.min_graph_edges) {
    failures.push(`graph_edges current=${metrics.graphEdges} min=${input.thresholds.min_graph_edges}`);
  }
  if (metrics.timelineEvents < input.thresholds.min_timeline_events) {
    failures.push(`timeline_events current=${metrics.timelineEvents} min=${input.thresholds.min_timeline_events}`);
  }

  return {
    pass: failures.length === 0,
    failures,
    metrics
  };
};
