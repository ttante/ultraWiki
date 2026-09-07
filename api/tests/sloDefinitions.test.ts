import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSloStatuses, computeSloErrorBudgetBurn, evaluateSloTarget, sloTargets } from '../src/domain/slo.js';

describe('SLO definitions', () => {
  it('keeps checked-in monitoring definitions aligned with API SLO targets', () => {
    const definitions = JSON.parse(readFileSync('../infra/monitoring/slo-definitions.json', 'utf8')) as {
      slos: typeof sloTargets;
    };
    const queries = readFileSync('../infra/monitoring/slo-queries.promql', 'utf8');
    const dashboard = readFileSync('../infra/monitoring/grafana/outcomes-dashboard.json', 'utf8');

    expect(definitions.slos).toEqual(sloTargets);
    for (const target of sloTargets) {
      expect(queries).toContain(target.promql);
      expect(dashboard).toContain(target.metric);
    }
  });

  it('documents dashboard panels and alerts for operational metrics', () => {
    const dashboard = readFileSync('../infra/monitoring/grafana/outcomes-dashboard.json', 'utf8');
    const alerts = readFileSync('../infra/monitoring/prometheus/alerts/outcomes-slo-alerts.yml', 'utf8');
    const runbook = readFileSync('../infra/monitoring/runbooks/outcomes-slo-alerts.md', 'utf8');

    for (const metric of [
      'ultrawiki_queue_depth',
      'ultrawiki_degraded_job_rate',
      'ultrawiki_cache_hit_rate',
      'ultrawiki_stage_latency_avg_ms',
      'ultrawiki_cost_estimated_avg_usd_per_pack'
    ]) {
      expect(dashboard).toContain(metric);
    }

    for (const alert of [
      'UltraWikiQueueSaturated',
      'UltraWikiDegradedOutputRateHigh',
      'UltraWikiCacheHitRateLow',
      'UltraWikiStageLatencyHigh'
    ]) {
      expect(alerts).toContain(`alert: ${alert}`);
      expect(runbook).toContain(`### ${alert}`);
    }
  });

  it('evaluates SLO pass/fail and burn consistently for latency and rate targets', () => {
    expect(computeSloErrorBudgetBurn(15000, 30000, '<=')).toBe(0.5);
    expect(computeSloErrorBudgetBurn(45000, 30000, '<=')).toBe(1.5);
    expect(computeSloErrorBudgetBurn(0.98, 0.99, '>=')).toBeCloseTo(1, 6);
    expect(computeSloErrorBudgetBurn(0.8, 0.99, '>=')).toBeCloseTo(19, 6);

    const failedTarget = evaluateSloTarget(
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
      0.8
    );
    expect(failedTarget).toMatchObject({
      passed: false,
      current_value: 0.8,
      target: 0.99
    });
    expect(failedTarget.error_budget_burn).toBeCloseTo(19, 6);
  });

  it('builds the API SLO status matrix from checked-in targets', () => {
    const statuses = buildSloStatuses({
      p95_time_to_first_artifact_ms: 15000,
      p95_full_pack_completion_ms: 90000,
      job_success_rate: 1,
      citation_coverage_rate: 0.7
    });

    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'time_to_first_artifact_p95', passed: true, error_budget_burn: 0.5 }),
        expect.objectContaining({ id: 'full_pack_completion_p95', passed: false, error_budget_burn: 1.5 }),
        expect.objectContaining({ id: 'job_success_rate', passed: true, error_budget_burn: 0 }),
        expect.objectContaining({ id: 'citation_coverage_rate', passed: false })
      ])
    );
    expect(statuses.find((status) => status.id === 'citation_coverage_rate')?.error_budget_burn).toBeCloseTo(1, 6);
  });
});
