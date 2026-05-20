import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateGroundedSummaries } from '../src/domain/summary.js';
import { generateActiveRecallArtifacts } from '../src/domain/activeRecall.js';
import { generateKnowledgeStructureArtifacts } from '../src/domain/knowledgeStructure.js';

type Baseline = {
  version: number;
  max_ratio: number;
  metrics: Record<string, number>;
};

const sampleSections = [
  {
    heading: 'Sample',
    content:
      'In 1950 Alan Turing influenced John McCarthy. In 1956 John McCarthy founded AI Laboratory. The Dartmouth Conference occurred in 1956. In 1969 ARPANET preceded modern Internet systems.'
  }
];

const timeMs = (fn: () => void): number => {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1_000_000;
};

const averageMs = (fn: () => void, iterations: number): number => {
  let total = 0;
  for (let i = 0; i < iterations; i += 1) {
    total += timeMs(fn);
  }
  return total / iterations;
};

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const baselinePath = path.resolve(scriptDir, '../benchmarks/baseline.json');
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as Baseline;

  const current = {
    summaries_ms: averageMs(() => {
      generateGroundedSummaries(sampleSections);
    }, 25),
    active_recall_ms: averageMs(() => {
      generateActiveRecallArtifacts(sampleSections);
    }, 25),
    knowledge_structure_ms: averageMs(() => {
      generateKnowledgeStructureArtifacts(sampleSections);
    }, 25)
  };

  const reportPath = path.resolve(scriptDir, '../benchmarks/latest.json');
  await writeFile(reportPath, JSON.stringify({ generated_at: new Date().toISOString(), current }, null, 2));

  let failed = 0;
  for (const [metric, baselineValue] of Object.entries(baseline.metrics)) {
    const value = current[metric as keyof typeof current];
    const maxAllowed = baselineValue * baseline.max_ratio;
    if (value > maxAllowed) {
      console.error(`FAIL ${metric}: current=${value.toFixed(3)}ms max=${maxAllowed.toFixed(3)}ms`);
      failed += 1;
    }
  }

  if (failed > 0) {
    process.exit(1);
  }

  console.log('Benchmark regression gate passed');
  console.log(JSON.stringify(current, null, 2));
};

void run();
