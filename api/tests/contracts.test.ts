import { describe, expect, it } from 'vitest';
import {
  createStudyPackRequestSchema,
  artifactSchemaVersion,
  costAnalyticsSchema,
  outcomesAnalyticsSchema,
  queueStatusSchema,
  quizAttemptRequestSchema,
  sloAnalyticsSchema,
  studyPackHistorySchema,
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
    const sourceProvenance = {
      source_revision_id: '123',
      citation: 'source:1|"..."',
      revision_url: 'https://en.wikipedia.org/wiki/Alan_Turing?oldid=123',
      license: 'CC BY-SA 4.0'
    };
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
          model: 'local-rule-based',
          source_provenance: [{ ...sourceProvenance, citation: 'c1' }]
        }
      ],
      flashcards: [
        {
          question: 'q',
          answer: 'a',
          citation: 'c',
          prompt_version: 'active-recall@1.0.0',
          model: 'local-rule-based',
          source_provenance: { ...sourceProvenance, citation: 'c' }
        }
      ],
      glossary: [
        {
          term: 'Computation',
          definition: 'A source-grounded concept connected to Alan Turing.',
          citation: 'c',
          prompt_version: 'glossary@1.0.0',
          model: 'local-rule-based',
          source_provenance: { ...sourceProvenance, citation: 'c' }
        }
      ],
      quiz_questions: [
        {
          question: 'q',
          options: ['a', 'b', 'c', 'd'],
          correct_index: 0,
          misconceptions: ['a is cited', 'b is not cited', 'c is not cited', 'd is not cited'],
          explanation: 'e',
          citation: 'c',
          prompt_version: 'active-recall@1.0.0',
          model: 'local-rule-based',
          source_provenance: { ...sourceProvenance, citation: 'c' }
        }
      ],
      graph: {
        nodes: [
          {
            id: 'alan-turing',
            label: 'Alan Turing',
            type: 'person',
            citation: 'source:1|"Alan Turing..."',
            source_provenance: { ...sourceProvenance, citation: 'source:1|"Alan Turing..."' }
          }
        ],
        edges: [
          {
            source: 'alan-turing',
            target: 'john-mccarthy',
            relation: 'influenced',
            citation: 'source:2|"..."',
            source_provenance: { ...sourceProvenance, citation: 'source:2|"..."' }
          }
        ]
      },
      timeline: [
        {
          year: 1950,
          date_label: '1950',
          description: 'Alan Turing influenced John McCarthy in 1950.',
          citation: 'source:1|"..."',
          source_provenance: sourceProvenance
        }
      ],
      recommendations: [
        {
          title: 'Computability theory',
          url: 'https://en.wikipedia.org/wiki/Computability_theory',
          rationale: 'Linked from Overview in the source article.',
          score: 0.72,
          source_heading: 'Overview'
        }
      ],
      cache: {
        source: {
          stage: 'source',
          cache_key: 'wikipedia:en:alan turing',
          hit: false,
          source_revision_id: '123',
          parser_version: 'wikipedia-parser@1.0.0'
        },
        artifacts: [
          {
            stage: 'summaries',
            cache_key: 'summaries:123:summary-by-level@1.0.0:1.0.0',
            hit: false,
            source_revision_id: '123',
            prompt_version: 'summary-by-level@1.0.0',
            taxonomy_version: '1.0.0'
          }
        ]
      },
      readiness: {
        status: 'full',
        missing_artifacts: [],
        can_resume: false
      }
    });
    expect(result.success).toBe(true);
  });

  it('validates queue status payloads', () => {
    const result = queueStatusSchema.safeParse({
      queued: 1,
      running: 2,
      max_queue_depth: 100,
      global_concurrency_limit: 4,
      session_inflight: 1,
      session_concurrency_limit: 1,
      capacity_state: 'session_limit'
    });
    expect(result.success).toBe(true);
  });

  it('validates study pack history payloads', () => {
    const result = studyPackHistorySchema.safeParse({
      items: [
        {
          id: 'pack-1',
          input: 'Ada Lovelace',
          source_revision_id: 'rev-1',
          created_at: new Date().toISOString(),
          latest_job: {
            id: 'job-1',
            status: 'completed',
            stage: 'done',
            progress: 100,
            updated_at: new Date().toISOString(),
            degradation_state: 'none'
          },
          readiness: {
            status: 'full',
            missing_artifacts: [],
            can_resume: false
          }
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

  it('validates cost analytics payload', () => {
    const result = costAnalyticsSchema.safeParse({
      generated_at: new Date().toISOString(),
      window_hours: 24,
      total_estimated_usd: 0.12,
      avg_estimated_usd_per_pack: 0.06,
      by_stage: [
        {
          stage: 'active_recall',
          events: 2,
          avg_tokens: 900,
          avg_latency_ms: 2200,
          total_estimated_usd: 0.04,
          avg_estimated_usd: 0.02
        }
      ],
      by_pack: [
        {
          pack_id: 'pack-1',
          events: 3,
          estimated_tokens: 2100,
          total_estimated_usd: 0.06,
          avg_estimated_usd: 0.02
        }
      ],
      by_prompt_model: [
        {
          prompt_version: 'active-recall@1.0.0',
          model: 'local-rule-based',
          events: 2,
          avg_latency_ms: 2200,
          estimated_tokens: 1800,
          total_estimated_usd: 0.04
        }
      ],
      llm_ops: {
        calls: {
          attempted: 1,
          succeeded: 1,
          fallback: 0,
          invalid_responses: 0,
          timeouts: 0,
          timeout_rate: 0
        },
        by_stage_model: [
          {
            provider: 'openai_compatible',
            model: 'qwen2.5-14b-instruct-q4_k_m',
            stage: 'active_recall',
            attempted: 1,
            succeeded: 1,
            fallback: 0,
            avg_latency_ms: 2200,
            p95_latency_ms: 2200
          }
        ],
        fallbacks_by_reason: []
      }
    });
    expect(result.success).toBe(true);
  });

  it('validates slo analytics payload', () => {
    const result = sloAnalyticsSchema.safeParse({
      generated_at: new Date().toISOString(),
      targets: [
        {
          id: 'job_success_rate',
          name: 'Job success rate',
          metric: 'ultrawiki_slo_job_success_rate',
          promql: 'ultrawiki_slo_job_success_rate',
          target: 0.99,
          comparator: '>=',
          window: '30d',
          owner: 'reliability'
        }
      ],
      current: {
        p95_time_to_first_artifact_ms: 18000,
        p95_full_pack_completion_ms: 42000,
        job_success_rate: 0.99,
        citation_coverage_rate: 0.9
      }
    });
    expect(result.success).toBe(true);
  });
});
