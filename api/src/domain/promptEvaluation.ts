import type { QualityMetrics } from './qualityScoring.js';

export type PromptRegressionThresholds = {
  maxDropByMetric: Record<keyof QualityMetrics, number>;
  maxAverageDrop: number;
};

export type PromptRegressionRun = {
  topicId: string;
  baseline: QualityMetrics;
  candidate: QualityMetrics;
};

export type PromptRegressionTopicResult = {
  topicId: string;
  baseline: QualityMetrics;
  candidate: QualityMetrics;
  drops: QualityMetrics;
  averageDrop: number;
  pass: boolean;
  failures: Array<keyof QualityMetrics | 'averageDrop'>;
};

export type PromptRegressionResult = {
  pass: boolean;
  topicResults: PromptRegressionTopicResult[];
  failedTopics: PromptRegressionTopicResult[];
};

const nonNegativeDrop = (baseline: number, candidate: number): number => Math.max(0, baseline - candidate);

const average = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
};

const metricKeys: Array<keyof QualityMetrics> = ['summaryQuality', 'citationCoverage', 'quizValidity', 'graphCoherence'];

export const evaluatePromptRegression = (
  runs: PromptRegressionRun[],
  thresholds: PromptRegressionThresholds
): PromptRegressionResult => {
  const topicResults = runs.map((run): PromptRegressionTopicResult => {
    const drops: QualityMetrics = {
      summaryQuality: nonNegativeDrop(run.baseline.summaryQuality, run.candidate.summaryQuality),
      citationCoverage: nonNegativeDrop(run.baseline.citationCoverage, run.candidate.citationCoverage),
      quizValidity: nonNegativeDrop(run.baseline.quizValidity, run.candidate.quizValidity),
      graphCoherence: nonNegativeDrop(run.baseline.graphCoherence, run.candidate.graphCoherence)
    };

    const failures: Array<keyof QualityMetrics | 'averageDrop'> = [];
    for (const key of metricKeys) {
      if (drops[key] > thresholds.maxDropByMetric[key]) {
        failures.push(key);
      }
    }

    const averageDrop = average(metricKeys.map((key) => drops[key]));
    if (averageDrop > thresholds.maxAverageDrop) {
      failures.push('averageDrop');
    }

    return {
      topicId: run.topicId,
      baseline: run.baseline,
      candidate: run.candidate,
      drops,
      averageDrop,
      pass: failures.length === 0,
      failures
    };
  });

  const failedTopics = topicResults.filter((topic) => !topic.pass);
  return {
    pass: failedTopics.length === 0,
    topicResults,
    failedTopics
  };
};
