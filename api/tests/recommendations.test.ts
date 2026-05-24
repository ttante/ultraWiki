import { describe, expect, it } from 'vitest';
import { buildLearnNextRecommendations } from '../src/domain/recommendations.js';

describe('buildLearnNextRecommendations', () => {
  it('ranks and deduplicates Wikipedia outgoing links', () => {
    const recommendations = buildLearnNextRecommendations({
      inputTitle: 'Ada Lovelace',
      sections: [
        {
          heading: 'Overview',
          content: 'Ada Lovelace wrote notes about the Analytical Engine and Charles Babbage.'
        }
      ],
      outgoingLinks: [
        {
          title: 'Analytical Engine',
          url: 'https://en.wikipedia.org/wiki/Analytical_Engine',
          sourceHeading: 'Overview'
        },
        {
          title: 'Ada Lovelace',
          url: 'https://en.wikipedia.org/wiki/Ada_Lovelace',
          sourceHeading: 'Overview'
        },
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
      ],
      graphNodes: [
        { id: 'n1', label: 'Analytical Engine', type: 'work', citation: 'c1' }
      ]
    });

    expect(recommendations.map((item) => item.title)).toEqual(['Analytical Engine', 'Charles Babbage']);
    expect(recommendations[0].score).toBeGreaterThan(recommendations[1].score);
    expect(recommendations[0].rationale).toContain('overlaps with entities');
  });

  it('falls back to graph nodes when Wikipedia links are absent', () => {
    const recommendations = buildLearnNextRecommendations({
      inputTitle: 'Internet',
      sections: [{ heading: 'Overview', content: 'ARPANET preceded the Internet.' }],
      outgoingLinks: [],
      graphNodes: [
        { id: 'internet', label: 'Internet', type: 'concept', citation: 'c1' },
        { id: 'arpanet', label: 'ARPANET', type: 'work', citation: 'c2' }
      ]
    });

    expect(recommendations).toEqual([
      {
        title: 'ARPANET',
        url: 'https://en.wikipedia.org/wiki/ARPANET',
        rationale: 'Prominent work node in the generated concept graph.',
        score: 0.41,
        sourceHeading: 'Concept graph'
      }
    ]);
  });
});
