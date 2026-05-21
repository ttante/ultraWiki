import { describe, expect, it } from 'vitest';
import {
  createStudyPackRequestSchema,
  artifactSchemaVersion,
  outcomesAnalyticsSchema,
  quizAttemptRequestSchema,
  studyPackSchema
} from '../src/contracts/studyPack.js';

describe('contracts', () => {
  it('accepts create study pack request shape', () => {
    const result = createStudyPackRequestSchema.safeParse({
      title_or_url: 'Alan Turing',
      idempotency_key: 'idem-12345'
    });
    expect(result.success).toBe(true);
  });

  it('enforces schema version on study pack', () => {
    const result = studyPackSchema.safeParse({
      id: 'p1',
      input: 'Alan Turing',
      source_revision_id: '123',
      source_attribution: {
        canonical_url: 'https://en.wikipedia.org/wiki/Alan_Turing',
        revision_url: 'https://en.wikipedia.org/wiki/Alan_Turing?oldid=123',
        license: 'CC BY-SA 4.0'
      },
      schema_version: artifactSchemaVersion,
      grounding_stats: { citation_rate: 1, unsupported_claims: 0 },
      sections: [{ heading: 'Overview', content: 'content' }],
      summaries: [
        {
          level: 'beginner',
          text: 'summary',
          citations: ['c1'],
          prompt_version: 'summary-by-level@1.0.0',
          model: 'local-rule-based'
        }
      ],
      flashcards: [
        {
          question: 'q',
          answer: 'a',
          citation: 'c',
          prompt_version: 'active-recall@1.0.0',
          model: 'local-rule-based'
        }
      ],
      quiz_questions: [
        {
          question: 'q',
          options: ['a', 'b', 'c', 'd'],
          correct_index: 0,
          explanation: 'e',
          citation: 'c',
          prompt_version: 'active-recall@1.0.0',
          model: 'local-rule-based'
        }
      ],
      graph: {
        nodes: [
          {
            id: 'alan-turing',
            label: 'Alan Turing',
            type: 'person',
            citation: 'source:1|"Alan Turing..."'
          }
        ],
        edges: [
          {
            source: 'alan-turing',
            target: 'john-mccarthy',
            relation: 'influenced',
            citation: 'source:2|"..."'
          }
        ]
      },
      timeline: [
        {
          year: 1950,
          date_label: '1950',
          description: 'Alan Turing influenced John McCarthy in 1950.',
          citation: 'source:1|"..."'
        }
      ]
    });
    expect(result.success).toBe(true);
  });

  it('validates quiz attempt request', () => {
    const result = quizAttemptRequestSchema.safeParse({
      pack_id: 'pack-1',
      selected_indices: [0, 1, 2, 3]
    });
    expect(result.success).toBe(true);
  });

  it('validates outcomes analytics payload', () => {
    const result = outcomesAnalyticsSchema.safeParse({
      generated_at: new Date().toISOString(),
      jobs: { completed: 4, failed: 1, avg_duration_ms: 1200, completion_rate: 0.8 },
      quality: { avg_citation_rate: 0.9, avg_flashcards: 15, avg_quiz_questions: 10 },
      learning: { attempts: 3, avg_accuracy: 0.66 },
      slo: {
        p95_time_to_first_artifact_ms: 18000,
        p95_full_pack_completion_ms: 42000,
        job_success_rate: 0.8,
        citation_coverage_rate: 0.9
      },
      cost: {
        total_estimated_usd: 0.14,
        avg_estimated_usd_per_pack: 0.035,
        by_stage: [
          {
            stage: 'summarization',
            events: 4,
            avg_tokens: 1800,
            avg_latency_ms: 4200,
            total_estimated_usd: 0.08,
            avg_estimated_usd: 0.02
          }
        ]
      }
    });
    expect(result.success).toBe(true);
  });
});
