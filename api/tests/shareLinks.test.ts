import { describe, expect, it } from 'vitest';
import {
  activeShareTokenVersion,
  createShareToken,
  createShareTokenHash,
  expiresAtFromTtl,
  hashLegacyShareToken,
  hashShareToken,
  legacyShareTokenVersion,
  parseShareToken,
  publicShareToken
} from '../src/domain/shareLinks.js';

describe('share link token helpers', () => {
  it('creates public tokens that can be verified by hash without persisting plaintext', () => {
    const token = createShareToken('share-1', 'secret');
    const tokenHash = createShareTokenHash('share-1', 'secret');

    expect(token).toMatch(/^share-1\.[A-Za-z0-9_-]+$/);
    expect(tokenHash).toBe(hashShareToken(token));
    expect(tokenHash).not.toContain(token);
    expect(parseShareToken(token)).toEqual({ shareId: 'share-1', tokenHash });
    expect(publicShareToken('share-1', activeShareTokenVersion, 'secret')).toBe(token);
  });

  it('keeps legacy bare share IDs addressable through a legacy hash', () => {
    expect(parseShareToken('legacy-share')).toEqual({
      shareId: 'legacy-share',
      tokenHash: hashLegacyShareToken('legacy-share')
    });
    expect(publicShareToken('legacy-share', legacyShareTokenVersion, 'secret')).toBe('legacy-share');
  });

  it('computes configured expiry timestamps', () => {
    expect(expiresAtFromTtl(60, Date.parse('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01T00:01:00.000Z');
  });
});
