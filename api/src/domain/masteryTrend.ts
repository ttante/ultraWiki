export type QuizMasteryTrendInput = {
  accuracy: number;
  cardMasteryScore: number;
  previousAccuracy?: number;
  previousMasteryScore?: number;
};

export type QuizMasteryTrend = {
  accuracyDelta: number;
  masteryScore: number;
  masteryDelta: number;
};

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));
const roundMetric = (value: number): number => Number(value.toFixed(4));

export const computeQuizMasteryTrend = ({
  accuracy,
  cardMasteryScore,
  previousAccuracy,
  previousMasteryScore
}: QuizMasteryTrendInput): QuizMasteryTrend => {
  const normalizedAccuracy = clampUnit(accuracy);
  const normalizedCardMastery = clampUnit(cardMasteryScore);
  const masteryScore = roundMetric((normalizedAccuracy + normalizedCardMastery) / 2);
  const masteryBaseline = previousMasteryScore ?? normalizedCardMastery;

  return {
    accuracyDelta: roundMetric(previousAccuracy === undefined ? 0 : normalizedAccuracy - previousAccuracy),
    masteryScore,
    masteryDelta: roundMetric(masteryScore - masteryBaseline)
  };
};
