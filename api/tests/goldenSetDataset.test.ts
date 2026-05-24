import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  requiredGoldenSetDomains,
  validateGoldenSetDataset,
  type GoldenSetDataset
} from '../src/domain/goldenSetDataset.js';

describe('golden set dataset', () => {
  it('is versioned, reproducible, and covers required domains', async () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const datasetPath = path.resolve(testDir, '../fixtures/golden-set.json');
    const dataset = JSON.parse(await readFile(datasetPath, 'utf8')) as GoldenSetDataset;

    const errors = validateGoldenSetDataset(dataset);
    expect(errors).toEqual([]);
    expect(dataset.topics.map((topic) => topic.domain).sort()).toEqual([...requiredGoldenSetDomains].sort());
    expect(dataset.topics.every((topic) => topic.canonical_url.startsWith('https://en.wikipedia.org/wiki/'))).toBe(true);
    expect(dataset.topics.every((topic) => topic.source_revision_id.length > 0)).toBe(true);
  });
});
