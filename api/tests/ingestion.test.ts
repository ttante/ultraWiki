import { describe, expect, it, vi } from 'vitest';
import { fetchWikipediaSections, parseTopicInput } from '../src/domain/ingestion.js';

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

  it('extracts namespace-zero outgoing links for learn-next recommendations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          parse: {
            revid: 123,
            title: 'Ada Lovelace',
            text: { '*': '<p>Ada Lovelace wrote notes about the Analytical Engine.</p>' },
            links: [
              { ns: 0, exists: '', '*': 'Analytical Engine' },
              { ns: 0, exists: '', '*': 'Charles Babbage' },
              { ns: 14, exists: '', '*': 'Category:Mathematicians' },
              { ns: 0, '*': 'Missing Page' }
            ]
          }
        })
      }) as unknown as typeof fetch
    );

    const page = await fetchWikipediaSections('Ada Lovelace', 'en');

    expect(page.outgoingLinks).toEqual([
      {
        title: 'Analytical Engine',
        url: 'https://en.wikipedia.org/wiki/Analytical_Engine',
        sourceHeading: 'Overview'
      },
      {
        title: 'Charles Babbage',
        url: 'https://en.wikipedia.org/wiki/Charles_Babbage',
        sourceHeading: 'Overview'
      }
    ]);
  });
});
