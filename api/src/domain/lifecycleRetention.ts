export const lifecycleRetentionScopes = [
  'logs',
  'traces',
  'idempotency_keys',
  'jobs_failed_or_quarantined',
  'artifacts_and_packs',
  'cost_telemetry',
  'user_profiles',
  'share_links',
  'learning_reviews'
] as const;

export type LifecycleRetentionScope = (typeof lifecycleRetentionScopes)[number];
export type LifecycleRetentionEnforcementMode = 'db_function' | 'external_control';

export type LifecycleRetentionPolicy = {
  version: string;
  retention_days: Record<LifecycleRetentionScope, number>;
  enforcement: Array<{
    scope: LifecycleRetentionScope;
    mode: LifecycleRetentionEnforcementMode;
    control: string;
  }>;
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
const knownRetentionScopes = new Set<string>(lifecycleRetentionScopes);
const databaseBackedScopes = new Set<LifecycleRetentionScope>([
  'idempotency_keys',
  'jobs_failed_or_quarantined',
  'artifacts_and_packs',
  'cost_telemetry',
  'user_profiles',
  'share_links',
  'learning_reviews'
]);

export const validateLifecycleRetentionPolicy = (
  policy: LifecycleRetentionPolicy
): LifecycleRetentionValidation => {
  const errors: string[] = [];
  const days = policy.retention_days;

  for (const scope of lifecycleRetentionScopes) {
    if (!(scope in days)) {
      errors.push(`retention_days.${scope} is required`);
    }
  }

  for (const [key, value] of Object.entries(days)) {
    if (!knownRetentionScopes.has(key)) {
      errors.push(`retention_days.${key} is not a known retention scope`);
      continue;
    }
    if (!isPositiveInt(value)) {
      errors.push(`retention_days.${key} must be an integer >= 1`);
    }
  }

  if (days.artifacts_and_packs < days.jobs_failed_or_quarantined) {
    errors.push('retention_days.artifacts_and_packs must be >= retention_days.jobs_failed_or_quarantined');
  }

  if (days.user_profiles < days.learning_reviews) {
    errors.push('retention_days.user_profiles must be >= retention_days.learning_reviews');
  }

  if (policy.exceptions.length === 0) {
    errors.push('at least one policy exception must be documented');
  }

  if (!Array.isArray(policy.enforcement) || policy.enforcement.length === 0) {
    errors.push('retention enforcement controls are required for every scope');
  } else {
    const enforcementScopes = new Set<string>();
    for (const control of policy.enforcement) {
      if (!knownRetentionScopes.has(control.scope)) {
        errors.push(`enforcement.${control.scope} is not a known retention scope`);
        continue;
      }
      if (control.mode !== 'db_function' && control.mode !== 'external_control') {
        errors.push(`enforcement.${control.scope} mode must be db_function or external_control`);
      }
      if (control.control.trim().length < 10) {
        errors.push(`enforcement.${control.scope} control must be at least 10 characters`);
      }
      if (enforcementScopes.has(control.scope)) {
        errors.push(`enforcement.${control.scope} is duplicated`);
      }
      enforcementScopes.add(control.scope);
      if (databaseBackedScopes.has(control.scope) && control.mode !== 'db_function') {
        errors.push(`enforcement.${control.scope} must use db_function`);
      }
    }

    for (const scope of lifecycleRetentionScopes) {
      if (!enforcementScopes.has(scope)) {
        errors.push(`enforcement.${scope} is required`);
      }
    }
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
