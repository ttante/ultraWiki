import { describe, expect, it } from 'vitest';
import { logger } from '../src/logger.js';

describe('logger', () => {
  it('creates logger instance', () => {
    expect(typeof logger.info).toBe('function');
  });
});
