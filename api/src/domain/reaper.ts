import type { Job } from './jobs.js';

export const reapStuckJobs = (
  jobs: Job[],
  now: number,
  heartbeatTimeoutMs: number
): { recovered: string[]; quarantined: string[] } => {
  const recovered: string[] = [];
  const quarantined: string[] = [];

  for (const job of jobs) {
    if (job.status !== 'running') continue;
    if (now - job.heartbeatAt <= heartbeatTimeoutMs) continue;

    if (job.attempt < 3) {
      job.status = 'queued';
      job.retryState = 'retrying';
      recovered.push(job.id);
    } else {
      job.status = 'quarantined';
      job.retryState = 'dead_letter';
      quarantined.push(job.id);
    }
  }

  return { recovered, quarantined };
};
