import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateGoldenSetDataset, type GoldenSetDataset } from '../src/domain/goldenSetDataset.js';

describe('golden set dataset', () => {
  it('is versioned, reproducible, and covers required domains', async () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const datasetPath = path.resolve(testDir, '../fixtures/golden-set.json');
    const dataset = JSON.parse(await readFile(datasetPath, 'utf8')) as GoldenSetDataset;

    const errors = validateGoldenSetDataset(dataset);
    expect(errors).toEqual([]);
  });
});
