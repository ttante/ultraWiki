import { describe, expect, it } from 'vitest';
import {
  evaluatePromptRegression,
  type PromptRegressionRun,
  type PromptRegressionThresholds
} from '../src/domain/promptEvaluation.js';

const thresholds: PromptRegressionThresholds = {
  maxDropByMetric: {
    summaryQuality: 0.03,
    citationCoverage: 0.01,
    quizValidity: 0.01,
    graphCoherence: 0.02
  },
  maxAverageDrop: 0.01
};

describe('evaluatePromptRegression', () => {
  it('passes when quality deltas stay inside thresholds', () => {
    const runs: PromptRegressionRun[] = [
      {
        topicId: 'topic-pass',
        baseline: {
          summaryQuality: 0.85,
          citationCoverage: 0.95,
          quizValidity: 0.9,
          graphCoherence: 0.88
        },
        candidate: {
          summaryQuality: 0.83,
          citationCoverage: 0.95,
          quizValidity: 0.9,
          graphCoherence: 0.87
        }
      }
    ];

    const result = evaluatePromptRegression(runs, thresholds);
    expect(result.pass).toBe(true);
    expect(result.failedTopics).toHaveLength(0);
  });

  it('fails when per-metric or average drop thresholds are exceeded', () => {
    const runs: PromptRegressionRun[] = [
      {
        topicId: 'topic-fail',
        baseline: {
          summaryQuality: 0.85,
          citationCoverage: 0.95,
          quizValidity: 0.9,
          graphCoherence: 0.88
        },
        candidate: {
          summaryQuality: 0.75,
          citationCoverage: 0.95,
          quizValidity: 0.9,
          graphCoherence: 0.88
        }
      }
    ];

    const result = evaluatePromptRegression(runs, thresholds);
    expect(result.pass).toBe(false);
    expect(result.failedTopics).toHaveLength(1);
    expect(result.failedTopics[0]?.topicId).toBe('topic-fail');
    expect(result.failedTopics[0]?.failures).toContain('summaryQuality');
  });
});
