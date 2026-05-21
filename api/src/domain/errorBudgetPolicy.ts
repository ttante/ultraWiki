export type ErrorBudgetInput = {
  burnRate5m: number;
  burnRate1h: number;
  burnRate30m: number;
  burnRate6h: number;
  requestsRate1h: number;
  requestsRate6h: number;
};

export type ReleaseDecision = 'allow' | 'restricted' | 'freeze';

export type ErrorBudgetEvaluation = {
  decision: ReleaseDecision;
  reason:
    | 'within_budget'
    | 'insufficient_traffic'
    | 'warning_burn_rate_exceeded'
    | 'critical_burn_rate_exceeded';
};

export type ErrorBudgetPolicy = {
  warningBurnRateThreshold: number;
  criticalBurnRateThreshold: number;
  minTrafficRate1h: number;
  minTrafficRate6h: number;
};

export const defaultErrorBudgetPolicy: ErrorBudgetPolicy = {
  warningBurnRateThreshold: 6,
  criticalBurnRateThreshold: 14.4,
  minTrafficRate1h: 0.01,
  minTrafficRate6h: 0.01
};

export const evaluateErrorBudgetPolicy = (
  input: ErrorBudgetInput,
  policy: ErrorBudgetPolicy = defaultErrorBudgetPolicy
): ErrorBudgetEvaluation => {
  const lowTraffic = input.requestsRate1h <= policy.minTrafficRate1h && input.requestsRate6h <= policy.minTrafficRate6h;
  if (lowTraffic) {
    return { decision: 'allow', reason: 'insufficient_traffic' };
  }

  const critical =
    input.burnRate5m > policy.criticalBurnRateThreshold &&
    input.burnRate1h > policy.criticalBurnRateThreshold &&
    input.requestsRate1h > policy.minTrafficRate1h;

  if (critical) {
    return { decision: 'freeze', reason: 'critical_burn_rate_exceeded' };
  }

  const warning =
    input.burnRate30m > policy.warningBurnRateThreshold &&
    input.burnRate6h > policy.warningBurnRateThreshold &&
    input.requestsRate6h > policy.minTrafficRate6h;

  if (warning) {
    return { decision: 'restricted', reason: 'warning_burn_rate_exceeded' };
  }

  return { decision: 'allow', reason: 'within_budget' };
};
