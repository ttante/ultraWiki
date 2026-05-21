import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type TabletopFile = {
  version: string;
  exercises: Array<{
    id: string;
    scenario: string;
    executed_at: string;
    outcome: 'passed' | 'failed';
    facilitator: string;
    notes: string;
  }>;
};

const requiredHeadings = [
  '## Common Failure: Timeouts',
  '## Common Failure: Malformed Pages',
  '## Common Failure: Model Overload',
  '## Escalation Procedure',
  '## Rollback Procedure'
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '../..');
  const playbookPath = path.resolve(root, 'infra/support/playbooks/incident-triage.md');
  const tabletopPath = path.resolve(root, 'infra/support/tabletop-exercises.json');
  const nowIso = process.env.SUPPORT_CHECK_NOW_ISO ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);

  const playbook = await readFile(playbookPath, 'utf8');
  const tabletop = JSON.parse(await readFile(tabletopPath, 'utf8')) as TabletopFile;

  let failed = 0;
  for (const heading of requiredHeadings) {
    if (!playbook.includes(heading)) {
      failed += 1;
      console.error(`FAIL playbook missing heading: ${heading}`);
    }
  }

  const passed = tabletop.exercises.filter((entry) => entry.outcome === 'passed');
  if (passed.length === 0) {
    failed += 1;
    console.error('FAIL no passed tabletop exercises recorded');
  }

  const newestMs = Math.max(
    0,
    ...tabletop.exercises
      .map((entry) => Date.parse(entry.executed_at))
      .filter((value) => Number.isFinite(value))
  );

  if (newestMs === 0) {
    failed += 1;
    console.error('FAIL tabletop executed_at values are invalid');
  } else {
    const ageDays = (nowMs - newestMs) / MS_PER_DAY;
    if (ageDays > 90) {
      failed += 1;
      console.error(`FAIL newest tabletop exercise is stale age_days=${ageDays.toFixed(2)} max=90`);
    }
  }

  for (const exercise of tabletop.exercises) {
    if (exercise.notes.trim().length < 20) {
      failed += 1;
      console.error(`FAIL tabletop ${exercise.id} notes too short`);
    }
  }

  if (failed > 0) {
    process.exit(1);
  }

  console.log(`Support playbook checks passed: exercises=${tabletop.exercises.length} passed=${passed.length}`);
};

void run();
