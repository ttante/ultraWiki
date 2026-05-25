import type { QuizQuestion } from './activeRecall.js';
import type { GraphEdge, GraphNode } from './knowledgeStructure.js';
import type { SummaryArtifact } from './summary.js';

export type QualityThresholds = {
  summaryQualityMin: number;
  citationCoverageMin: number;
  quizValidityMin: number;
  graphCoherenceMin: number;
};

export type QualityScoreInput = {
  summaries: SummaryArtifact[];
  citationCoverageRate: number;
  quizQuestions: QuizQuestion[];
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
};

export type QualityMetrics = {
  summaryQuality: number;
  citationCoverage: number;
  quizValidity: number;
  graphCoherence: number;
};

export type QualityScoreResult = {
  pass: boolean;
  metrics: QualityMetrics;
  failures: Array<keyof QualityMetrics>;
};

export const qualityMetricKeys: Array<keyof QualityMetrics> = [
  'summaryQuality',
  'citationCoverage',
  'quizValidity',
  'graphCoherence'
];

export const validateQualityThresholds = (thresholds: QualityThresholds): string[] => {
  const errors: string[] = [];
  for (const key of qualityMetricKeys) {
    const value = thresholds[
      key === 'summaryQuality'
        ? 'summaryQualityMin'
        : key === 'citationCoverage'
          ? 'citationCoverageMin'
          : key === 'quizValidity'
            ? 'quizValidityMin'
            : 'graphCoherenceMin'
    ];

    if (!Number.isFinite(value) || value < 0 || value > 1) {
      errors.push(`${key} threshold must be between 0 and 1`);
    }
  }
  return errors;
};

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const uniqueSummaryLevels = (summaries: SummaryArtifact[]): number => {
  return new Set(summaries.map((summary) => summary.level)).size;
};

const scoreSummaryQuality = (summaries: SummaryArtifact[]): number => {
  if (summaries.length === 0) {
    return 0;
  }

  const levelCoverage = uniqueSummaryLevels(summaries) / 3;
  const averageChars = summaries.reduce((acc, summary) => acc + summary.text.trim().length, 0) / summaries.length;
  const densityScore = Math.min(1, averageChars / 160);

  return clamp01(levelCoverage * 0.7 + densityScore * 0.3);
};

const isValidQuizQuestion = (question: QuizQuestion): boolean => {
  if (question.question.trim().length < 20) return false;
  if (question.options.length !== 4) return false;
  if (question.correctIndex < 0 || question.correctIndex > 3) return false;
  if (question.misconceptions.length !== 4) return false;
  if (question.misconceptions.some((entry) => entry.trim().length < 8)) return false;
  if (question.explanation.trim().length < 20) return false;
  if (question.citation.trim().length === 0) return false;
  return true;
};

const scoreQuizValidity = (quizQuestions: QuizQuestion[]): number => {
  if (quizQuestions.length === 0) return 0;
  const valid = quizQuestions.filter((question) => isValidQuizQuestion(question)).length;
  return clamp01(valid / quizQuestions.length);
};

const scoreGraphCoherence = (nodes: GraphNode[], edges: GraphEdge[]): number => {
  if (nodes.length === 0 || edges.length === 0) {
    return 0;
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const validEdges = edges.filter(
    (edge) => edge.source !== edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.relation.trim().length > 0
  ).length;
  const validEdgeRatio = validEdges / edges.length;
  const citedNodeRatio = nodes.filter((node) => node.citation.trim().length > 0).length / nodes.length;

  return clamp01(validEdgeRatio * 0.8 + citedNodeRatio * 0.2);
};

export const evaluateQualityScore = (input: QualityScoreInput, thresholds: QualityThresholds): QualityScoreResult => {
  const metrics: QualityMetrics = {
    summaryQuality: scoreSummaryQuality(input.summaries),
    citationCoverage: clamp01(input.citationCoverageRate),
    quizValidity: scoreQuizValidity(input.quizQuestions),
    graphCoherence: scoreGraphCoherence(input.graphNodes, input.graphEdges)
  };

  const thresholdErrors = validateQualityThresholds(thresholds);
  if (thresholdErrors.length > 0) {
    throw new Error(`Invalid quality thresholds: ${thresholdErrors.join('; ')}`);
  }

  const failures: Array<keyof QualityMetrics> = [];
  if (metrics.summaryQuality < thresholds.summaryQualityMin) failures.push('summaryQuality');
  if (metrics.citationCoverage < thresholds.citationCoverageMin) failures.push('citationCoverage');
  if (metrics.quizValidity < thresholds.quizValidityMin) failures.push('quizValidity');
  if (metrics.graphCoherence < thresholds.graphCoherenceMin) failures.push('graphCoherence');

  return {
    pass: failures.length === 0,
    metrics,
    failures
  };
};
