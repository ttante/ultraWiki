import { describe, expect, it } from 'vitest';
import { classifyError, nextRetryState } from '../src/domain/retryPolicy.js';
import { reapStuckJobs } from '../src/domain/reaper.js';
import type { Job } from '../src/domain/jobs.js';

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
