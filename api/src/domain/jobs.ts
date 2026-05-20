import { randomUUID } from 'node:crypto';

export type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'quarantined';
export type RetryState = 'none' | 'retrying' | 'dead_letter';

export type Job = {
  id: string;
  packId: string;
  sessionId: string;
  stage: 'ingestion' | 'summarization' | 'active_recall' | 'knowledge_structure' | 'done';
  status: JobState;
  progress: number;
  attempt: number;
  retryState: RetryState;
  degradationState: 'none' | 'partial';
  errors: string[];
  heartbeatAt: number;
};

export class AdmissionController {
  private activeBySession = new Map<string, number>();

  constructor(
    private readonly globalLimit: number,
    private readonly sessionLimit: number,
    private readonly maxQueueDepth: number
  ) {}

  canAdmit(queueDepth: number, activeGlobal: number, sessionId: string): { admitted: boolean; reason?: string } {
    if (queueDepth >= this.maxQueueDepth) {
      return { admitted: false, reason: 'queue_full' };
    }
    if (activeGlobal >= this.globalLimit) {
      return { admitted: false, reason: 'global_limit' };
    }
    const sessionActive = this.activeBySession.get(sessionId) ?? 0;
    if (sessionActive >= this.sessionLimit) {
      return { admitted: false, reason: 'session_limit' };
    }
    this.activeBySession.set(sessionId, sessionActive + 1);
    return { admitted: true };
  }

  release(sessionId: string): void {
    const current = this.activeBySession.get(sessionId) ?? 0;
    if (current <= 1) {
      this.activeBySession.delete(sessionId);
      return;
    }
    this.activeBySession.set(sessionId, current - 1);
  }
}

export const newJob = (packId: string, sessionId: string): Job => ({
  id: randomUUID(),
  packId,
  sessionId,
  stage: 'ingestion',
  status: 'queued',
  progress: 0,
  attempt: 0,
  retryState: 'none',
  degradationState: 'none',
  errors: [],
  heartbeatAt: Date.now()
});
