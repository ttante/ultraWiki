import { describe, expect, it } from 'vitest';
import { computeGroundingStats, generateGroundedSummaries } from '../src/domain/summary.js';

describe('summary generation', () => {
  it('generates three levels with citations', () => {
    const summaries = generateGroundedSummaries([
      {
        heading: 'Overview',
        content:
          'Alan Turing was a mathematician. He helped formalize computer science. He contributed to wartime cryptanalysis. He proposed the Turing test.'
      }
    ]);

    expect(summaries).toHaveLength(3);
    expect(summaries[0].level).toBe('beginner');
    expect(summaries[2].level).toBe('advanced');
    expect(summaries[1].citations.length).toBeGreaterThan(0);
  });

  it('computes grounding stats from citations', () => {
    const stats = computeGroundingStats([
      { level: 'beginner', text: 'a', citations: ['c1'], promptVersion: 'p', model: 'm' },
      { level: 'intermediate', text: 'b', citations: [], promptVersion: 'p', model: 'm' }
    ]);

    expect(stats.citationRate).toBe(0.5);
    expect(stats.unsupportedClaims).toBe(0);
  });
});
