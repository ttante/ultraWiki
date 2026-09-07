export type ReleaseDataOpsCheck = {
  id: string;
  gate: string;
  ticket_ids: string[];
  artifacts: string[];
};

export type ReleaseDataOpsPlan = {
  version: string;
  checks: ReleaseDataOpsCheck[];
};

export type ReleaseDataOpsValidation = {
  valid: boolean;
  errors: string[];
};

const requiredChecks = new Map<string, string[]>([
  ['migration-safety', ['T15.2', 'T10.2']],
  ['lifecycle-retention', ['T19.1', 'T10.2', 'T25.1']],
  ['backup-restore-drill', ['T19.2', 'T10.2', 'T25.4']]
]);

export const validateReleaseDataOpsPlan = (plan: ReleaseDataOpsPlan): ReleaseDataOpsValidation => {
  const errors: string[] = [];
  const seen = new Set<string>();

  if (!plan.version || plan.version.trim().length === 0) {
    errors.push('version is required');
  }

  if (!Array.isArray(plan.checks) || plan.checks.length === 0) {
    errors.push('checks are required');
    return { valid: false, errors };
  }

  for (const check of plan.checks) {
    if (seen.has(check.id)) {
      errors.push(`duplicate check id: ${check.id}`);
    }
    seen.add(check.id);

    if (!check.gate.startsWith('npm run gate:')) {
      errors.push(`check=${check.id} gate must be an npm gate command`);
    }
    if (check.ticket_ids.length === 0) {
      errors.push(`check=${check.id} must link at least one ticket`);
    }
    if (check.artifacts.length === 0) {
      errors.push(`check=${check.id} must link at least one artifact`);
    }
  }

  for (const [requiredId, requiredTickets] of requiredChecks) {
    const check = plan.checks.find((entry) => entry.id === requiredId);
    if (!check) {
      errors.push(`missing required data-ops check: ${requiredId}`);
      continue;
    }
    for (const ticket of requiredTickets) {
      if (!check.ticket_ids.includes(ticket)) {
        errors.push(`check=${requiredId} missing ticket link: ${ticket}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
};
