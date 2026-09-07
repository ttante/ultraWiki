import type { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as getCacheAdmin } from '../app/api/admin/cache/route';
import { POST as postCacheInvalidation } from '../app/api/admin/cache/invalidate/route';
import { GET as getCostAnalytics } from '../app/api/analytics/costs/route';
import { GET as getCostDrilldownAnalytics } from '../app/api/analytics/costs/drilldown/route';
import { GET as getOutcomeAnalytics } from '../app/api/analytics/outcomes/route';
import { GET as getSloAnalytics } from '../app/api/analytics/slo/route';
import { GET as getPromptEvaluation } from '../app/api/evaluation/prompts/route';
import { GET as getRuntimeHealth } from '../app/api/runtime/llm/health/route';
import { GET as getRuntimePresets } from '../app/api/runtime/llm/presets/route';
import { POST as postBatchStudyPacks } from '../app/api/study-packs/batch/route';
import { POST as postGenerationFeedback } from '../app/api/study-packs/[id]/feedback/route';

const requestWithSearch = (path: string): NextRequest =>
  ({ nextUrl: new URL(`http://web.test${path}`) }) as unknown as NextRequest;

describe('analytics API proxies', () => {
  const previousApiBaseUrl = process.env.API_BASE_URL;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousApiBaseUrl === undefined) {
      delete process.env.API_BASE_URL;
    } else {
      process.env.API_BASE_URL = previousApiBaseUrl;
    }
  });

  it('forwards time-window query strings for outcomes, costs, and SLO analytics', async () => {
    process.env.API_BASE_URL = 'http://api.test';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await getOutcomeAnalytics(requestWithSearch('/api/analytics/outcomes?window_hours=168'));
    await getCostAnalytics(requestWithSearch('/api/analytics/costs?window_hours=168'));
    await getCostDrilldownAnalytics(requestWithSearch('/api/analytics/costs/drilldown?window_hours=168&stage=summarization&format=csv'));
    await getSloAnalytics(requestWithSearch('/api/analytics/slo?window_hours=168'));

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/analytics/outcomes?window_hours=168', undefined);
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/analytics/costs?window_hours=168', undefined);
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/analytics/costs/drilldown?window_hours=168&stage=summarization&format=csv', undefined);
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/analytics/slo?window_hours=168', undefined);
  });

  it('proxies local LLM runtime health from the backend', async () => {
    process.env.API_BASE_URL = 'http://api.test';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ provider: 'openai_compatible' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await getRuntimeHealth();

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/runtime/llm/health', undefined);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ provider: 'openai_compatible' });
  });

  it('proxies runtime preset visibility from the backend', async () => {
    process.env.API_BASE_URL = 'http://api.test';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ current_preset_id: 'rtx4080_qwen14b_safe' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await getRuntimePresets();

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/runtime/llm/presets', undefined);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ current_preset_id: 'rtx4080_qwen14b_safe' });
  });

  it('proxies prompt evaluation snapshots from the backend', async () => {
    process.env.API_BASE_URL = 'http://api.test';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ prompt_regression: { pass: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await getPromptEvaluation();

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/evaluation/prompts', undefined);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ prompt_regression: { pass: true } });
  });

  it('proxies cache admin snapshots and invalidation requests from the backend', async () => {
    process.env.API_BASE_URL = 'http://api.test';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const invalidateBody = JSON.stringify({ target: 'expired', dry_run: false, reason: 'ops_stale_artifact_repair' });
    const snapshotRequest = new Request('http://web.test/api/admin/cache', {
      headers: {
        cookie: 'ultrawiki_auth_session=session-token',
        'x-user-id': 'cache-admin'
      }
    }) as NextRequest;
    const invalidateRequest = new Request('http://web.test/api/admin/cache/invalidate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'ultrawiki_auth_session=session-token',
        'x-user-id': 'cache-admin'
      },
      body: invalidateBody
    }) as NextRequest;

    const snapshotResponse = await getCacheAdmin(snapshotRequest);
    const invalidateResponse = await postCacheInvalidation(invalidateRequest);

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/admin/cache', {
      headers: {
        cookie: 'ultrawiki_auth_session=session-token',
        'x-user-id': 'cache-admin'
      }
    });
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/admin/cache/invalidate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'ultrawiki_auth_session=session-token',
        'x-user-id': 'cache-admin'
      },
      body: invalidateBody
    });
    expect(snapshotResponse.status).toBe(200);
    expect(invalidateResponse.status).toBe(200);
  });

  it('proxies generation feedback with identity headers to the backend', async () => {
    process.env.API_BASE_URL = 'http://api.test';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ feedback_id: 'feedback-1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request('http://web.test/api/study-packs/pack-1/feedback', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'user-feedback'
      },
      body: JSON.stringify({ artifact_type: 'quiz', rating: 2, signal: 'incorrect' })
    }) as NextRequest;
    const response = await postGenerationFeedback(request, { params: Promise.resolve({ id: 'pack-1' }) });

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/study-packs/pack-1/feedback', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'user-feedback'
      },
      body: JSON.stringify({ artifact_type: 'quiz', rating: 2, signal: 'incorrect' })
    });
    expect(response.status).toBe(201);
  });

  it('proxies batch study-pack generation with session and identity headers', async () => {
    process.env.API_BASE_URL = 'http://api.test';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ summary: { accepted: 1 } }), {
        status: 202,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const body = JSON.stringify({ idempotency_key: 'batch-web-12345', topics: ['Ada Lovelace'] });
    const request = new Request('http://web.test/api/study-packs/batch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-id': 'session-batch',
        'x-user-id': 'user-batch'
      },
      body
    }) as NextRequest;
    const response = await postBatchStudyPacks(request);

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/study-packs/batch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-id': 'session-batch',
        'x-user-id': 'user-batch'
      },
      body
    });
    expect(response.status).toBe(202);
  });

  it('preserves CSV response metadata for cost analytics exports', async () => {
    process.env.API_BASE_URL = 'http://api.test';
    const fetchMock = vi.fn(async () =>
      new Response('table,events\nby_pack,1\n', {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="ops-cost-drilldown-168h.csv"'
        }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await getCostDrilldownAnalytics(
      requestWithSearch('/api/analytics/costs/drilldown?window_hours=168&format=csv')
    );

    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="ops-cost-drilldown-168h.csv"');
    expect(await response.text()).toContain('by_pack,1');
  });
});
