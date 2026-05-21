import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateQualityScore } from '../src/domain/qualityScoring.js';

type FixtureCase = {
  id: string;
  thresholds: {
    summaryQualityMin: number;
    citationCoverageMin: number;
    quizValidityMin: number;
    graphCoherenceMin: number;
  };
  input: {
    summaries: Array<{
      level: 'beginner' | 'intermediate' | 'advanced';
      text: string;
      citations: string[];
      promptVersion: string;
      model: string;
    }>;
    citationCoverageRate: number;
    quizQuestions: Array<{
      question: string;
      options: string[];
      correctIndex: number;
      explanation: string;
      citation: string;
      promptVersion: string;
      model: string;
    }>;
    graphNodes: Array<{
      id: string;
      label: string;
      type: 'person' | 'organization' | 'event' | 'concept' | 'place' | 'work';
      citation: string;
    }>;
    graphEdges: Array<{
      source: string;
      target: string;
      relation: 'influenced' | 'founded' | 'member_of' | 'occurred_in' | 'related_to' | 'precedes';
      citation: string;
    }>;
  };
  expected: {
    pass: boolean;
    failures: Array<'summaryQuality' | 'citationCoverage' | 'quizValidity' | 'graphCoherence'>;
  };
};

describe('quality scoring integration fixtures', () => {
  it('matches expected pass/fail outcomes for known fixtures', async () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const fixturePath = path.resolve(testDir, '../fixtures/quality-scoring-fixtures.json');
    const fixtures = JSON.parse(await readFile(fixturePath, 'utf8')) as FixtureCase[];

    for (const fixture of fixtures) {
      const result = evaluateQualityScore(fixture.input, fixture.thresholds);
      expect(result.pass, `fixture ${fixture.id}`).toBe(fixture.expected.pass);
      expect(result.failures, `fixture ${fixture.id}`).toEqual(fixture.expected.failures);
    }
  });
});
