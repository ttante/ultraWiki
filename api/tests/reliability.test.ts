import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import httpMocks from 'node-mocks-http';
import { classifyError, nextRetryState } from '../src/domain/retryPolicy.js';
import { reapStuckJobs } from '../src/domain/reaper.js';
import type { Job } from '../src/domain/jobs.js';

process.env.DISABLE_HTTP_LOGGER = '1';
process.env.DISABLE_QUEUE_POLLING = '1';
process.env.USE_MEMORY_REPO = '1';

const { buildApp } = await import('../src/app.js');
const {
  processNextQueuedJobForTests,
  resetRealModelSmokeForTests,
  resetShareReadAbuseControlsForTests
} = await import('../src/routes/api.js');
const { memoryRepo } = await import('../src/repo/memoryRepo.js');
const { llmTelemetry } = await import('../src/telemetry/llm.js');
const { securityEventMetrics } = await import('../src/domain/security.js');

const app = buildApp();

const sourceText = [
  'Ada Lovelace collaborated with Charles Babbage on the Analytical Engine in 1843.',
  'Her notes described an algorithmic approach to computation and connected mathematics to machinery.',
  'The Analytical Engine influenced later work in programming, computing history, and symbolic reasoning.',
  'Reliable study workflows need summaries, concepts, glossary terms, flashcards, and quiz checks.'
].join(' ');

const wikiResponse = (title: string, revisionId: number) => ({
  ok: true,
  json: async () => ({
    parse: {
      revid: revisionId,
      title,
      text: { '*': `<p>${sourceText}</p>` },
      links: [
        { ns: 0, exists: '', '*': 'Analytical Engine' },
        { ns: 0, exists: '', '*': 'Computer programming' }
      ]
    }
  })
});

const invoke = async (
  method: 'GET' | 'POST',
  url: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<{ status: number; body: any; headers: Record<string, string | string[]> }> => {
  const req = httpMocks.createRequest({
    method,
    url,
    body: body as any,
    headers
  });
  const res = httpMocks.createResponse({ eventEmitter: EventEmitter });

  await new Promise<void>((resolve) => {
    res.on('end', () => resolve());
    (app as any).handle(req, res);
  });

  return {
    status: res.statusCode,
    headers: res._getHeaders(),
    body: (() => {
      const contentType = String(res.getHeader('content-type') ?? '');
      if (contentType.includes('application/json')) {
        return res._getJSONData();
      }
      return res._getData();
    })()
  };
};

const waitUntil = async (predicate: () => boolean | Promise<boolean>, label: string): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
};

const waitForJob = async (jobId: string, predicate: (job: any) => boolean, label: string): Promise<any> => {
  let latest: any;
  await waitUntil(async () => {
    const res = await invoke('GET', `/api/jobs/${jobId}`);
    latest = res.body;
    return predicate(res.body);
  }, label);
  return latest;
};

describe('retry policy', () => {
  it('classifies transient and permanent failures', () => {
    expect(classifyError('timeout while fetching')).toBe('transient');
    expect(classifyError('invalid wiki url')).toBe('permanent');
  });

  it('moves to retrying for transient under max attempts', () => {
    expect(nextRetryState(1, 3, 'transient')).toBe('retrying');
    expect(nextRetryState(3, 3, 'transient')).toBe('dead_letter');
  });
});

describe('stuck job reaper', () => {
  it('requeues stale running jobs under retry limit', () => {
    const job: Job = {
      id: 'j1',
      packId: 'p1',
      sessionId: 's1',
      stage: 'ingestion',
      status: 'running',
      progress: 10,
      attempt: 1,
      retryState: 'none',
      degradationState: 'none',
      errors: [],
      heartbeatAt: 0
    };

    const result = reapStuckJobs([job], 100_000, 30_000);
    expect(result.recovered).toEqual(['j1']);
    expect(job.status).toBe('queued');
  });

  it('quarantines stale running jobs beyond retry limit', () => {
    const job: Job = {
      id: 'j2',
      packId: 'p2',
      sessionId: 's2',
      stage: 'ingestion',
      status: 'running',
      progress: 10,
      attempt: 3,
      retryState: 'none',
      degradationState: 'none',
      errors: [],
      heartbeatAt: 0
    };

    const result = reapStuckJobs([job], 100_000, 30_000);
    expect(result.quarantined).toEqual(['j2']);
    expect(job.status).toBe('quarantined');
  });
});

