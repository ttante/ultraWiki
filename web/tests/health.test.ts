import { describe, expect, it } from 'vitest';
import { serviceHealth } from '../lib/health';

describe('serviceHealth', () => {
  it('returns service health payload', () => {
    expect(serviceHealth()).toEqual({ service: 'web', status: 'ok' });
  });
});
