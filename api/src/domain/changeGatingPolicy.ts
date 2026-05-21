export type ChangeGatingPolicy = {
  requiredChecks: string[];
  protectedPathPrefixes: string[];
  maxOverrideTtlDays: number;
};

export type EmergencyOverride = {
  id: string;
  reason: string;
  requestedBy: string;
  createdAt: string;
  expiresAt: string;
  followUpIssue: string;
};

export type ChangeGateInput = {
  changedFiles: string[];
  workflowChecks: string[];
  overrideId?: string;
  nowIso: string;
  policy: ChangeGatingPolicy;
  overrides: EmergencyOverride[];
};

export type ChangeGateResult = {
  pass: boolean;
  requiresQualityGates: boolean;
  usedOverride: boolean;
  failures: string[];
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const hasValidDate = (value: string): boolean => Number.isFinite(Date.parse(value));

const looksLikeFollowUpIssue = (value: string): boolean => /^#\d+$/.test(value) || /^T\d+\.\d+$/.test(value);

const overlapsProtectedPaths = (changedFiles: string[], prefixes: string[]): boolean =>
  changedFiles.some((file) => prefixes.some((prefix) => file.startsWith(prefix)));

const isExpired = (expiresAt: string, nowIso: string): boolean => Date.parse(expiresAt) <= Date.parse(nowIso);

const validateOverride = (
  override: EmergencyOverride,
  nowIso: string,
  maxOverrideTtlDays: number
): { valid: boolean; failures: string[] } => {
  const failures: string[] = [];

  if (!hasValidDate(override.createdAt)) {
    failures.push(`override=${override.id} invalid createdAt=${override.createdAt}`);
  }
  if (!hasValidDate(override.expiresAt)) {
    failures.push(`override=${override.id} invalid expiresAt=${override.expiresAt}`);
  }
  if (override.reason.trim().length < 10) {
    failures.push(`override=${override.id} reason too short`);
  }
  if (!looksLikeFollowUpIssue(override.followUpIssue.trim())) {
    failures.push(`override=${override.id} followUpIssue must reference ticket id (e.g. #123 or T20.3)`);
  }

  if (failures.length === 0) {
    const createdAtMs = Date.parse(override.createdAt);
    const expiresAtMs = Date.parse(override.expiresAt);
    const ttlDays = (expiresAtMs - createdAtMs) / MS_PER_DAY;
    if (ttlDays <= 0) {
      failures.push(`override=${override.id} expiresAt must be after createdAt`);
    } else if (ttlDays > maxOverrideTtlDays) {
      failures.push(`override=${override.id} ttl_days=${ttlDays.toFixed(2)} exceeds max=${maxOverrideTtlDays}`);
    }
    if (isExpired(override.expiresAt, nowIso)) {
      failures.push(`override=${override.id} expired at ${override.expiresAt}`);
    }
  }

  return { valid: failures.length === 0, failures };
};

export const evaluateChangeGate = (input: ChangeGateInput): ChangeGateResult => {
  const failures: string[] = [];
  const requiresQualityGates = overlapsProtectedPaths(input.changedFiles, input.policy.protectedPathPrefixes);
  const missingChecks = input.policy.requiredChecks.filter((check) => !input.workflowChecks.includes(check));

  // Never allow stale overrides to accumulate in-repo.
  for (const override of input.overrides) {
    if (isExpired(override.expiresAt, input.nowIso)) {
      failures.push(`override=${override.id} expired at ${override.expiresAt}`);
    }
  }

  let usedOverride = false;
  let allowMissingChecksViaOverride = false;

  if (input.overrideId) {
    const selectedOverride = input.overrides.find((override) => override.id === input.overrideId);
    if (!selectedOverride) {
      failures.push(`override id not found: ${input.overrideId}`);
    } else {
      const validation = validateOverride(selectedOverride, input.nowIso, input.policy.maxOverrideTtlDays);
      if (!validation.valid) {
        failures.push(...validation.failures);
      } else {
        usedOverride = true;
        allowMissingChecksViaOverride = true;
      }
    }
  }

  if (requiresQualityGates && missingChecks.length > 0 && !allowMissingChecksViaOverride) {
    failures.push(`missing required checks for protected changes: ${missingChecks.join(', ')}`);
  }

  return {
    pass: failures.length === 0,
    requiresQualityGates,
    usedOverride,
    failures
  };
};
