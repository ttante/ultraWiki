import { describe, expect, it } from 'vitest';
import { generateActiveRecallArtifacts } from '../src/domain/activeRecall.js';

describe('active recall generation', () => {
  it('generates 15 flashcards and 10 quiz questions', () => {
    const artifacts = generateActiveRecallArtifacts([
      {
        heading: 'Overview',
        content:
          'Alan Turing was a mathematician. He formalized computation. He worked on cryptanalysis. He proposed the Turing test. He contributed to computer science history.'
      }
    ]);

    expect(artifacts.flashcards).toHaveLength(15);
    expect(artifacts.quizQuestions).toHaveLength(10);
    expect(artifacts.quizQuestions[0].options).toHaveLength(4);
    expect(artifacts.quizQuestions[0].correctIndex).toBeGreaterThanOrEqual(0);
    expect(artifacts.quizQuestions[0].correctIndex).toBeLessThan(4);
  });
});
