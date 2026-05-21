import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluatePromptRegression, type PromptRegressionRun, type PromptRegressionThresholds } from '../src/domain/promptEvaluation.js';

type FixtureCase = {
  id: string;
  thresholds: PromptRegressionThresholds;
  runs: PromptRegressionRun[];
  expected: {
    pass: boolean;
    failedTopics: string[];
  };
};

describe('prompt evaluation integration fixtures', () => {
  it('matches expected pass/fail behavior', async () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const fixturePath = path.resolve(testDir, '../fixtures/prompt-regression-fixtures.json');
    const fixtures = JSON.parse(await readFile(fixturePath, 'utf8')) as FixtureCase[];

    for (const fixture of fixtures) {
      const result = evaluatePromptRegression(fixture.runs, fixture.thresholds);
      expect(result.pass, `fixture ${fixture.id}`).toBe(fixture.expected.pass);
      expect(
        result.failedTopics.map((topic) => topic.topicId).sort(),
        `fixture ${fixture.id}`
      ).toEqual(fixture.expected.failedTopics.sort());
    }
  });
});
