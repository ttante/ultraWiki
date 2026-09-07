import { copyFile, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildPromptEvaluationSnapshot,
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

const apiRoot = process.cwd().endsWith(`${path.sep}api`) ? process.cwd() : path.resolve(process.cwd(), 'api');
const repoRoot = path.resolve(apiRoot, '..');
const promptEvaluationRuntimeAssets = [
  'api/fixtures/golden-set.json',
  'infra/prompts/registry.json',
  'infra/evaluation/quality-scoring-thresholds.json',
  'infra/evaluation/prompt-regression-thresholds.json'
];

const copyRuntimeAsset = async (assetPath: string, targetRoot: string): Promise<void> => {
  const sourcePath = path.resolve(repoRoot, assetPath);
  const targetPath = path.resolve(targetRoot, assetPath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
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

  it('returns side-by-side topic metrics and average-drop failures for audit reports', () => {
    const runs: PromptRegressionRun[] = [
      {
        topicId: 'topic-average-drop',
        baseline: {
          summaryQuality: 0.9,
          citationCoverage: 0.9,
          quizValidity: 0.9,
          graphCoherence: 0.9
        },
        candidate: {
          summaryQuality: 0.88,
          citationCoverage: 0.88,
          quizValidity: 0.88,
          graphCoherence: 0.88
        }
      }
    ];

    const result = evaluatePromptRegression(runs, {
      maxDropByMetric: {
        summaryQuality: 0.03,
        citationCoverage: 0.03,
        quizValidity: 0.03,
        graphCoherence: 0.03
      },
      maxAverageDrop: 0.01
    });

    expect(result.pass).toBe(false);
    expect(result.topicResults[0]).toMatchObject({
      topicId: 'topic-average-drop',
      baseline: runs[0].baseline,
      candidate: runs[0].candidate,
      failures: ['averageDrop']
    });
    expect(result.topicResults[0]?.drops.summaryQuality).toBeCloseTo(0.02);
    expect(result.topicResults[0]?.drops.citationCoverage).toBeCloseTo(0.02);
    expect(result.topicResults[0]?.drops.quizValidity).toBeCloseTo(0.02);
    expect(result.topicResults[0]?.drops.graphCoherence).toBeCloseTo(0.02);
  });

  it('builds a read-only golden-set and prompt-regression snapshot for the Ops UI', async () => {
    const snapshot = await buildPromptEvaluationSnapshot({
      generatedAt: '2026-01-01T00:00:00.000Z',
      model: 'local-rule-based'
    });

    expect(snapshot.goldenSet).toMatchObject({
      pass: true,
      topics: 6,
      failedTopics: 0,
      qualityThresholdVersion: '2026-05-20'
    });
    expect(snapshot.promptRegression).toMatchObject({
      pass: true,
      promptId: 'summary-by-level',
      baseline: { promptVersion: 'summary-by-level@1.0.0', status: 'active' },
      candidate: { promptVersion: 'summary-by-level@1.1.0', status: 'draft' },
      topics: 6,
      failedTopics: 0
    });
    expect(snapshot.promptRegression.topicResults[0]).toEqual(
      expect.objectContaining({
        title: expect.any(String),
        domain: expect.any(String),
        maxMetricDrop: expect.any(Number)
      })
    );
  });

  it('keeps prompt evaluation assets available in the packaged API runtime layout', async () => {
    const dockerfile = await readFile(path.resolve(apiRoot, 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('COPY infra/evaluation ./infra/evaluation');
    expect(dockerfile).toContain('COPY --from=build /repo/api/fixtures ./api/fixtures');
    expect(dockerfile).toContain('COPY --from=build /repo/infra/evaluation ./infra/evaluation');
    expect(dockerfile).toContain('COPY --from=build /repo/infra/prompts ./infra/prompts');

    const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'ultrawiki-api-runtime-'));
    await Promise.all(promptEvaluationRuntimeAssets.map((assetPath) => copyRuntimeAsset(assetPath, runtimeRoot)));

    const snapshot = await buildPromptEvaluationSnapshot({
      rootDir: runtimeRoot,
      generatedAt: '2026-01-01T00:00:00.000Z',
      model: 'local-rule-based'
    });

    expect(snapshot.goldenSet.pass).toBe(true);
    expect(snapshot.promptRegression.pass).toBe(true);
    expect(snapshot.promptRegression.topicResults).toHaveLength(6);
  });
});
