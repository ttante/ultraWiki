import { describe, expect, it } from 'vitest';
import { generateKnowledgeStructureArtifacts } from '../src/domain/knowledgeStructure.js';

describe('knowledge structure extraction', () => {
  it('extracts nodes, relations, and timeline events', () => {
    const artifacts = generateKnowledgeStructureArtifacts([
      {
        heading: 'Overview',
        content:
          'Alan Turing influenced John McCarthy in 1950. John McCarthy founded AI Laboratory in 1956. The Dartmouth Conference occurred in 1956.'
      }
    ]);

    expect(artifacts.nodes.length).toBeGreaterThan(3);
    expect(artifacts.edges.some((e) => e.relation === 'influenced')).toBe(true);
    expect(artifacts.edges.some((e) => e.relation === 'founded')).toBe(true);
    expect(artifacts.timeline.length).toBeGreaterThanOrEqual(3);
    expect(artifacts.timeline[0].year).toBeLessThanOrEqual(artifacts.timeline[artifacts.timeline.length - 1].year);
  });

  it('deduplicates repeated relationship edges', () => {
    const artifacts = generateKnowledgeStructureArtifacts([
      {
        heading: 'Repeated',
        content: 'Alan Turing influenced John McCarthy. Alan Turing influenced John McCarthy.'
      }
    ]);

    const influencedEdges = artifacts.edges.filter((e) => e.relation === 'influenced');
    expect(influencedEdges).toHaveLength(1);
  });
});
