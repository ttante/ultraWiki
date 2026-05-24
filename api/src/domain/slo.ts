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
