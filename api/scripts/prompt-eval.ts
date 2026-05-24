import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateGroundedSummaries, computeGroundingStats } from '../src/domain/summary.js';
import { generateActiveRecallArtifacts } from '../src/domain/activeRecall.js';
import { generateKnowledgeStructureArtifacts } from '../src/domain/knowledgeStructure.js';
import { type GoldenSetDataset, validateGoldenSetDataset } from '../src/domain/goldenSetDataset.js';
import { evaluateQualityScore, type QualityMetrics, type QualityThresholds } from '../src/domain/qualityScoring.js';
import {
  evaluatePromptRegression,
  type PromptRegressionRun,
  type PromptRegressionThresholds
} from '../src/domain/promptEvaluation.js';

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

const parseSemver = (version: string): [number, number, number] => {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) {
    throw new Error(`Invalid semver: ${version}`);
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
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

const loadJson = async <T>(filePath: string): Promise<T> => {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
};

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
    throw new Error('No candidate prompt version found; add a draft/active version or set PROMPT_EVAL_CANDIDATE_VERSION');
  }

  return candidates[0];
};

const metricsForTopic = (
  topic: GoldenSetDataset['topics'][number],
  promptId: string,
  promptRef: string,
  modelRef: string,
  qualityThresholds: QualityThresholds
): QualityMetrics => {
  const summaries =
    promptId === 'summary-by-level'
      ? generateGroundedSummaries(topic.sections, promptRef, modelRef)
      : generateGroundedSummaries(topic.sections);
  const grounding = computeGroundingStats(summaries);
  const recall =
    promptId === 'active-recall'
      ? generateActiveRecallArtifacts(topic.sections, promptRef, modelRef)
      : generateActiveRecallArtifacts(topic.sections);
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

  return quality.metrics;
};

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(scriptDir, '../..');

  const datasetPath = path.resolve(scriptDir, '../fixtures/golden-set.json');
  const registryPath = path.resolve(rootDir, 'infra/prompts/registry.json');
  const qualityThresholdPath = path.resolve(rootDir, 'infra/evaluation/quality-scoring-thresholds.json');
  const regressionThresholdPath = path.resolve(rootDir, 'infra/evaluation/prompt-regression-thresholds.json');

  const [dataset, registryFile, qualityThresholdFile, regressionThresholdFile] = await Promise.all([
    loadJson<GoldenSetDataset>(datasetPath),
    loadJson<PromptRegistryFile>(registryPath),
    loadJson<QualityThresholdFile>(qualityThresholdPath),
    loadJson<PromptRegressionThresholdFile>(regressionThresholdPath)
  ]);

  const datasetErrors = validateGoldenSetDataset(dataset);
  if (datasetErrors.length > 0) {
    for (const error of datasetErrors) {
      console.error(`FAIL dataset ${error}`);
    }
    process.exit(1);
  }

  const promptId = process.env.PROMPT_EVAL_PROMPT_ID ?? 'summary-by-level';
  const prompts = registryFile.prompts.filter((prompt) => prompt.id === promptId);
  if (prompts.length === 0) {
    console.error(`FAIL prompt-id-not-found id=${promptId}`);
    process.exit(1);
  }

  const baseline = pickBaseline(prompts, process.env.PROMPT_EVAL_BASELINE_VERSION);
  const candidate = pickCandidate(prompts, baseline.version, process.env.PROMPT_EVAL_CANDIDATE_VERSION);

  const qualityThresholds = qualityThresholdFileToDomain(qualityThresholdFile);
  const regressionThresholds = promptRegressionThresholdFileToDomain(regressionThresholdFile);
  const baselineRef = `${promptId}@${baseline.version}`;
  const candidateRef = `${promptId}@${candidate.version}`;

  const runs: PromptRegressionRun[] = dataset.topics.map((topic) => ({
    topicId: topic.id,
    baseline: metricsForTopic(topic, promptId, baselineRef, 'local-rule-based', qualityThresholds),
    candidate: metricsForTopic(topic, promptId, candidateRef, 'local-rule-based', qualityThresholds)
  }));

  const regression = evaluatePromptRegression(runs, regressionThresholds);
  const report = {
    generated_at: new Date().toISOString(),
    prompt_id: promptId,
    baseline: baselineRef,
    candidate: candidateRef,
    topics: dataset.topics.length,
    thresholds: regressionThresholds,
    result: regression
  };

  if (process.env.PROMPT_EVAL_REPORT_PATH) {
    const reportPath = path.resolve(rootDir, process.env.PROMPT_EVAL_REPORT_PATH);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (!regression.pass) {
    for (const topic of regression.failedTopics) {
      console.error(
        `FAIL topic=${topic.topicId} failures=${topic.failures.join(',')} drops=${JSON.stringify(topic.drops)} avg_drop=${topic.averageDrop.toFixed(4)}`
      );
    }
    process.exit(1);
  }

  console.log(
    `Prompt regression passed: prompt=${promptId} baseline=${baselineRef} candidate=${candidateRef} topics=${dataset.topics.length}`
  );
};

void run();
