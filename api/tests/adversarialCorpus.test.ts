import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isLikelyWikipediaInput, sanitizeSourceText } from '../src/domain/security.js';

type CorpusCase = {
  id: string;
  input: string;
  expect_flagged: boolean;
  required_signatures: string[];
  sanitized_must_not_contain?: string[];
  expected_wikipedia_input: boolean;
};

describe('adversarial corpus', () => {
  it('maintains expected sanitizer and input validation behavior', async () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const corpusPath = path.resolve(testDir, '../../infra/evaluation/adversarial-corpus.json');
    const raw = JSON.parse(await readFile(corpusPath, 'utf8')) as { cases: CorpusCase[] };

    for (const testCase of raw.cases) {
      const sanitized = sanitizeSourceText(testCase.input);
      const wikiInput = isLikelyWikipediaInput(testCase.input);

      expect(sanitized.flagged, `case ${testCase.id}`).toBe(testCase.expect_flagged);
      expect(wikiInput, `case ${testCase.id}`).toBe(testCase.expected_wikipedia_input);
      for (const signature of testCase.required_signatures) {
        expect(sanitized.signatures, `case ${testCase.id}`).toContain(signature);
      }
      for (const forbidden of testCase.sanitized_must_not_contain ?? []) {
        expect(sanitized.sanitized.toLowerCase(), `case ${testCase.id}`).not.toContain(forbidden.toLowerCase());
      }
    }
  });
});
