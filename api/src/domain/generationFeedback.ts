import type {
  GenerationFeedbackArtifactType,
  GenerationFeedbackRecord,
  GenerationFeedbackSignal,
  GenerationFeedbackSummary
} from '../repo/types.js';

const negativeSignals = new Set<GenerationFeedbackSignal>([
  'unclear',
  'incorrect',
  'missing_citation',
  'too_shallow',
  'unsafe'
]);

export const isNegativeGenerationFeedback = (rating: number, signal: GenerationFeedbackSignal): boolean =>
  rating <= 2 || negativeSignals.has(signal);

export const emptyGenerationFeedbackSummary = (): GenerationFeedbackSummary => ({
  dataset: 'user_feedback',
  trustedArtifact: false,
  contaminatesGoldenSet: false,
  requiresHumanReview: true,
  totalFeedback: 0,
  negativeFeedback: 0,
  averageRating: 0,
  latestFeedbackAt: undefined,
  byArtifact: []
});

export const summarizeGenerationFeedback = (records: GenerationFeedbackRecord[]): GenerationFeedbackSummary => {
  if (records.length === 0) {
    return emptyGenerationFeedbackSummary();
  }

  const grouped = records.reduce((acc, record) => {
    const current =
      acc.get(record.artifactType) ??
      ({
        artifactType: record.artifactType,
        records: [] as GenerationFeedbackRecord[],
        signals: new Map<GenerationFeedbackSignal, number>()
      } satisfies {
        artifactType: GenerationFeedbackArtifactType;
        records: GenerationFeedbackRecord[];
        signals: Map<GenerationFeedbackSignal, number>;
      });
    current.records.push(record);
    current.signals.set(record.signal, (current.signals.get(record.signal) ?? 0) + 1);
    acc.set(record.artifactType, current);
    return acc;
  }, new Map<GenerationFeedbackArtifactType, { artifactType: GenerationFeedbackArtifactType; records: GenerationFeedbackRecord[]; signals: Map<GenerationFeedbackSignal, number> }>());

  const totalRating = records.reduce((acc, record) => acc + record.rating, 0);
  const latestFeedbackAt = records
    .map((record) => record.createdAt)
    .sort()
    .at(-1);

  return {
    ...emptyGenerationFeedbackSummary(),
    totalFeedback: records.length,
    negativeFeedback: records.filter((record) => isNegativeGenerationFeedback(record.rating, record.signal)).length,
    averageRating: totalRating / records.length,
    latestFeedbackAt,
    byArtifact: Array.from(grouped.values())
      .map((group) => ({
        artifactType: group.artifactType,
        totalFeedback: group.records.length,
        negativeFeedback: group.records.filter((record) => isNegativeGenerationFeedback(record.rating, record.signal)).length,
        averageRating: group.records.reduce((acc, record) => acc + record.rating, 0) / group.records.length,
        latestFeedbackAt: group.records
          .map((record) => record.createdAt)
          .sort()
          .at(-1),
        signals: Array.from(group.signals.entries())
          .map(([signal, count]) => ({ signal, count }))
          .sort((left, right) => right.count - left.count || left.signal.localeCompare(right.signal))
      }))
      .sort((left, right) => right.totalFeedback - left.totalFeedback || left.artifactType.localeCompare(right.artifactType))
  };
};