describe('queue and worker reliability soak', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    memoryRepo.resetForTests();
    llmTelemetry.reset();
    securityEventMetrics.reset();
    resetShareReadAbuseControlsForTests();
    resetRealModelSmokeForTests();
  });

  it('keeps one worker active while rejecting same-session over-admission and queueing cross-session work', async () => {
    let releaseFetch: (value: unknown) => void = () => undefined;
    const heldFetch = new Promise((resolve) => {
      releaseFetch = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => heldFetch)
      .mockResolvedValue(wikiResponse('Queued Followup', 502));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const first = await invoke(
      'POST',
      '/api/study-packs',
      { title_or_url: 'Queued First', idempotency_key: 'reliability-concurrency-first' },
      { 'x-session-id': 'soak-session-a' }
    );
    expect(first.status).toBe(202);
    await waitUntil(() => fetchMock.mock.calls.length === 1, 'first worker fetch');
    await waitForJob(first.body.job_id, (job) => job.status === 'running', 'first job running');

    const sameSession = await invoke(
      'POST',
      '/api/study-packs',
      { title_or_url: 'Same Session Overflow', idempotency_key: 'reliability-concurrency-same-session' },
      { 'x-session-id': 'soak-session-a' }
    );
    expect(sameSession.status).toBe(429);
    expect(sameSession.body).toEqual({ error: 'admission_denied', reason: 'session_limit' });

    const second = await invoke(
      'POST',
      '/api/study-packs',
      { title_or_url: 'Queued Followup', idempotency_key: 'reliability-concurrency-second' },
      { 'x-session-id': 'soak-session-b' }
    );
    expect(second.status).toBe(202);

    const queued = await invoke('GET', `/api/jobs/${second.body.job_id}`);
    expect(queued.body.status).toBe('queued');

    const queueStatus = await invoke('GET', '/api/queue/status', undefined, { 'x-session-id': 'soak-session-b' });
    expect(queueStatus.body).toMatchObject({
      queued: 1,
      running: 1,
      capacity_state: 'global_limit'
    });

    releaseFetch(wikiResponse('Queued First', 501));
    await waitForJob(first.body.job_id, (job) => job.status === 'completed', 'first job completion');

    await processNextQueuedJobForTests();
    const completedSecond = await waitForJob(second.body.job_id, (job) => job.status === 'completed', 'second job completion');
    expect(completedSecond.attempt).toBe(1);
  });

  it('retries transient source failures, then reuses source/artifact caches without extra local LLM fallback work', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET transient_network_failure'))
      .mockResolvedValue(wikiResponse('Retry Cache Topic', 601));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const created = await invoke(
      'POST',
      '/api/study-packs',
      { title_or_url: 'Retry Cache Topic', idempotency_key: 'reliability-retry-cache-first' },
      { 'x-session-id': 'soak-retry-a' }
    );
    expect(created.status).toBe(202);

    const retrying = await waitForJob(
      created.body.job_id,
      (job) => job.status === 'queued' && job.retry_state === 'retrying',
      'retrying job state'
    );
    expect(retrying.attempt).toBe(1);
    expect(retrying.errors).toContain('ECONNRESET transient_network_failure');

    await processNextQueuedJobForTests();
    const completed = await waitForJob(created.body.job_id, (job) => job.status === 'completed', 'retried job completion');
    expect(completed.attempt).toBe(2);

    const firstPack = await invoke('GET', `/api/study-packs/${created.body.pack_id}`);
    expect(firstPack.body.cache.source.hit).toBe(false);
    expect(firstPack.body.cache.artifacts.map((event: any) => event.hit)).toEqual([false, false, false, false]);

    const fallbackSnapshot = llmTelemetry.getSnapshot();
    expect(fallbackSnapshot.calls).toMatchObject({
      attempted: 0,
      succeeded: 0,
      fallback: 4
    });
    expect(fallbackSnapshot.fallbacksByReason.every((entry) => entry.reason === 'missing_client')).toBe(true);

    const cached = await invoke(
      'POST',
      '/api/study-packs',
      { title_or_url: 'Retry Cache Topic', idempotency_key: 'reliability-retry-cache-second' },
      { 'x-session-id': 'soak-retry-b' }
    );
    expect(cached.status).toBe(202);
    await waitForJob(cached.body.job_id, (job) => job.status === 'completed', 'cached job completion');

    const cachedPack = await invoke('GET', `/api/study-packs/${cached.body.pack_id}`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cachedPack.body.cache.source.hit).toBe(true);
    expect(cachedPack.body.cache.artifacts.map((event: any) => event.hit)).toEqual([true, true, true, true]);
    expect(llmTelemetry.getSnapshot().calls.fallback).toBe(fallbackSnapshot.calls.fallback);
  });

  it('resumes partial packs through the worker without recomputing completed summaries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(wikiResponse('Resume Reliability', 701));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await memoryRepo.createPendingPack('reliability-resume-pack', 'Resume Reliability');
    await memoryRepo.saveIngestedPack('reliability-resume-pack', 'Resume Reliability', {
      revisionId: '701',
      title: 'Resume Reliability',
      sections: [{ heading: 'Overview', content: sourceText }],
      outgoingLinks: [{ title: 'Analytical Engine', url: 'https://en.wikipedia.org/wiki/Analytical_Engine', sourceHeading: 'Overview' }]
    });
    await memoryRepo.saveSummaries('reliability-resume-pack', [
      {
        level: 'beginner',
        text: 'Existing beginner summary.',
        citations: ['source:1|"Ada Lovelace collaborated with Charles Babbage on the Analytical Engine in 1843."'],
        promptVersion: 'summary-by-level@1.0.0',
        model: 'local-rule-based'
      },
      {
        level: 'intermediate',
        text: 'Existing intermediate summary.',
        citations: ['source:2|"Her notes described an algorithmic approach to computation and connected mathematics to machinery."'],
        promptVersion: 'summary-by-level@1.0.0',
        model: 'local-rule-based'
      },
      {
        level: 'advanced',
        text: 'Existing advanced summary.',
        citations: ['source:3|"The Analytical Engine influenced later work in programming, computing history, and symbolic reasoning."'],
        promptVersion: 'summary-by-level@1.0.0',
        model: 'local-rule-based'
      }
    ]);

    const resumed = await invoke(
      'POST',
      '/api/study-packs/reliability-resume-pack/resume',
      undefined,
      { 'x-session-id': 'soak-resume' }
    );
    expect(resumed.status).toBe(202);
    await waitForJob(resumed.body.job_id, (job) => job.status === 'completed', 'resume completion');

    const pack = await invoke('GET', '/api/study-packs/reliability-resume-pack');
    expect(pack.status).toBe(200);
    expect(pack.body.summaries.map((summary: any) => summary.text)).toEqual([
      'Existing beginner summary.',
      'Existing intermediate summary.',
      'Existing advanced summary.'
    ]);
    expect(pack.body.readiness).toEqual({
      status: 'full',
      missing_artifacts: [],
      can_resume: false
    });
    expect(pack.body.graph.nodes.length).toBeGreaterThan(0);
    expect(pack.body.glossary.length).toBeGreaterThan(0);
    expect(pack.body.flashcards.length).toBeGreaterThan(0);
    expect(pack.body.quiz_questions.length).toBeGreaterThan(0);
  });
});
