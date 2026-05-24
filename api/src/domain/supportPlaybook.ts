export const requiredSupportPlaybookHeadings = [
  '## Common Failure: Timeouts',
  '## Common Failure: Malformed Pages',
  '## Common Failure: Model Overload',
  '## Escalation Procedure',
  '## Rollback Procedure'
] as const;

export const requiredTabletopScenarios = ['timeouts', 'malformed_pages', 'model_overload'] as const;

export type TabletopScenario = (typeof requiredTabletopScenarios)[number];

export type TabletopExercise = {
  id: string;
  scenario: string;
  executed_at: string;
  outcome: 'passed' | 'failed';
  facilitator: string;
  notes: string;
};

export type TabletopFile = {
  version: string;
  exercises: TabletopExercise[];
};

export type SupportPlaybookValidation = {
  valid: boolean;
  errors: string[];
  exerciseCount: number;
  passedCount: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const validateSupportPlaybook = (
  playbook: string,
  tabletop: TabletopFile,
  nowIso: string
): SupportPlaybookValidation => {
  const errors: string[] = [];
  const nowMs = Date.parse(nowIso);

  for (const heading of requiredSupportPlaybookHeadings) {
    if (!playbook.includes(heading)) {
      errors.push(`playbook missing heading: ${heading}`);
    }
  }

  if (!Number.isFinite(nowMs)) {
    errors.push('nowIso is invalid');
  }

  const passed = tabletop.exercises.filter((entry) => entry.outcome === 'passed');
  if (passed.length === 0) {
    errors.push('no passed tabletop exercises recorded');
  }

  const passedScenarios = new Set(passed.map((entry) => entry.scenario));
  for (const scenario of requiredTabletopScenarios) {
    if (!passedScenarios.has(scenario)) {
      errors.push(`no passed tabletop exercise for scenario=${scenario}`);
    }
  }

  const executedTimes = tabletop.exercises.map((entry) => ({
    id: entry.id,
    value: Date.parse(entry.executed_at)
  }));
  const validExecutedTimes = executedTimes.filter((entry) => Number.isFinite(entry.value));
  const newestMs = Math.max(0, ...validExecutedTimes.map((entry) => entry.value));

  if (tabletop.exercises.length === 0) {
    errors.push('no tabletop exercises recorded');
  } else if (validExecutedTimes.length === 0) {
    errors.push('tabletop executed_at values are invalid');
  }

  for (const entry of executedTimes) {
    if (!Number.isFinite(entry.value)) {
      errors.push(`tabletop ${entry.id} executed_at is invalid`);
    } else if (Number.isFinite(nowMs) && entry.value > nowMs) {
      errors.push(`tabletop ${entry.id} executed_at is in the future`);
    }
  }

  if (newestMs > 0 && Number.isFinite(nowMs)) {
    const ageDays = (nowMs - newestMs) / MS_PER_DAY;
    if (ageDays > 90) {
      errors.push(`newest tabletop exercise is stale age_days=${ageDays.toFixed(2)} max=90`);
    }
  }

  for (const exercise of tabletop.exercises) {
    if (exercise.id.trim().length === 0) {
      errors.push('tabletop exercise id is required');
    }
    if (exercise.scenario.trim().length === 0) {
      errors.push(`tabletop ${exercise.id} scenario is required`);
    }
    if (exercise.outcome !== 'passed' && exercise.outcome !== 'failed') {
      errors.push(`tabletop ${exercise.id} outcome must be passed or failed`);
    }
    if (exercise.facilitator.trim().length === 0) {
      errors.push(`tabletop ${exercise.id} facilitator is required`);
    }
    if (exercise.notes.trim().length < 20) {
      errors.push(`tabletop ${exercise.id} notes too short`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    exerciseCount: tabletop.exercises.length,
    passedCount: passed.length
  };
};
