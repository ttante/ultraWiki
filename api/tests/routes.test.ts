import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import httpMocks from 'node-mocks-http';
import { buildApp } from '../src/app.js';
import { memoryRepo } from '../src/repo/memoryRepo.js';

process.env.DISABLE_HTTP_LOGGER = '1';
process.env.DISABLE_QUEUE_POLLING = '1';
process.env.USE_MEMORY_REPO = '1';
const app = buildApp();

const invoke = async (
  method: 'GET' | 'POST',
  url: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<{ status: number; body: any }> => {
  const req = httpMocks.createRequest({
    method,
    url,
    body: body as any,
    headers
  });

  const res = httpMocks.createResponse({
    eventEmitter: EventEmitter
  });

  await new Promise<void>((resolve) => {
    res.on('end', () => resolve());
    (app as any).handle(req, res);
  });

  return {
    status: res.statusCode,
    body: (() => {
      const contentType = String(res.getHeader('content-type') ?? '');
      if (contentType.includes('application/json')) {
        return res._getJSONData();
      }
      return res._getData();
    })()
  };
};

describe('api routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    memoryRepo.resetForTests();
  });

  it('returns health', async () => {
    const res = await invoke('GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('creates study pack and supports idempotency key reuse', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          parse: {
            revid: 123,
            title: 'Alan Turing',
            text: { '*': '<p>Alan Mathison Turing was a mathematician.</p>' }
          }
        })
      }) as unknown as typeof fetch
    );

    const payload = {
      title_or_url: 'Alan Turing',
      idempotency_key: 'idem-abc-12345'
    };

    const first = await invoke('POST', '/api/study-packs', payload, { 'x-session-id': 's1' });
    const second = await invoke('POST', '/api/study-packs', payload, { 'x-session-id': 's1' });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(first.body.pack_id).toBe(second.body.pack_id);
    expect(first.body.job_id).toBe(second.body.job_id);

    for (let i = 0; i < 20; i += 1) {
      const status = await invoke('GET', `/api/jobs/${first.body.job_id}`);
      if (status.body.status === 'completed') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const pack = await invoke('GET', `/api/study-packs/${first.body.pack_id}`);
    expect(pack.status).toBe(200);
    expect(pack.body.summaries).toHaveLength(3);
    expect(pack.body.flashcards).toHaveLength(15);
    expect(pack.body.quiz_questions).toHaveLength(10);
    expect(Array.isArray(pack.body.graph.nodes)).toBe(true);
    expect(Array.isArray(pack.body.graph.edges)).toBe(true);
    expect(Array.isArray(pack.body.timeline)).toBe(true);
    expect(pack.body.grounding_stats.citation_rate).toBeGreaterThan(0);
  });

  it('rejects invalid wikipedia url input', async () => {
    const res = await invoke('POST', '/api/study-packs', {
      title_or_url: 'https://example.com/foo',
      idempotency_key: 'idem-abc-12345'
    });
    expect(res.status).toBe(400);
  });

  it('exposes outcomes analytics and quiz scoring metrics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          parse: {
            revid: 456,
            title: 'Internet history',
            text: { '*': '<p>ARPANET preceded the Internet in 1969.</p>' }
          }
        })
      }) as unknown as typeof fetch
    );

    const created = await invoke(
      'POST',
      '/api/study-packs',
      { title_or_url: 'Internet history', idempotency_key: 'idem-analytics-12345' },
      { 'x-session-id': 's-analytics' }
    );
    expect(created.status).toBe(202);

    for (let i = 0; i < 20; i += 1) {
      const status = await invoke('GET', `/api/jobs/${created.body.job_id}`);
      if (status.body.status === 'completed') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const attempt = await invoke('POST', '/api/quiz-attempts', {
      pack_id: created.body.pack_id,
      selected_indices: Array.from({ length: 10 }, () => 0)
    });

    expect(attempt.status).toBe(200);
    expect(attempt.body.total_questions).toBe(10);
    expect(attempt.body.correct_answers).toBe(10);
    expect(attempt.body.accuracy).toBe(1);

    const analytics = await invoke('GET', '/api/analytics/outcomes');
    expect(analytics.status).toBe(200);
    expect(analytics.body.jobs.completed).toBe(1);
    expect(analytics.body.jobs.failed).toBe(0);
    expect(analytics.body.quality.avg_flashcards).toBe(15);
    expect(analytics.body.quality.avg_quiz_questions).toBe(10);
    expect(analytics.body.learning.attempts).toBe(1);
    expect(analytics.body.learning.avg_accuracy).toBe(1);
    expect(analytics.body.slo.p95_time_to_first_artifact_ms).toBeGreaterThanOrEqual(0);
    expect(analytics.body.slo.p95_full_pack_completion_ms).toBeGreaterThanOrEqual(0);
    expect(analytics.body.slo.job_success_rate).toBe(1);
    expect(analytics.body.slo.citation_coverage_rate).toBeGreaterThan(0);
    expect(analytics.body.cost.total_estimated_usd).toBeGreaterThan(0);
    expect(analytics.body.cost.avg_estimated_usd_per_pack).toBeGreaterThan(0);
    expect(Array.isArray(analytics.body.cost.by_stage)).toBe(true);
    expect(analytics.body.cost.by_stage.some((entry: any) => entry.stage === 'summarization')).toBe(true);

    const metrics = await invoke('GET', '/api/metrics/outcomes');
    expect(metrics.status).toBe(200);
    expect(typeof metrics.body).toBe('string');
    expect(String(metrics.body)).toContain('ultrawiki_jobs_completed_total 1');
    expect(String(metrics.body)).toContain('ultrawiki_quiz_attempts_total 1');
    expect(String(metrics.body)).toContain('ultrawiki_slo_time_to_first_artifact_p95_ms');
    expect(String(metrics.body)).toContain('ultrawiki_slo_full_pack_completion_p95_ms');
    expect(String(metrics.body)).toContain('ultrawiki_slo_job_success_rate');
    expect(String(metrics.body)).toContain('ultrawiki_slo_citation_coverage_rate');
    expect(String(metrics.body)).toContain('ultrawiki_cost_estimated_total_usd');
    expect(String(metrics.body)).toContain('ultrawiki_stage_cost_estimated_total_usd{stage="summarization"}');
    expect(String(metrics.body)).toContain('ultrawiki_outcomes_maintenance_duration_ms');
  });
});
