import { describe, expect, it } from 'vitest';
import { getConfig } from '../src/config.js';

describe('getConfig', () => {
  it('reads defaults', () => {
    const c = getConfig();
    expect(c.apiPort).toBeGreaterThan(0);
    expect(c.wikipediaLang).toBe('en');
  });
});
