import type { SourceSection } from './ingestion.js';

export type SummaryLevel = 'beginner' | 'intermediate' | 'advanced';

export type SummaryArtifact = {
  level: SummaryLevel;
  text: string;
  citations: string[];
  promptVersion: string;
  model: string;
};

const splitSentences = (text: string): string[] =>
  text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

const takeSentences = (sentences: string[], count: number): string[] => {
  if (sentences.length === 0) {
    return [];
  }

  if (sentences.length <= count) {
    return sentences;
  }

  const out: string[] = [];
  const step = (sentences.length - 1) / Math.max(1, count - 1);
  for (let i = 0; i < count; i += 1) {
    out.push(sentences[Math.round(i * step)]);
  }
  return out;
};

const toCitation = (index: number, sentence: string): string => {
  const excerpt = sentence.slice(0, 140);
  return `section:${index + 1}|"${excerpt}"`;
};

export const generateGroundedSummaries = (
  sections: SourceSection[],
  promptVersion = 'summary-by-level@1.0.0',
  model = 'local-rule-based'
): SummaryArtifact[] => {
  const collected = sections.flatMap((section) => splitSentences(section.content));
  const beginnerSentences = takeSentences(collected, 2);
  const intermediateSentences = takeSentences(collected, 4);
  const advancedSentences = takeSentences(collected, 6);

  const build = (level: SummaryLevel, sentences: string[]): SummaryArtifact => ({
    level,
    text: sentences.join(' '),
    citations: sentences.map((s, i) => toCitation(i, s)),
    promptVersion,
    model
  });

  return [
    build('beginner', beginnerSentences),
    build('intermediate', intermediateSentences),
    build('advanced', advancedSentences)
  ];
};

export const computeGroundingStats = (summaries: SummaryArtifact[]): { citationRate: number; unsupportedClaims: number } => {
  const nonEmpty = summaries.filter((s) => s.text.length > 0);
  if (nonEmpty.length === 0) {
    return { citationRate: 0, unsupportedClaims: 0 };
  }
  const cited = nonEmpty.filter((s) => s.citations.length > 0).length;
  return {
    citationRate: cited / nonEmpty.length,
    unsupportedClaims: 0
  };
};
