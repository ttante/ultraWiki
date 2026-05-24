import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import {
  costAnalyticsSchema,
  createStudyPackRequestSchema,
  createStudyPackResponseSchema,
  outcomesAnalyticsSchema,
  queueStatusSchema,
  quizAttemptRequestSchema,
  quizAttemptResponseSchema,
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
  { id: 'outcomes-analytics', file: 'outcomes-analytics.json', schema: outcomesAnalyticsSchema },
  { id: 'cost-analytics', file: 'cost-analytics.json', schema: costAnalyticsSchema },
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
