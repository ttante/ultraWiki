import { describe, expect, it } from 'vitest';
import { parseTopicInput } from '../src/domain/ingestion.js';

describe('parseTopicInput', () => {
  it('normalizes title input to url', () => {
    const parsed = parseTopicInput('Alan Turing', 'en');
    expect(parsed.title).toBe('Alan Turing');
    expect(parsed.url).toContain('https://en.wikipedia.org/wiki/Alan_Turing');
  });

  it('accepts english wikipedia url', () => {
    const parsed = parseTopicInput('https://en.wikipedia.org/wiki/Ada_Lovelace', 'en');
    expect(parsed.title).toBe('Ada Lovelace');
  });

  it('rejects non english host', () => {
    expect(() => parseTopicInput('https://fr.wikipedia.org/wiki/Ada_Lovelace', 'en')).toThrow(
      'Only English Wikipedia URLs are supported in MVP'
    );
  });
});
