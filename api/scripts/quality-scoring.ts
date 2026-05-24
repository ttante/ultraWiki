import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateActiveRecallArtifacts } from '../src/domain/activeRecall.js';
import { type GoldenSetDataset, validateGoldenSetDataset } from '../src/domain/goldenSetDataset.js';
import { generateKnowledgeStructureArtifacts } from '../src/domain/knowledgeStructure.js';
import {
  evaluateQualityScore,
  validateQualityThresholds,
  type QualityScoreInput,
  type QualityThresholds
} from '../src/domain/qualityScoring.js';
import { computeGroundingStats, generateGroundedSummaries } from '../src/domain/summary.js';

type QualityThresholdFile = {
  version: string;
  summary_quality_min: number;
  citation_coverage_min: number;
  quiz_validity_min: number;
  graph_coherence_min: number;
};

type FixtureCase = {
  id: string;
  thresholds: QualityThresholds;
  input: QualityScoreInput;
  expected: {
    pass: boolean;
    failures: string[];
  };
};

const loadJson = async <T>(filePath: string): Promise<T> => JSON.parse(await readFile(filePath, 'utf8')) as T;

const thresholdFileToDomain = (file: QualityThresholdFile): QualityThresholds => ({
  summaryQualityMin: file.summary_quality_min,
  citationCoverageMin: file.citation_coverage_min,
  quizValidityMin: file.quiz_validity_min,
  graphCoherenceMin: file.graph_coherence_min
});

const scoreGoldenTopic = (topic: GoldenSetDataset['topics'][number], thresholds: QualityThresholds): QualityScoreInput => {
  const summaries = generateGroundedSummaries(topic.sections);
  const recall = generateActiveRecallArtifacts(topic.sections);
  const knowledge = generateKnowledgeStructureArtifacts(topic.sections);
  const grounding = computeGroundingStats(summaries);

  return {
    summaries,
    citationCoverageRate: grounding.citationRate,
    quizQuestions: recall.quizQuestions,
    graphNodes: knowledge.nodes,
    graphEdges: knowledge.edges
  };
};

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '../..');
  const fixturePath = path.resolve(scriptDir, '../fixtures/quality-scoring-fixtures.json');
  const goldenSetPath = path.resolve(scriptDir, '../fixtures/golden-set.json');
  const thresholdPath = path.resolve(root, 'infra/evaluation/quality-scoring-thresholds.json');

  const [fixtures, dataset, thresholdFile] = await Promise.all([
    loadJson<FixtureCase[]>(fixturePath),
    loadJson<GoldenSetDataset>(goldenSetPath),
    loadJson<QualityThresholdFile>(thresholdPath)
  ]);

  const thresholds = thresholdFileToDomain(thresholdFile);
  const thresholdErrors = validateQualityThresholds(thresholds);
  if (thresholdErrors.length > 0) {
    for (const error of thresholdErrors) {
      console.error(`FAIL threshold ${error}`);
    }
    process.exit(1);
  }

  const datasetErrors = validateGoldenSetDataset(dataset);
  if (datasetErrors.length > 0) {
    for (const error of datasetErrors) {
      console.error(`FAIL dataset ${error}`);
    }
    process.exit(1);
  }

  let failed = 0;
  for (const fixture of fixtures) {
    const result = evaluateQualityScore(fixture.input, fixture.thresholds);
    if (result.pass !== fixture.expected.pass || result.failures.join(',') !== fixture.expected.failures.join(',')) {
      failed += 1;
      console.error(
        `FAIL fixture=${fixture.id} expected_pass=${fixture.expected.pass} actual_pass=${result.pass} failures=${result.failures.join(',')}`
      );
    }
  }

  for (const topic of dataset.topics) {
    const result = evaluateQualityScore(scoreGoldenTopic(topic, thresholds), thresholds);
    if (!result.pass) {
      failed += 1;
      console.error(`FAIL topic=${topic.id} quality_failures=${result.failures.join(',')} metrics=${JSON.stringify(result.metrics)}`);
    }
  }

  if (failed > 0) {
    process.exit(1);
  }

  console.log(
    `Quality scoring gate passed: ${fixtures.length} fixtures, ${dataset.topics.length} golden topics, thresholds=${thresholdFile.version}`
  );
};

void run();
