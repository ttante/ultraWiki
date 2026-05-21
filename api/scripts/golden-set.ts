import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeGroundingStats, generateGroundedSummaries } from '../src/domain/summary.js';
import { generateActiveRecallArtifacts } from '../src/domain/activeRecall.js';
import { generateKnowledgeStructureArtifacts } from '../src/domain/knowledgeStructure.js';
import { type GoldenSetDataset, validateGoldenSetDataset } from '../src/domain/goldenSetDataset.js';
import { evaluateQualityScore, type QualityThresholds } from '../src/domain/qualityScoring.js';

const loadDataset = async (): Promise<GoldenSetDataset> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const fixturePath = path.resolve(scriptDir, '../fixtures/golden-set.json');
  const data = await readFile(fixturePath, 'utf8');
  return JSON.parse(data) as GoldenSetDataset;
};

type QualityThresholdFile = {
  version: string;
  summary_quality_min: number;
  citation_coverage_min: number;
  quiz_validity_min: number;
  graph_coherence_min: number;
};

const loadQualityThresholds = async (): Promise<QualityThresholds> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const thresholdsPath = path.resolve(scriptDir, '../../infra/evaluation/quality-scoring-thresholds.json');
  const data = JSON.parse(await readFile(thresholdsPath, 'utf8')) as QualityThresholdFile;
  return {
    summaryQualityMin: data.summary_quality_min,
    citationCoverageMin: data.citation_coverage_min,
    quizValidityMin: data.quiz_validity_min,
    graphCoherenceMin: data.graph_coherence_min
  };
};

const run = async (): Promise<void> => {
  const dataset = await loadDataset();
  const qualityThresholds = await loadQualityThresholds();
  const datasetErrors = validateGoldenSetDataset(dataset);
  if (datasetErrors.length > 0) {
    for (const error of datasetErrors) {
      console.error(`FAIL dataset ${error}`);
    }
    process.exit(1);
  }

  let failed = 0;

  for (const topic of dataset.topics) {
    const summaries = generateGroundedSummaries(topic.sections);
    const grounding = computeGroundingStats(summaries);
    const recall = generateActiveRecallArtifacts(topic.sections);
    const knowledge = generateKnowledgeStructureArtifacts(topic.sections);

    const checks = [
      ['summaries_count', summaries.length === 3],
      ['citation_rate', grounding.citationRate >= topic.thresholds.min_citation_rate],
      ['flashcards_count', recall.flashcards.length >= 15 && recall.flashcards.length <= 25],
      ['quiz_count', recall.quizQuestions.length >= 10 && recall.quizQuestions.length <= 15],
      ['graph_nodes', knowledge.nodes.length >= topic.thresholds.min_nodes],
      ['graph_edges', knowledge.edges.length >= topic.thresholds.min_edges],
      ['timeline_events', knowledge.timeline.length >= topic.thresholds.min_timeline]
    ] as Array<[string, boolean]>;

    for (const [name, pass] of checks) {
      if (!pass) {
        failed += 1;
        console.error(`FAIL topic=${topic.id} check=${name}`);
      }
    }

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

    if (!quality.pass) {
      failed += quality.failures.length;
      console.error(
        `FAIL topic=${topic.id} quality_failures=${quality.failures.join(',')} metrics=${JSON.stringify(quality.metrics)}`
      );
    }
  }

  if (failed > 0) {
    process.exit(1);
  }

  console.log(`Golden-set passed: ${dataset.topics.length} topics (version=${dataset.version})`);
};

void run();
