import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateReleaseDataOpsPlan,
  type ReleaseDataOpsPlan
} from '../src/domain/releaseDataOps.js';

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '../..');
  const planPath = path.resolve(root, 'infra/ops/release-data-ops.json');
  const plan = JSON.parse(await readFile(planPath, 'utf8')) as ReleaseDataOpsPlan;
  const validation = validateReleaseDataOpsPlan(plan);
  let failed = 0;

  for (const error of validation.errors) {
    failed += 1;
    console.error(`FAIL ${error}`);
  }

  for (const check of plan.checks) {
    for (const artifact of check.artifacts) {
      try {
        await stat(path.resolve(root, artifact));
      } catch {
        failed += 1;
        console.error(`FAIL check=${check.id} artifact missing: ${artifact}`);
      }
    }
  }

  if (failed > 0) {
    process.exit(1);
  }

  console.log(`Release data-ops checks passed: checks=${plan.checks.length}`);
};

void run();
