import type { SourceSection } from './ingestion.js';

export type EntityType = 'person' | 'organization' | 'event' | 'concept' | 'place' | 'work';
export type RelationType = 'influenced' | 'founded' | 'member_of' | 'occurred_in' | 'related_to' | 'precedes';

export type GraphNode = {
  id: string;
  label: string;
  type: EntityType;
  citation: string;
};

export type GraphEdge = {
  source: string;
  target: string;
  relation: RelationType;
  citation: string;
};

export type TimelineEvent = {
  year: number;
  dateLabel: string;
  description: string;
  citation: string;
};

export type KnowledgeStructureArtifacts = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  timeline: TimelineEvent[];
};

const sentenceSplit = (text: string): string[] =>
  text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const citationFromSentence = (sentence: string, i: number): string => `source:${i + 1}|"${sentence.slice(0, 140)}"`;

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const classifyEntity = (label: string): EntityType => {
  if (/(University|Institute|Corporation|Company|Organization|Committee)\b/.test(label)) {
    return 'organization';
  }
  if (/(War|Revolution|Treaty|Conference)\b/.test(label)) {
    return 'event';
  }
  if (/(Kingdom|Empire|City|Town|Country|State)\b/.test(label)) {
    return 'place';
  }
  if (/(Theory|Test|Law|Algorithm|Model)\b/.test(label)) {
    return 'concept';
  }
  const words = label.split(/\s+/);
  if (words.length >= 2 && words.every((w) => /^[A-Z][a-z]+$/.test(w))) {
    return 'person';
  }
  return 'concept';
};

const extractCandidateEntities = (sentence: string): string[] => {
  const candidates = sentence.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g) ?? [];
  return candidates
    .map((c) => c.trim())
    .filter((c) => c.length > 2)
    .filter((c) => !['The', 'A', 'An', 'In', 'On', 'By', 'At', 'For'].includes(c));
};

const relationFromSentence = (sentence: string): RelationType | null => {
  if (/\binfluenc(?:ed|es)\b/i.test(sentence)) return 'influenced';
  if (/\bfound(?:ed|s)\b/i.test(sentence)) return 'founded';
  if (/\bmember of\b/i.test(sentence)) return 'member_of';
  if (/\boccurred in\b/i.test(sentence)) return 'occurred_in';
  if (/\bbefore\b/i.test(sentence)) return 'precedes';
  if (/\brelated to\b/i.test(sentence)) return 'related_to';
  return null;
};

const extractTimelineYears = (sentence: string): number[] => {
  const matches = sentence.match(/\b(1[5-9][0-9]{2}|20[0-9]{2})\b/g) ?? [];
  return matches.map((m) => Number.parseInt(m, 10));
};

export const generateKnowledgeStructureArtifacts = (sections: SourceSection[]): KnowledgeStructureArtifacts => {
  const allSentences = sections.flatMap((s) => sentenceSplit(s.content));

  const nodeByLabel = new Map<string, GraphNode>();
  const edgeKeySet = new Set<string>();
  const edges: GraphEdge[] = [];
  const timeline: TimelineEvent[] = [];

  allSentences.forEach((sentence, idx) => {
    const citation = citationFromSentence(sentence, idx);
    const entities = extractCandidateEntities(sentence);

    for (const entity of entities) {
      if (!nodeByLabel.has(entity)) {
        nodeByLabel.set(entity, {
          id: slug(entity),
          label: entity,
          type: classifyEntity(entity),
          citation
        });
      }
    }

    const relation = relationFromSentence(sentence);
    if (relation && entities.length >= 2) {
      const source = slug(entities[0]);
      const target = slug(entities[1]);
      if (source !== target) {
        const key = `${source}|${target}|${relation}`;
        if (!edgeKeySet.has(key)) {
          edgeKeySet.add(key);
          edges.push({ source, target, relation, citation });
        }
      }
    }

    const years = extractTimelineYears(sentence);
    for (const year of years) {
      timeline.push({
        year,
        dateLabel: String(year),
        description: sentence,
        citation
      });
    }
  });

  timeline.sort((a, b) => a.year - b.year);

  return {
    nodes: Array.from(nodeByLabel.values()),
    edges,
    timeline
  };
};
