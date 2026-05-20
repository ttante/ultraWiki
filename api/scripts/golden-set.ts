import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeGroundingStats, generateGroundedSummaries } from '../src/domain/summary.js';
import { generateActiveRecallArtifacts } from '../src/domain/activeRecall.js';
import { generateKnowledgeStructureArtifacts } from '../src/domain/knowledgeStructure.js';

type Fixture = {
  id: string;
  sections: { heading: string; content: string }[];
  thresholds: {
    min_nodes: number;
    min_edges: number;
    min_timeline: number;
    min_citation_rate: number;
  };
};

const loadFixtures = async (): Promise<Fixture[]> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const fixturePath = path.resolve(scriptDir, '../fixtures/golden-set.json');
  const data = await readFile(fixturePath, 'utf8');
  return JSON.parse(data) as Fixture[];
};

const run = async (): Promise<void> => {
  const fixtures = await loadFixtures();
  let failed = 0;

  for (const fixture of fixtures) {
    const summaries = generateGroundedSummaries(fixture.sections);
    const grounding = computeGroundingStats(summaries);
    const recall = generateActiveRecallArtifacts(fixture.sections);
    const knowledge = generateKnowledgeStructureArtifacts(fixture.sections);

    const checks = [
      ['summaries_count', summaries.length === 3],
      ['citation_rate', grounding.citationRate >= fixture.thresholds.min_citation_rate],
      ['flashcards_count', recall.flashcards.length >= 15 && recall.flashcards.length <= 25],
      ['quiz_count', recall.quizQuestions.length >= 10 && recall.quizQuestions.length <= 15],
      ['graph_nodes', knowledge.nodes.length >= fixture.thresholds.min_nodes],
      ['graph_edges', knowledge.edges.length >= fixture.thresholds.min_edges],
      ['timeline_events', knowledge.timeline.length >= fixture.thresholds.min_timeline]
    ] as Array<[string, boolean]>;

    for (const [name, pass] of checks) {
      if (!pass) {
        failed += 1;
        console.error(`FAIL fixture=${fixture.id} check=${name}`);
      }
    }
  }

  if (failed > 0) {
    process.exit(1);
  }

  console.log(`Golden-set passed: ${fixtures.length} fixtures`);
};

void run();
