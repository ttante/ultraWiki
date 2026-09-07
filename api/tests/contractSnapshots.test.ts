import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
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
  realModelSmokeStatusSchema,
  quizAttemptRequestSchema,
  quizAttemptResponseSchema,
  runtimePresetVisibilitySchema,
  sloAnalyticsSchema,
  studyPackSchema
} from '../src/contracts/studyPack.js';

const contractSnapshots: Array<{ id: string; file: string; schema: ZodTypeAny }> = [
  { id: 'create-study-pack-request', file: 'create-study-pack-request.json', schema: createStudyPackRequestSchema },
  { id: 'create-study-pack-response', file: 'create-study-pack-response.json', schema: createStudyPackResponseSchema },
  { id: 'study-pack', file: 'study-pack.json', schema: studyPackSchema },
  { id: 'queue-status', file: 'queue-status.json', schema: queueStatusSchema },
  { id: 'quiz-attempt-request', file: 'quiz-attempt-request.json', schema: quizAttemptRequestSchema },
  { id: 'quiz-attempt-response', file: 'quiz-attempt-response.json', schema: quizAttemptResponseSchema },
  { id: 'learning-analytics', file: 'learning-analytics.json', schema: learningAnalyticsSchema },
  { id: 'local-llm-runtime-health', file: 'local-llm-runtime-health.json', schema: localLlmRuntimeHealthSchema },
  { id: 'runtime-preset-visibility', file: 'runtime-preset-visibility.json', schema: runtimePresetVisibilitySchema },
  { id: 'prompt-evaluation', file: 'prompt-evaluation.json', schema: promptEvaluationSchema },
  { id: 'real-model-smoke-status', file: 'real-model-smoke-status.json', schema: realModelSmokeStatusSchema },
  { id: 'outcomes-analytics', file: 'outcomes-analytics.json', schema: outcomesAnalyticsSchema },
  { id: 'cost-analytics', file: 'cost-analytics.json', schema: costAnalyticsSchema },
  { id: 'cost-drilldown-analytics', file: 'cost-drilldown-analytics.json', schema: costDrilldownAnalyticsSchema },
  { id: 'slo-analytics', file: 'slo-analytics.json', schema: sloAnalyticsSchema }
];

describe('contract snapshots', () => {
  it.each(contractSnapshots)('keeps $id compatible with its zod contract', async ({ file, schema }) => {
    const fixturePath = path.resolve(process.cwd(), 'fixtures/contracts', file);
    const parsed = JSON.parse(await readFile(fixturePath, 'utf8'));
    const result = schema.safeParse(parsed);
    expect(result.success).toBe(true);
  });
});
