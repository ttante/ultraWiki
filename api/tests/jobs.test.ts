import { describe, expect, it } from 'vitest';
import { AdmissionController } from '../src/domain/jobs.js';

describe('AdmissionController', () => {
  it('enforces global and session concurrency', () => {
    const controller = new AdmissionController(1, 1, 10);
    expect(controller.canAdmit(0, 0, 's1')).toEqual({ admitted: true });
    expect(controller.canAdmit(0, 1, 's2')).toEqual({ admitted: false, reason: 'global_limit' });
    controller.release('s1');
    expect(controller.canAdmit(0, 0, 's1')).toEqual({ admitted: true });
  });

  it('enforces queue depth', () => {
    const controller = new AdmissionController(10, 10, 1);
    expect(controller.canAdmit(1, 0, 's1')).toEqual({ admitted: false, reason: 'queue_full' });
  });
});
