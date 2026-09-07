export type SloTarget = {
  id: string;
  name: string;
  metric: string;
  promql: string;
  target: number;
  comparator: '<=' | '>=';
  window: string;
  owner: string;
};

export type SloCurrentValues = {
  p95_time_to_first_artifact_ms: number;
  p95_full_pack_completion_ms: number;
  job_success_rate: number;
  citation_coverage_rate: number;
};

export type SloStatus = {
  id: string;
  name: string;
  current_value: number;
  target: number;
  comparator: '<=' | '>=';
  passed: boolean;
  error_budget_burn: number;
};

export const sloTargets: SloTarget[] = [
  {
    id: 'time_to_first_artifact_p95',
    name: 'P95 time to first artifact',
    metric: 'ultrawiki_slo_time_to_first_artifact_p95_ms',
    promql: 'ultrawiki_slo_time_to_first_artifact_p95_ms',
    target: 30000,
    comparator: '<=',
    window: '30d',
    owner: 'reliability'
  },
  {
    id: 'full_pack_completion_p95',
    name: 'P95 full pack completion',
    metric: 'ultrawiki_slo_full_pack_completion_p95_ms',
    promql: 'ultrawiki_slo_full_pack_completion_p95_ms',
    target: 60000,
    comparator: '<=',
    window: '30d',
    owner: 'reliability'
  },
  {
    id: 'job_success_rate',
    name: 'Job success rate',
    metric: 'ultrawiki_slo_job_success_rate',
    promql: 'ultrawiki_slo_job_success_rate',
    target: 0.99,
    comparator: '>=',
    window: '30d',
    owner: 'reliability'
  },
  {
    id: 'citation_coverage_rate',
    name: 'Citation coverage rate',
    metric: 'ultrawiki_slo_citation_coverage_rate',
    promql: 'ultrawiki_slo_citation_coverage_rate',
    target: 0.85,
    comparator: '>=',
    window: '30d',
    owner: 'content-quality'
  }
];

export const getSloCurrentValue = (current: SloCurrentValues, targetId: string): number => {
  switch (targetId) {
    case 'time_to_first_artifact_p95':
      return current.p95_time_to_first_artifact_ms;
    case 'full_pack_completion_p95':
      return current.p95_full_pack_completion_ms;
    case 'job_success_rate':
      return current.job_success_rate;
    case 'citation_coverage_rate':
      return current.citation_coverage_rate;
    default:
      return 0;
  }
};

export const computeSloErrorBudgetBurn = (currentValue: number, target: number, comparator: '<=' | '>='): number => {
  if (target <= 0) {
    return 0;
  }

  if (comparator === '<=') {
    return Math.max(0, currentValue / target);
  }

  const budget = Math.max(0.000001, 1 - target);
  return Math.max(0, (target - currentValue) / budget);
};

export const evaluateSloTarget = (target: SloTarget, currentValue: number): SloStatus => {
  const passed = target.comparator === '<=' ? currentValue <= target.target : currentValue >= target.target;
  return {
    id: target.id,
    name: target.name,
    current_value: currentValue,
    target: target.target,
    comparator: target.comparator,
    passed,
    error_budget_burn: computeSloErrorBudgetBurn(currentValue, target.target, target.comparator)
  };
};

export const buildSloStatuses = (current: SloCurrentValues, targets: SloTarget[] = sloTargets): SloStatus[] =>
  targets.map((target) => evaluateSloTarget(target, getSloCurrentValue(current, target.id)));
