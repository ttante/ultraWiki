import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateActiveRecallArtifacts } from './activeRecall.js';
import { type GoldenSetDataset, type GoldenSetDomain, validateGoldenSetDataset } from './goldenSetDataset.js';
import { generateKnowledgeStructureArtifacts } from './knowledgeStructure.js';
import {
  evaluateQualityScore,
  type QualityMetrics,
  type QualityThresholds,
  qualityMetricKeys
} from './qualityScoring.js';
import { computeGroundingStats, generateGroundedSummaries } from './summary.js';

export type PromptRegressionThresholds = {
  maxDropByMetric: Record<keyof QualityMetrics, number>;
  maxAverageDrop: number;
};

export type PromptRegressionRun = {
  topicId: string;
  baseline: QualityMetrics;
  candidate: QualityMetrics;
};

export type PromptRegressionTopicResult = {
  topicId: string;
  baseline: QualityMetrics;
  candidate: QualityMetrics;
  drops: QualityMetrics;
  averageDrop: number;
  pass: boolean;
  failures: Array<keyof QualityMetrics | 'averageDrop'>;
};

export type PromptRegressionResult = {
  pass: boolean;
  topicResults: PromptRegressionTopicResult[];
  failedTopics: PromptRegressionTopicResult[];
};

const nonNegativeDrop = (baseline: number, candidate: number): number => Math.max(0, baseline - candidate);

const average = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
};

const metricKeys = qualityMetricKeys;

export const evaluatePromptRegression = (
  runs: PromptRegressionRun[],
  thresholds: PromptRegressionThresholds
): PromptRegressionResult => {
  const topicResults = runs.map((run): PromptRegressionTopicResult => {
    const drops: QualityMetrics = {
      summaryQuality: nonNegativeDrop(run.baseline.summaryQuality, run.candidate.summaryQuality),
      citationCoverage: nonNegativeDrop(run.baseline.citationCoverage, run.candidate.citationCoverage),
      quizValidity: nonNegativeDrop(run.baseline.quizValidity, run.candidate.quizValidity),
      graphCoherence: nonNegativeDrop(run.baseline.graphCoherence, run.candidate.graphCoherence)
    };

    const failures: Array<keyof QualityMetrics | 'averageDrop'> = [];
    for (const key of metricKeys) {
      if (drops[key] > thresholds.maxDropByMetric[key]) {
        failures.push(key);
      }
    }

    const averageDrop = average(metricKeys.map((key) => drops[key]));
    if (averageDrop > thresholds.maxAverageDrop) {
      failures.push('averageDrop');
    }

    return {
      topicId: run.topicId,
      baseline: run.baseline,
      candidate: run.candidate,
      drops,
      averageDrop,
      pass: failures.length === 0,
      failures
    };
  });

  const failedTopics = topicResults.filter((topic) => !topic.pass);
  return {
    pass: failedTopics.length === 0,
    topicResults,
    failedTopics
  };
};

type PromptStatus = 'active' | 'deprecated' | 'draft';

type PromptDefinition = {
  id: string;
  version: string;
  status: PromptStatus;
  template: string;
  changelog: string;
};

type PromptRegistryFile = {
  version: string;
  prompts: PromptDefinition[];
};

type QualityThresholdFile = {
  version: string;
  summary_quality_min: number;
  citation_coverage_min: number;
  quiz_validity_min: number;
  graph_coherence_min: number;
};

type PromptRegressionThresholdFile = {
  version: string;
  max_drop_by_metric: {
    summary_quality: number;
    citation_coverage: number;
    quiz_validity: number;
    graph_coherence: number;
  };
  max_average_drop: number;
};

export type PromptEvaluationCheck = {
  id: string;
  pass: boolean;
  actual: number;
  target: string;
};

export type GoldenSetTopicEvaluation = {
  topicId: string;
  title: string;
  domain: GoldenSetDomain;
  pass: boolean;
  checks: PromptEvaluationCheck[];
  metrics: QualityMetrics;
  qualityFailures: Array<keyof QualityMetrics>;
};

