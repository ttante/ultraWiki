import type { SourceSection } from './ingestion.js';

export type GlossaryTerm = {
  term: string;
  definition: string;
  citation: string;
  promptVersion: string;
  model: string;
};

export type GlossaryArtifacts = {
  glossary: GlossaryTerm[];
};

const stopTerms = new Set([
  'about',
  'after',
  'also',
  'before',
  'between',
  'could',
  'during',
  'first',
  'from',
  'have',
  'into',
  'over',
  'that',
  'their',
  'there',
  'these',
  'this',
  'through',
  'under',
  'were',
  'which',
  'with',
  'would'
]);

const splitSentences = (sections: SourceSection[]): string[] =>
  sections
    .flatMap((section) =>
      section.content
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 30)
    )
    .slice(0, 120);

const citationFromSentence = (sentence: string, i: number): string => `source:${i + 1}|"${sentence.slice(0, 140)}"`;

const candidateTerms = (sections: SourceSection[]): string[] => {
  const candidates = new Map<string, { term: string; score: number }>();
  const add = (term: string, score: number) => {
    const clean = term.replace(/\s+/g, ' ').trim();
    const key = clean.toLowerCase();
    if (clean.length < 4 || stopTerms.has(key)) return;
    const current = candidates.get(key);
    candidates.set(key, { term: current?.term ?? clean, score: (current?.score ?? 0) + score });
  };

  for (const section of sections) {
    if (!/^overview|introduction|references|external links$/i.test(section.heading)) {
      add(section.heading, 8);
    }
    for (const match of section.content.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g)) {
      add(match[1], 4);
    }
    for (const match of section.content.matchAll(/\b([a-z][a-z-]{7,})\b/g)) {
      add(match[1], 1);
    }
  }

  return Array.from(candidates.values())
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
    .map((entry) => entry.term)
    .slice(0, 16);
};

const findEvidence = (term: string, sentences: string[]): { sentence: string; index: number } => {
  const index = sentences.findIndex((sentence) => sentence.toLowerCase().includes(term.toLowerCase()));
  if (index >= 0) {
    return { sentence: sentences[index], index };
  }
  return { sentence: sentences[0] ?? 'No source sentence available.', index: 0 };
};

export const generateGlossaryArtifacts = (
  sections: SourceSection[],
  promptVersion = 'glossary@1.0.0',
  model = 'local-rule-based'
): GlossaryArtifacts => {
  const sentences = splitSentences(sections);
  const terms = candidateTerms(sections);
  const fallbackTerms = terms.length > 0 ? terms : sections.map((section) => section.heading).filter(Boolean).slice(0, 8);

  return {
    glossary: fallbackTerms.slice(0, 12).map((term) => {
      const evidence = findEvidence(term, sentences);
      return {
        term,
        definition: `${term} is a source-grounded term in this article. Evidence: ${evidence.sentence.slice(0, 180)}`,
        citation: citationFromSentence(evidence.sentence, evidence.index),
        promptVersion,
        model
      };
    })
  };
};
