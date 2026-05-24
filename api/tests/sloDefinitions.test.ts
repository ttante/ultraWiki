import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sloTargets } from '../src/domain/slo.js';

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
});
