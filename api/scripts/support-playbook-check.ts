import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateSupportPlaybook,
  type TabletopFile
} from '../src/domain/supportPlaybook.js';

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '../..');
  const playbookPath = path.resolve(root, 'infra/support/playbooks/incident-triage.md');
  const tabletopPath = path.resolve(root, 'infra/support/tabletop-exercises.json');
  const nowIso = process.env.SUPPORT_CHECK_NOW_ISO ?? new Date().toISOString();

  const playbook = await readFile(playbookPath, 'utf8');
  const tabletop = JSON.parse(await readFile(tabletopPath, 'utf8')) as TabletopFile;
  const validation = validateSupportPlaybook(playbook, tabletop, nowIso);

  if (!validation.valid) {
    for (const error of validation.errors) {
      console.error(`FAIL ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `Support playbook checks passed: exercises=${validation.exerciseCount} passed=${validation.passedCount}`
  );
};

void run();