export type PromptEvaluationSnapshot = {
  generatedAt: string;
  promptRegistryVersion: string;
  dataset: {
    version: string;
    checksumSha256: string;
    topics: number;
  };
  model: string;
  goldenSet: {
    pass: boolean;
    topics: number;
    failedTopics: number;
    qualityThresholdVersion: string;
    topicResults: GoldenSetTopicEvaluation[];
  };
  promptRegression: {
    pass: boolean;
    promptId: string;
    baseline: Pick<PromptDefinition, 'version' | 'status' | 'changelog'> & { promptVersion: string };
    candidate: Pick<PromptDefinition, 'version' | 'status' | 'changelog'> & { promptVersion: string };
    thresholdVersion: string;
    thresholds: PromptRegressionThresholds;
    topics: number;
    failedTopics: number;
    averageDrop: number;
    topicResults: Array<PromptRegressionTopicResult & { title: string; domain: GoldenSetDomain; maxMetricDrop: number }>;
  };
};

export type PromptEvaluationSnapshotOptions = {
  generatedAt?: string;
  rootDir?: string;
  promptId?: string;
  model?: string;
  baselineVersion?: string;
  candidateVersion?: string;
};

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const unique = (values: string[]): string[] => [...new Set(values)];

const resolveProjectRoot = (explicitRoot?: string): string => {
  const candidates = explicitRoot
    ? [explicitRoot]
    : unique([
        process.cwd(),
        path.resolve(process.cwd(), '..'),
        path.resolve(moduleDir, '../../..'),
        path.resolve(moduleDir, '../../../..')
      ]);

  const found = candidates.find(
    (candidate) =>
      existsSync(path.resolve(candidate, 'infra/prompts/registry.json')) &&
      existsSync(path.resolve(candidate, 'api/fixtures/golden-set.json'))
  );

  if (!found) {
    throw new Error('prompt_evaluation_files_not_found');
  }

  return found;
};

const loadJson = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await readFile(filePath, 'utf8')) as T;

const qualityThresholdFileToDomain = (file: QualityThresholdFile): QualityThresholds => ({
  summaryQualityMin: file.summary_quality_min,
  citationCoverageMin: file.citation_coverage_min,
  quizValidityMin: file.quiz_validity_min,
  graphCoherenceMin: file.graph_coherence_min
});

const promptRegressionThresholdFileToDomain = (file: PromptRegressionThresholdFile): PromptRegressionThresholds => ({
  maxDropByMetric: {
    summaryQuality: file.max_drop_by_metric.summary_quality,
    citationCoverage: file.max_drop_by_metric.citation_coverage,
    quizValidity: file.max_drop_by_metric.quiz_validity,
    graphCoherence: file.max_drop_by_metric.graph_coherence
  },
  maxAverageDrop: file.max_average_drop
});

const parseSemver = (version: string): [number, number, number] => {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid semver: ${version}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const compareSemver = (a: string, b: string): number => {
  const aParts = parseSemver(a);
  const bParts = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (aParts[i] !== bParts[i]) {
      return aParts[i] - bParts[i];
    }
  }
  return 0;
};

const pickBaseline = (prompts: PromptDefinition[], explicitVersion?: string): PromptDefinition => {
  if (explicitVersion) {
    const prompt = prompts.find((entry) => entry.version === explicitVersion);
    if (!prompt) {
      throw new Error(`Baseline version not found: ${explicitVersion}`);
    }
    return prompt;
  }

  const active = prompts.filter((entry) => entry.status === 'active');
  if (active.length === 0) {
    throw new Error('No active prompt version found for baseline');
  }
  return active.sort((a, b) => compareSemver(b.version, a.version))[0];
};

const pickCandidate = (
  prompts: PromptDefinition[],
  baselineVersion: string,
  explicitVersion?: string
): PromptDefinition => {
  if (explicitVersion) {
    const prompt = prompts.find((entry) => entry.version === explicitVersion);
    if (!prompt) {
      throw new Error(`Candidate version not found: ${explicitVersion}`);
    }
    if (prompt.version === baselineVersion) {
      throw new Error(`Candidate version must differ from baseline (${baselineVersion})`);
    }
    return prompt;
  }

  const candidates = prompts
    .filter((entry) => entry.version !== baselineVersion)
    .filter((entry) => entry.status !== 'deprecated')
    .sort((a, b) => compareSemver(b.version, a.version));

  if (candidates.length === 0) {
    throw new Error('No candidate prompt version found for prompt evaluation');
  }

  return candidates[0];
};

