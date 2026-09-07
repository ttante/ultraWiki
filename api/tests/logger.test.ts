import { describe, expect, it } from 'vitest';
import { logger, redactSensitivePath } from '../src/logger.js';

describe('logger', () => {
  it('creates logger instance', () => {
    expect(typeof logger.info).toBe('function');
  });

  it('redacts share tokens from request log paths', () => {
    expect(redactSensitivePath('/api/shared/share-id.public-token-signature')).toBe('/api/shared/:shareId');
    expect(redactSensitivePath('/api/study-packs/pack-1/shares/share-id.public-token-signature')).toBe(
      '/api/study-packs/pack-1/shares/:shareId'
    );
    expect(redactSensitivePath('/api/library')).toBe('/api/library');
  });
});
