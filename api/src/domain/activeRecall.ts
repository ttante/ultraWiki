import type { SourceSection } from './ingestion.js';

export type Flashcard = {
  question: string;
  answer: string;
  citation: string;
  promptVersion: string;
  model: string;
};

export type QuizQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
  misconceptions: string[];
  explanation: string;
  citation: string;
  promptVersion: string;
  model: string;
};

export type ActiveRecallArtifacts = {
  flashcards: Flashcard[];
  quizQuestions: QuizQuestion[];
};

const splitSentences = (sections: SourceSection[]): string[] =>
  sections
    .flatMap((section) =>
      section.content
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 25)
    )
    .slice(0, 200);

const pick = (sentences: string[], index: number): string => {
  if (sentences.length === 0) {
    return 'No source sentence available.';
  }
  return sentences[index % sentences.length];
};

const citationFromSentence = (sentence: string, i: number): string => `source:${i + 1}|"${sentence.slice(0, 140)}"`;

export const generateActiveRecallArtifacts = (
  sections: SourceSection[],
  promptVersion = 'active-recall@1.0.0',
  model = 'local-rule-based'
): ActiveRecallArtifacts => {
  const sentences = splitSentences(sections);

  const flashcards: Flashcard[] = Array.from({ length: 15 }, (_, i) => {
    const sentence = pick(sentences, i);
    return {
      question: `What key point is described by this source-backed statement #${i + 1}?`,
      answer: sentence,
      citation: citationFromSentence(sentence, i),
      promptVersion,
      model
    };
  });

  const quizQuestions: QuizQuestion[] = Array.from({ length: 10 }, (_, i) => {
    const correct = pick(sentences, i);
    const decoyA = pick(sentences, i + 3);
    const decoyB = pick(sentences, i + 5);
    const decoyC = pick(sentences, i + 7);

    const options = [correct, decoyA, decoyB, decoyC];
    const correctIndex = i % 4;
    const rotated = [...options.slice(correctIndex), ...options.slice(0, correctIndex)];

    return {
      question: `Which option is directly supported by the source for quiz item #${i + 1}?`,
      options: rotated,
      correctIndex: 0,
      misconceptions: rotated.map((option, optionIndex) =>
        optionIndex === 0
          ? 'This option is supported by the cited source statement.'
          : `This distractor may sound plausible, but it is not the cited statement: ${option.slice(0, 120)}`
      ),
      explanation: 'The correct option is a direct source-supported statement from the article text.',
      citation: citationFromSentence(correct, i),
      promptVersion,
      model
    };
  });

  return { flashcards, quizQuestions };
};
