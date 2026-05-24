import { describe, expect, it } from 'vitest';
import { evaluateQualityScore, validateQualityThresholds } from '../src/domain/qualityScoring.js';

describe('quality scoring', () => {
  it('passes when all quality dimensions meet thresholds', () => {
    const result = evaluateQualityScore(
      {
        summaries: [
          {
            level: 'beginner',
            text: 'This beginner summary includes enough detail to exceed minimum density and includes citation evidence.',
            citations: ['section:1|"..."'],
            promptVersion: 'summary-by-level@1.0.0',
            model: 'local-rule-based'
          },
          {
            level: 'intermediate',
            text: 'This intermediate summary expands on causal relationships, context, and constraints from the source.',
            citations: ['section:2|"..."'],
            promptVersion: 'summary-by-level@1.0.0',
            model: 'local-rule-based'
          },
          {
            level: 'advanced',
            text: 'This advanced summary adds nuanced interpretation, technical framing, and source-backed caveats for expert readers.',
            citations: ['section:3|"..."'],
            promptVersion: 'summary-by-level@1.0.0',
            model: 'local-rule-based'
          }
        ],
        citationCoverageRate: 0.95,
        quizQuestions: [
          {
            question: 'Which source-backed statement best summarizes the core contribution described in the article?',
            options: ['Option A', 'Option B', 'Option C', 'Option D'],
            correctIndex: 2,
            explanation: 'Option C aligns with the cited statement and preserves the key constraints from the source.',
            citation: 'source:1|"..."',
            promptVersion: 'active-recall@1.0.0',
            model: 'local-rule-based'
          }
        ],
        graphNodes: [
          { id: 'n1', label: 'Node 1', type: 'concept', citation: 'source:1|"..."' },
          { id: 'n2', label: 'Node 2', type: 'concept', citation: 'source:2|"..."' }
        ],
        graphEdges: [{ source: 'n1', target: 'n2', relation: 'related_to', citation: 'source:2|"..."' }]
      },
      {
        summaryQualityMin: 0.75,
        citationCoverageMin: 0.85,
        quizValidityMin: 0.9,
        graphCoherenceMin: 0.8
      }
    );

    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails dimensions that violate thresholds', () => {
    const result = evaluateQualityScore(
      {
        summaries: [
          {
            level: 'beginner',
            text: 'Short.',
            citations: [],
            promptVersion: 'summary-by-level@1.0.0',
            model: 'local-rule-based'
          }
        ],
        citationCoverageRate: 0.2,
        quizQuestions: [
          {
            question: 'Bad?',
            options: ['A', 'A', 'B'],
            correctIndex: 10,
            explanation: 'no',
            citation: '',
            promptVersion: 'active-recall@1.0.0',
            model: 'local-rule-based'
          }
        ],
        graphNodes: [{ id: 'n1', label: 'Node 1', type: 'concept', citation: '' }],
        graphEdges: [{ source: 'n2', target: 'n3', relation: 'related_to', citation: '' }]
      },
      {
        summaryQualityMin: 0.75,
        citationCoverageMin: 0.85,
        quizValidityMin: 0.9,
        graphCoherenceMin: 0.8
      }
    );

    expect(result.pass).toBe(false);
    expect(result.failures).toEqual([
      'summaryQuality',
      'citationCoverage',
      'quizValidity',
      'graphCoherence'
    ]);
  });

  it('rejects invalid threshold configuration before scoring', () => {
    expect(
      validateQualityThresholds({
        summaryQualityMin: 1.1,
        citationCoverageMin: 0.85,
        quizValidityMin: -0.1,
        graphCoherenceMin: 0.8
      })
    ).toEqual(['summaryQuality threshold must be between 0 and 1', 'quizValidity threshold must be between 0 and 1']);

    expect(() =>
      evaluateQualityScore(
        {
          summaries: [],
          citationCoverageRate: 0,
          quizQuestions: [],
          graphNodes: [],
          graphEdges: []
        },
        {
          summaryQualityMin: 1.1,
          citationCoverageMin: 0.85,
          quizValidityMin: 0.9,
          graphCoherenceMin: 0.8
        }
      )
    ).toThrow('Invalid quality thresholds');
  });
});
