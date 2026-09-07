import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZodTypeAny } from 'zod';
import {
  costAnalyticsSchema,
  costDrilldownAnalyticsSchema,
  createStudyPackRequestSchema,
  createStudyPackResponseSchema,
  learningAnalyticsSchema,
  localLlmRuntimeHealthSchema,
  outcomesAnalyticsSchema,
  promptEvaluationSchema,
  queueStatusSchema,
  quizAttemptRequestSchema,
  quizAttemptResponseSchema,
  realModelSmokeStatusSchema,
  runtimePresetVisibilitySchema,
  sloAnalyticsSchema,
  studyPackSchema
} from '../src/contracts/studyPack.js';

const snapshots: Array<{ file: string; schema: ZodTypeAny }> = [
  { file: 'create-study-pack-request.json', schema: createStudyPackRequestSchema },
  { file: 'create-study-pack-response.json', schema: createStudyPackResponseSchema },
  { file: 'study-pack.json', schema: studyPackSchema },
  { file: 'queue-status.json', schema: queueStatusSchema },
  { file: 'quiz-attempt-request.json', schema: quizAttemptRequestSchema },
  { file: 'quiz-attempt-response.json', schema: quizAttemptResponseSchema },
  { file: 'learning-analytics.json', schema: learningAnalyticsSchema },
  { file: 'local-llm-runtime-health.json', schema: localLlmRuntimeHealthSchema },
  { file: 'runtime-preset-visibility.json', schema: runtimePresetVisibilitySchema },
  { file: 'prompt-evaluation.json', schema: promptEvaluationSchema },
  { file: 'real-model-smoke-status.json', schema: realModelSmokeStatusSchema },
  { file: 'outcomes-analytics.json', schema: outcomesAnalyticsSchema },
  { file: 'cost-analytics.json', schema: costAnalyticsSchema },
  { file: 'cost-drilldown-analytics.json', schema: costDrilldownAnalyticsSchema },
  { file: 'slo-analytics.json', schema: sloAnalyticsSchema }
];

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '../..');
  const snapshotDir = path.resolve(root, 'api/fixtures/contracts');
  const workflowDocPath = path.resolve(root, 'docs/ui-fixture-update-workflow.md');
  const files = new Set(await readdir(snapshotDir));
  const workflowDoc = await readFile(workflowDocPath, 'utf8');
  let failed = 0;

  for (const snapshot of snapshots) {
    if (!files.has(snapshot.file)) {
      failed += 1;
      console.error(`FAIL missing contract snapshot: ${snapshot.file}`);
      continue;
    }
    const payload = JSON.parse(await readFile(path.resolve(snapshotDir, snapshot.file), 'utf8'));
    const result = snapshot.schema.safeParse(payload);
    if (!result.success) {
      failed += 1;
      console.error(`FAIL invalid contract snapshot: ${snapshot.file}`);
    }
  }

  for (const file of files) {
    if (!snapshots.some((snapshot) => snapshot.file === file)) {
      failed += 1;
      console.error(`FAIL unknown contract snapshot without validator: ${file}`);
    }
  }

  for (const requiredText of ['npm run gate:contracts', 'api/fixtures/contracts', 'web/tests']) {
    if (!workflowDoc.includes(requiredText)) {
      failed += 1;
      console.error(`FAIL UI fixture workflow doc missing: ${requiredText}`);
    }
  }

  if (failed > 0) {
    process.exit(1);
  }

  console.log(`Contract snapshot validation passed: snapshots=${snapshots.length}`);
};

void run();
