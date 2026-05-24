import { describe, expect, it } from 'vitest';
import { buildArtifactCacheKey, buildSourceCacheKey, cachePolicy, expiresAtFromNow, isCacheFresh } from '../src/domain/cachePolicy.js';
import { taxonomy } from '../src/domain/taxonomy.js';

describe('cachePolicy', () => {
  it('builds normalized source and artifact cache keys', () => {
    expect(buildSourceCacheKey('en', 'Ada_Lovelace')).toBe('wikipedia:en:ada lovelace');
    expect(buildArtifactCacheKey('summaries', 'rev-1', 'summary@1.0.0', 'taxonomy@1')).toBe(
      'summaries:rev-1:summary@1.0.0:taxonomy@1'
    );
  });

  it('enforces ttl freshness and central version constants', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    expect(expiresAtFromNow(now, 60)).toBe('2026-01-01T00:01:00.000Z');
    expect(isCacheFresh('2026-01-01T00:00:01.000Z', now)).toBe(true);
    expect(isCacheFresh('2025-12-31T23:59:59.000Z', now)).toBe(false);
    expect(cachePolicy.taxonomyVersion).toBe(taxonomy.version);
  });
});