const activePromptRef = (prompts: PromptDefinition[], promptId: string): string => {
  const prompt = pickBaseline(prompts.filter((entry) => entry.id === promptId));
  return `${promptId}@${prompt.version}`;
};

const metricsForTopic = (
  topic: GoldenSetDataset['topics'][number],
  promptId: string,
  promptRef: string,
  model: string,
  qualityThresholds: QualityThresholds
): QualityMetrics => {
  const summaries =
    promptId === 'summary-by-level'
      ? generateGroundedSummaries(topic.sections, promptRef, model)
      : generateGroundedSummaries(topic.sections);
  const grounding = computeGroundingStats(summaries);
  const recall =
    promptId === 'active-recall'
      ? generateActiveRecallArtifacts(topic.sections, promptRef, model)
      : generateActiveRecallArtifacts(topic.sections);
  const knowledge = generateKnowledgeStructureArtifacts(topic.sections);

  return evaluateQualityScore(
    {
      summaries,
      citationCoverageRate: grounding.citationRate,
      quizQuestions: recall.quizQuestions,
      graphNodes: knowledge.nodes,
      graphEdges: knowledge.edges
    },
    qualityThresholds
  ).metrics;
};

const maxMetricDrop = (drops: QualityMetrics): number =>
  Math.max(...metricKeys.map((key) => drops[key]));

const metricAverage = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((acc, value) => acc + value, 0) / values.length;

const buildGoldenSetTopicEvaluation = (
  topic: GoldenSetDataset['topics'][number],
  promptRefs: { summary: string; activeRecall: string },
  model: string,
  qualityThresholds: QualityThresholds
): GoldenSetTopicEvaluation => {
  const summaries = generateGroundedSummaries(topic.sections, promptRefs.summary, model);
  const grounding = computeGroundingStats(summaries);
  const recall = generateActiveRecallArtifacts(topic.sections, promptRefs.activeRecall, model);
  const knowledge = generateKnowledgeStructureArtifacts(topic.sections);
  const quality = evaluateQualityScore(
    {
      summaries,
      citationCoverageRate: grounding.citationRate,
      quizQuestions: recall.quizQuestions,
      graphNodes: knowledge.nodes,
      graphEdges: knowledge.edges
    },
    qualityThresholds
  );
  const checks: PromptEvaluationCheck[] = [
    { id: 'summaries_count', pass: summaries.length === 3, actual: summaries.length, target: '=3' },
    {
      id: 'citation_rate',
      pass: grounding.citationRate >= topic.thresholds.min_citation_rate,
      actual: grounding.citationRate,
      target: `>=${topic.thresholds.min_citation_rate}`
    },
    {
      id: 'flashcards_count',
      pass: recall.flashcards.length >= 15 && recall.flashcards.length <= 25,
      actual: recall.flashcards.length,
      target: '15-25'
    },
    {
      id: 'quiz_count',
      pass: recall.quizQuestions.length >= 10 && recall.quizQuestions.length <= 15,
      actual: recall.quizQuestions.length,
      target: '10-15'
    },
    {
      id: 'graph_nodes',
      pass: knowledge.nodes.length >= topic.thresholds.min_nodes,
      actual: knowledge.nodes.length,
      target: `>=${topic.thresholds.min_nodes}`
    },
    {
      id: 'graph_edges',
      pass: knowledge.edges.length >= topic.thresholds.min_edges,
      actual: knowledge.edges.length,
      target: `>=${topic.thresholds.min_edges}`
    },
    {
      id: 'timeline_events',
      pass: knowledge.timeline.length >= topic.thresholds.min_timeline,
      actual: knowledge.timeline.length,
      target: `>=${topic.thresholds.min_timeline}`
    }
  ];

  return {
    topicId: topic.id,
    title: topic.title,
    domain: topic.domain,
    pass: checks.every((check) => check.pass) && quality.pass,
    checks,
    metrics: quality.metrics,
    qualityFailures: quality.failures
  };
};

