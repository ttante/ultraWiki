import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBenchmarkHarness, type BenchmarkHarnessResult } from '../src/domain/benchmarkHarness.js';
import {
  evaluateBenchmarkRegression,
  validateBenchmarkWaiverFile,
  type BenchmarkBaseline,
  type BenchmarkWaiverFile
} from '../src/domain/benchmarkRegression.js';

const sampleSections = [
  {
    heading: 'Sample',
    content:
      'In 1950 Alan Turing influenced John McCarthy. In 1956 John McCarthy founded AI Laboratory. The Dartmouth Conference occurred in 1956. In 1969 ARPANET preceded modern Internet systems.'
  }
];

const toInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const baselinePath = path.resolve(scriptDir, '../benchmarks/baseline.json');
  const waiverPath = path.resolve(scriptDir, '../../infra/evaluation/benchmark-waivers.json');
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as BenchmarkBaseline;
  const waiverFile = JSON.parse(await readFile(waiverPath, 'utf8')) as BenchmarkWaiverFile;
  const nowIso = process.env.BENCH_NOW_ISO ?? new Date().toISOString();
  const waiverFileFailures = validateBenchmarkWaiverFile(waiverFile, nowIso);
  if (waiverFileFailures.length > 0) {
    for (const failure of waiverFileFailures) {
      console.error(`FAIL ${failure}`);
    }
    process.exit(1);
  }

  const current: BenchmarkHarnessResult = runBenchmarkHarness({
    runtimeProfile: process.env.BENCH_RUNTIME_PROFILE ?? baseline.runtimeProfile,
    promptVersions: {
      summarization: 'summary-by-level@1.0.0',
      activeRecall: 'active-recall@1.0.0',
      knowledgeStructure: 'knowledge-structure-rules@1.0.0'
    },
    sections: sampleSections,
    iterations: toInt(process.env.BENCH_ITERATIONS, 25),
    memoryLimitMb: toInt(process.env.BENCH_MEMORY_LIMIT_MB, 12 * 1024),
    model: process.env.BENCH_MODEL ?? 'local-rule-based'
  });

  const reportPath = path.resolve(scriptDir, '../benchmarks/latest.json');
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        current
      },
      null,
      2
    )
  );

  const requestedWaiverId = process.env.BENCH_WAIVER_ID;
  const waiver = requestedWaiverId ? waiverFile.waivers.find((entry) => entry.id === requestedWaiverId) : undefined;
  if (requestedWaiverId && !waiver) {
    console.error(`FAIL waiver not found: ${requestedWaiverId}`);
    process.exit(1);
  }

  const regression = evaluateBenchmarkRegression(current, baseline, nowIso, waiver);
  if (!regression.pass) {
    for (const failure of regression.failures) {
      console.error(`FAIL ${failure}`);
    }
    process.exit(1);
  }

  if (regression.waived) {
    console.log(`Benchmark regression waived via BENCH_WAIVER_ID=${waiver?.id}`);
  } else {
    console.log('Benchmark regression gate passed');
  }
  console.log(JSON.stringify(current, null, 2));
};

void run();
