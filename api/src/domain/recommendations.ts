import type { OutgoingLink, SourceSection } from './ingestion.js';
import type { GraphNode } from './knowledgeStructure.js';

export type LearnNextRecommendation = {
  title: string;
  url: string;
  rationale: string;
  score: number;
  sourceHeading: string;
};

type RecommendationInput = {
  inputTitle: string;
  sections: SourceSection[];
  outgoingLinks: OutgoingLink[];
  graphNodes: GraphNode[];
  limit?: number;
};

const normalizeTitle = (value: string): string => value.trim().replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase();

const wikipediaUrlForTitle = (title: string): string =>
  `https://en.wikipedia.org/wiki/${encodeURIComponent(title.trim().replace(/\s+/g, '_'))}`;

const termsFor = (value: string): Set<string> =>
  new Set(
    normalizeTitle(value)
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 4)
  );

const overlapScore = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const term of a) {
    if (b.has(term)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(a.size, b.size);
};

const clampScore = (value: number): number => Number(Math.min(1, Math.max(0, value)).toFixed(3));

export const buildLearnNextRecommendations = ({
  inputTitle,
  sections,
  outgoingLinks,
  graphNodes,
  limit = 6
}: RecommendationInput): LearnNextRecommendation[] => {
  const currentTitle = normalizeTitle(inputTitle);
  const sectionText = sections.map((section) => `${section.heading} ${section.content}`).join(' ');
  const sectionTerms = termsFor(sectionText);
  const graphTerms = termsFor(graphNodes.map((node) => node.label).join(' '));
  const seen = new Set<string>();

  const linkRecommendations = outgoingLinks
    .filter((link) => link.title.trim().length > 0)
    .map((link, order) => {
      const normalized = normalizeTitle(link.title);
      if (normalized === currentTitle || seen.has(normalized)) {
        return null;
      }
      seen.add(normalized);

      const titleTerms = termsFor(link.title);
      const contextOverlap = overlapScore(titleTerms, sectionTerms);
      const graphOverlap = overlapScore(titleTerms, graphTerms);
      const score = clampScore(0.48 + contextOverlap * 0.26 + graphOverlap * 0.2 + (order < 10 ? 0.06 : 0));
      const rationale = graphOverlap > 0
        ? `Linked from ${link.sourceHeading} and overlaps with entities in this pack.`
        : `Linked from ${link.sourceHeading} in the source article.`;

      return {
        title: link.title,
        url: link.url,
        rationale,
        score,
        sourceHeading: link.sourceHeading,
        order
      };
    })
    .filter((item): item is LearnNextRecommendation & { order: number } => item !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((item) => ({
      title: item.title,
      url: item.url,
      rationale: item.rationale,
      score: item.score,
      sourceHeading: item.sourceHeading
    }));

  if (linkRecommendations.length > 0) {
    return linkRecommendations;
  }

  const fallbackSeen = new Set<string>();
  return graphNodes
    .filter((node) => node.label.trim().length > 0)
    .map((node, order) => {
      const normalized = normalizeTitle(node.label);
      if (normalized === currentTitle || fallbackSeen.has(normalized)) {
        return null;
      }
      fallbackSeen.add(normalized);
      return {
        title: node.label,
        url: wikipediaUrlForTitle(node.label),
        rationale: `Prominent ${node.type} node in the generated concept graph.`,
        score: clampScore(0.42 - Math.min(order, 10) * 0.01),
        sourceHeading: 'Concept graph',
        order
      };
    })
    .filter((item): item is LearnNextRecommendation & { order: number } => item !== null)
    .slice(0, limit)
    .map((item) => ({
      title: item.title,
      url: item.url,
      rationale: item.rationale,
      score: item.score,
      sourceHeading: item.sourceHeading
    }));
};