export const buildPromptEvaluationSnapshot = async (
  options: PromptEvaluationSnapshotOptions = {}
): Promise<PromptEvaluationSnapshot> => {
  const rootDir = resolveProjectRoot(options.rootDir);
  const promptId = options.promptId ?? 'summary-by-level';
  const model = options.model ?? 'local-rule-based';
  const [dataset, registryFile, qualityThresholdFile, regressionThresholdFile] = await Promise.all([
    loadJson<GoldenSetDataset>(path.resolve(rootDir, 'api/fixtures/golden-set.json')),
    loadJson<PromptRegistryFile>(path.resolve(rootDir, 'infra/prompts/registry.json')),
    loadJson<QualityThresholdFile>(path.resolve(rootDir, 'infra/evaluation/quality-scoring-thresholds.json')),
    loadJson<PromptRegressionThresholdFile>(path.resolve(rootDir, 'infra/evaluation/prompt-regression-thresholds.json'))
  ]);

  const datasetErrors = validateGoldenSetDataset(dataset);
  if (datasetErrors.length > 0) {
    throw new Error(`Invalid golden-set dataset: ${datasetErrors.join('; ')}`);
  }

  const prompts = registryFile.prompts.filter((prompt) => prompt.id === promptId);
  if (prompts.length === 0) {
    throw new Error(`Prompt id not found: ${promptId}`);
  }

  const baseline = pickBaseline(prompts, options.baselineVersion);
  const candidate = pickCandidate(prompts, baseline.version, options.candidateVersion);
  const qualityThresholds = qualityThresholdFileToDomain(qualityThresholdFile);
  const regressionThresholds = promptRegressionThresholdFileToDomain(regressionThresholdFile);
  const baselineRef = `${promptId}@${baseline.version}`;
  const candidateRef = `${promptId}@${candidate.version}`;

  const goldenTopicResults = dataset.topics.map((topic) =>
    buildGoldenSetTopicEvaluation(
      topic,
      {
        summary: activePromptRef(registryFile.prompts, 'summary-by-level'),
        activeRecall: activePromptRef(registryFile.prompts, 'active-recall')
      },
      model,
      qualityThresholds
    )
  );
  const regressionRuns: PromptRegressionRun[] = dataset.topics.map((topic) => ({
    topicId: topic.id,
    baseline: metricsForTopic(topic, promptId, baselineRef, model, qualityThresholds),
    candidate: metricsForTopic(topic, promptId, candidateRef, model, qualityThresholds)
  }));
  const regression = evaluatePromptRegression(regressionRuns, regressionThresholds);
  const topicById = new Map(dataset.topics.map((topic) => [topic.id, topic]));

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    promptRegistryVersion: registryFile.version,
    dataset: {
      version: dataset.version,
      checksumSha256: dataset.checksum_sha256,
      topics: dataset.topics.length
    },
    model,
    goldenSet: {
      pass: goldenTopicResults.every((topic) => topic.pass),
      topics: goldenTopicResults.length,
      failedTopics: goldenTopicResults.filter((topic) => !topic.pass).length,
      qualityThresholdVersion: qualityThresholdFile.version,
      topicResults: goldenTopicResults
    },
    promptRegression: {
      pass: regression.pass,
      promptId,
      baseline: {
        promptVersion: baselineRef,
        version: baseline.version,
        status: baseline.status,
        changelog: baseline.changelog
      },
      candidate: {
        promptVersion: candidateRef,
        version: candidate.version,
        status: candidate.status,
        changelog: candidate.changelog
      },
      thresholdVersion: regressionThresholdFile.version,
      thresholds: regressionThresholds,
      topics: regression.topicResults.length,
      failedTopics: regression.failedTopics.length,
      averageDrop: metricAverage(regression.topicResults.map((topic) => topic.averageDrop)),
      topicResults: regression.topicResults.map((topic) => {
        const sourceTopic = topicById.get(topic.topicId);
        return {
          ...topic,
          title: sourceTopic?.title ?? topic.topicId,
          domain: sourceTopic?.domain ?? 'abstract_concept',
          maxMetricDrop: maxMetricDrop(topic.drops)
        };
      })
    }
  };
};
