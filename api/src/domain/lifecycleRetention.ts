export type LifecycleRetentionPolicy = {
  version: string;
  retention_days: {
    logs: number;
    traces: number;
    idempotency_keys: number;
    jobs_failed_or_quarantined: number;
    artifacts_and_packs: number;
    cost_telemetry: number;
  };
  exceptions: Array<{
    scope: string;
    retention_days: number;
    reason: string;
  }>;
};

export type LifecycleRetentionValidation = {
  valid: boolean;
  errors: string[];
};

const isPositiveInt = (value: number): boolean => Number.isInteger(value) && value >= 1;

export const validateLifecycleRetentionPolicy = (
  policy: LifecycleRetentionPolicy
): LifecycleRetentionValidation => {
  const errors: string[] = [];
  const days = policy.retention_days;

  for (const [key, value] of Object.entries(days)) {
    if (!isPositiveInt(value)) {
      errors.push(`retention_days.${key} must be an integer >= 1`);
    }
  }

  if (days.artifacts_and_packs < days.jobs_failed_or_quarantined) {
    errors.push('retention_days.artifacts_and_packs must be >= retention_days.jobs_failed_or_quarantined');
  }

  if (policy.exceptions.length === 0) {
    errors.push('at least one policy exception must be documented');
  }

  for (const exception of policy.exceptions) {
    if (exception.scope.trim().length === 0) {
      errors.push('exception scope is required');
    }
    if (!isPositiveInt(exception.retention_days)) {
      errors.push(`exception ${exception.scope} retention_days must be an integer >= 1`);
    }
    if (exception.reason.trim().length < 10) {
      errors.push(`exception ${exception.scope} reason must be at least 10 characters`);
    }
  }

  return { valid: errors.length === 0, errors };
};
