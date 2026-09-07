import { describe, expect, it } from 'vitest';
import { computeQuizMasteryTrend } from '../src/domain/masteryTrend.js';

describe('computeQuizMasteryTrend', () => {
  it('combines quiz accuracy with card mastery and compares retakes with the previous attempt', () => {
    const first = computeQuizMasteryTrend({
      accuracy: 0.5,
      cardMasteryScore: 0.75
    });
    expect(first).toEqual({
      accuracyDelta: 0,
      masteryScore: 0.625,
      masteryDelta: -0.125
    });

    const retake = computeQuizMasteryTrend({
      accuracy: 1,
      cardMasteryScore: 0.75,
      previousAccuracy: 0.5,
      previousMasteryScore: first.masteryScore
    });
    expect(retake).toEqual({
      accuracyDelta: 0.5,
      masteryScore: 0.875,
      masteryDelta: 0.25
    });
  });
});
