import { describe, expect, it } from 'vitest';
import {
  createBatchStudyPackRequestSchema,
  createBatchStudyPackResponseSchema,
  createShareLinkRequestSchema,
  createShareLinkResponseSchema,
  createStudyPackRequestSchema,
  artifactSchemaVersion,
  costAnalyticsSchema,
  costDrilldownAnalyticsSchema,
  flashcardReviewRequestSchema,
  flashcardReviewResponseSchema,
  learningAnalyticsSchema,
  localLlmRuntimeHealthSchema,
  learningProgressSchema,
  learningReminderSchema,
  learningSessionSchema,
  learningSessionStartRequestSchema,
  outcomesAnalyticsSchema,
  promptEvaluationSchema,
  queueStatusSchema,
  realModelSmokeStatusSchema,
  realModelSmokeTriggerRequestSchema,
  quizAttemptListResponseSchema,
  quizAttemptRequestSchema,
  quizAttemptResponseSchema,
  revokeShareLinkResponseSchema,
  runtimePresetVisibilitySchema,
  savedPackVersionHistorySchema,
  sloAnalyticsSchema,
  studyGoalSchema,
  studyPackHistorySchema,
  studyPackSchema,
  upsertStudyGoalRequestSchema,
  userDataDeleteResponseSchema,
  userDataExportSchema,
  userProfileSchema
} from '../src/contracts/studyPack.js';

describe('contracts', () => {
  it('accepts create study pack request shape', () => {
    const result = createStudyPackRequestSchema.safeParse({
      title_or_url: 'Alan Turing',
      idempotency_key: 'idem-12345'
    });
    expect(result.success).toBe(true);
  });

  it('validates batch study pack request and response shapes', () => {
    const request = createBatchStudyPackRequestSchema.safeParse({
      idempotency_key: 'batch-123456',
      topics: ['Ada Lovelace', 'Grace Hopper']
    });
    expect(request.success).toBe(true);

    const response = createBatchStudyPackResponseSchema.safeParse({
      batch_idempotency_key: 'batch-123456',
      accepted_at: new Date().toISOString(),
      summary: {
        requested: 2,
        accepted: 1,
        reused: 0,
        rejected: 0,
        deferred: 1
      },
      capacity_before: {
        queued: 0,
        running: 0,
        max_queue_depth: 100,
        global_concurrency_limit: 2,
        session_inflight: 0,
        session_concurrency_limit: 1,
        capacity_state: 'open'
      },
      capacity_after: {
        queued: 1,
        running: 0,
        max_queue_depth: 100,
        global_concurrency_limit: 2,
        session_inflight: 1,
        session_concurrency_limit: 1,
        capacity_state: 'session_limit'
      },
      items: [
        { index: 0, title_or_url: 'Ada Lovelace', status: 'accepted', pack_id: 'pack-1', job_id: 'job-1' },
        { index: 1, title_or_url: 'Grace Hopper', status: 'deferred', reason: 'session_limit' }
      ]
    });
    expect(response.success).toBe(true);
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
          },
          organization: {
            tags: ['math'],
            collection: 'STEM'
          }
        }
      ],
      facets: {
        total: 1,
        readiness: { full: 1, partial: 0 },
        progress: { due: 0, reviewed: 0, not_started: 1 },
        tags: [{ tag: 'math', count: 1 }],
        collections: [{ collection: 'STEM', count: 1 }]
      }
    });
    expect(result.success).toBe(true);
  });

  it('validates saved pack version history payloads', () => {
    const versionItem = {
      id: 'pack-2',
      input: 'Ada Lovelace',
      source_revision_id: 'rev-2',
      created_at: new Date().toISOString(),
      saved_at: new Date().toISOString(),
      latest_job: null,
      readiness: {
        status: 'full',
        missing_artifacts: [],
        can_resume: false
      },
      current: true,
      source_revision_changed: false,
      artifact_counts: {
        summaries: 1,
        glossary: 1,
        flashcards: 2,
        quiz_questions: 1,
        graph_nodes: 1,
        graph_edges: 0,
        timeline_events: 0
      }
    };
    const result = savedPackVersionHistorySchema.safeParse({
      current: versionItem,
      versions: [
        versionItem,
        {
          ...versionItem,
          id: 'pack-1',
          source_revision_id: 'rev-1',
          current: false,
          source_revision_changed: true,
          artifact_counts: {
            ...versionItem.artifact_counts,
            flashcards: 1
          }
        }
      ],
      compare: {
        baseline_pack_id: 'pack-1',
        baseline_source_revision_id: 'rev-1',
        source_revision_changed: true,
        readiness_changed: false,
        artifact_deltas: {
          summaries: 0,
          glossary: 0,
          flashcards: 1,
          quiz_questions: 0,
          graph_nodes: 0,
          graph_edges: 0,
          timeline_events: 0
        },
        missing_artifacts_added: [],
        missing_artifacts_removed: []
      }
    });
    expect(result.success).toBe(true);
  });

  it('validates quiz attempt request', () => {
    const result = quizAttemptRequestSchema.safeParse({
      pack_id: 'pack-1',
      selected_indices: [0, 1, 2, 3]
    });
    expect(result.success).toBe(true);
    const attempt = {
      attempt_id: 'attempt-1',
      user_id: 'user-1',
      pack_id: 'pack-1',
      attempt_number: 2,
      selected_indices: [0, 1, 2, 3],
      total_questions: 4,
      correct_answers: 3,
      accuracy: 0.75,
      previous_accuracy: 0.5,
      accuracy_delta: 0.25,
      card_mastery_score: 0.8,
      mastery_score: 0.775,
      mastery_delta: 0.125,
      submitted_at: new Date().toISOString()
    };
    expect(quizAttemptResponseSchema.safeParse(attempt).success).toBe(true);
    expect(quizAttemptListResponseSchema.safeParse({ items: [attempt] }).success).toBe(true);
  });

  it('validates account, sharing, and learning progress payloads', () => {
    expect(userProfileSchema.safeParse({
      user_id: 'user-1',
      display_name: 'Tyler',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).success).toBe(true);
    expect(createShareLinkRequestSchema.safeParse({ role: 'viewer' }).success).toBe(true);
    expect(createShareLinkResponseSchema.safeParse({
      share: {
        share_id: 'share-1',
        pack_id: 'pack-1',
        owner_user_id: 'user-1',
        role: 'viewer',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString()
      },
      share_path: '/api/shared/share-1'
    }).success).toBe(true);
    expect(revokeShareLinkResponseSchema.safeParse({
      share_id: 'share-1',
      revoked: true,
      revoked_at: new Date().toISOString()
    }).success).toBe(true);
    expect(flashcardReviewRequestSchema.safeParse({ rating: 'good' }).success).toBe(true);
    expect(learningProgressSchema.safeParse({
      user_id: 'user-1',
      pack_id: 'pack-1',
      total_cards: 2,
      reviewed_cards: 1,
      due_cards: 1,
      mastery_score: 0.5,
      next_due_at: new Date().toISOString(),
      cards: [
        {
          card_index: 0,
          reviewed: true,
          due: false,
          last_rating: 'good',
          reviewed_at: new Date().toISOString(),
          next_due_at: new Date().toISOString()
        },
        {
          card_index: 1,
          reviewed: false,
          due: true
        }
      ]
    }).success).toBe(true);
    expect(learningSessionSchema.safeParse({
      session_id: 'session-1',
      user_id: 'user-1',
      pack_id: 'pack-1',
      status: 'ready',
      started_at: new Date().toISOString(),
      reviewed_count: 1,
      queue: [
        {
          position: 1,
          card_index: 1,
          question: 'q2',
          answer: 'a2',
          citation: 'c2',
          prompt_version: 'active-recall@1.0.0',
          model: 'local-rule-based',
          reviewed: false,
          due: true
        }
      ],
      metrics: {
        total_cards: 2,
        reviewed_cards: 1,
        due_cards: 1,
        session_total: 2,
        completed_cards: 1,
        remaining_cards: 1,
        mastery_score: 0.5,
        mastery_delta: 0.2
      }
    }).success).toBe(true);
    expect(learningSessionStartRequestSchema.safeParse({
      baseline_due_cards: 2,
      baseline_mastery_score: 0.5
    }).success).toBe(true);
    expect(studyGoalSchema.safeParse({
      user_id: 'user-1',
      daily_target_reviews: 3,
      reviews_today: 1,
      remaining_today: 2,
      target_met: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).success).toBe(true);
    expect(upsertStudyGoalRequestSchema.safeParse({ daily_target_reviews: 3 }).success).toBe(true);
    expect(upsertStudyGoalRequestSchema.safeParse({ daily_target_reviews: 201 }).success).toBe(false);
    const exportedData = {
      user_id: 'user-1',
      exported_at: new Date().toISOString(),
      profile: {
        user_id: 'user-1',
        display_name: 'Tyler',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      library: [{ pack_id: 'pack-1', saved_at: new Date().toISOString(), organization: { tags: ['math'], collection: 'STEM' } }],
      shares: [
        {
          share_id: 'share-1',
          pack_id: 'pack-1',
          owner_user_id: 'user-1',
          role: 'viewer',
          created_at: new Date().toISOString(),
          revoked_at: new Date().toISOString()
        }
      ],
      flashcard_reviews: [
        {
          review_id: 'review-1',
          user_id: 'user-1',
          pack_id: 'pack-1',
          card_index: 0,
          rating: 'good',
          reviewed_at: new Date().toISOString(),
          next_due_at: new Date().toISOString()
        }
      ],
      learning_sessions: [
        {
          session_id: 'session-1',
          user_id: 'user-1',
          pack_id: 'pack-1',
          status: 'completed',
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          baseline_due_cards: 1,
          baseline_mastery_score: 0,
          reviewed_count: 1,
          outcome: {
            completed_cards: 1,
            remaining_cards: 0,
            mastery_score: 1,
            mastery_delta: 1
          }
        }
      ],
      quiz_attempts: [
        {
          attempt_id: 'attempt-1',
          user_id: 'user-1',
          pack_id: 'pack-1',
          attempt_number: 1,
          selected_indices: [0],
          total_questions: 1,
          correct_answers: 1,
          accuracy: 1,
          accuracy_delta: 0,
          card_mastery_score: 1,
          mastery_score: 1,
          mastery_delta: 0,
          submitted_at: new Date().toISOString()
        }
      ],
      study_goal: {
        user_id: 'user-1',
        daily_target_reviews: 3,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      generation_feedback: [
        {
          feedback_id: 'feedback-1',
          user_id: 'user-1',
          pack_id: 'pack-1',
          artifact_type: 'quiz',
          rating: 2,
          signal: 'incorrect',
          comment: 'Answer key looked wrong.',
          prompt_version: 'active-recall@1.0.0',
          model: 'local-rule-based',
          created_at: new Date().toISOString(),
          governance: {
            dataset: 'user_feedback',
            trusted_artifact: false,
            eval_candidate: true,
            contaminates_golden_set: false,
            requires_human_review: true
          }
        }
      ]
    };
    expect(userDataExportSchema.safeParse(exportedData).success).toBe(true);
    expect(JSON.stringify(exportedData)).not.toContain('token_hash');
    expect(userDataDeleteResponseSchema.safeParse({
      user_id: 'user-1',
      deleted_at: new Date().toISOString(),
      deleted: {
        profile: true,
        library: 1,
        shares: 1,
        flashcard_reviews: 1,
        learning_sessions: 1,
        quiz_attempts: 1,
        study_goals: 1,
        generation_feedback: 1
      }
    }).success).toBe(true);
    expect(learningAnalyticsSchema.safeParse({
      user_id: 'user-1',
      generated_at: new Date().toISOString(),
      total_cards: 2,
      reviewed_cards: 1,
      due_cards: 1,
      due_packs: 1,
      streak: {
        current_days: 2,
        longest_days: 3,
        last_activity_at: new Date().toISOString()
      },
      goal: {
        daily_target_reviews: 3,
        reviews_today: 1,
        remaining_today: 2,
        target_met: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      retention: {
        reviewed_cards: 1,
        retained_cards: 1,
        due_reviewed_cards: 0,
        retention_rate: 1
      },
      mastery: {
        average_score: 0.5,
        average_delta: 0.2,
        trend: [
          {
            source: 'quiz',
            pack_id: 'pack-1',
            recorded_at: new Date().toISOString(),
            mastery_score: 0.7,
            mastery_delta: 0.2
          }
        ]
      },
      accuracy: {
        attempts: 2,
        retakes: 1,
        average_accuracy: 0.75,
        latest_accuracy: 1,
        accuracy_delta: 0.5,
        trend: [
          {
            pack_id: 'pack-1',
            attempt_number: 2,
            submitted_at: new Date().toISOString(),
            accuracy: 1,
            accuracy_delta: 0.5,
            mastery_score: 0.7
          }
        ]
      },
      packs: [
        {
          pack_id: 'pack-1',
          total_cards: 2,
          reviewed_cards: 1,
          due_cards: 1,
          retained_cards: 1,
          retention_rate: 1,
          mastery_score: 0.375,
          next_due_at: new Date().toISOString(),
          last_reviewed_at: new Date().toISOString(),
          quiz_attempts: 2,
          latest_accuracy: 1,
          accuracy_delta: 0.5
        }
      ]
    }).success).toBe(true);
    expect(learningReminderSchema.safeParse({
      user_id: 'user-1',
      generated_at: new Date().toISOString(),
      due_cards: 1,
      due_packs: 1,
      next_due_at: new Date().toISOString(),
      poll_after_seconds: 300,
      delivery: 'local_poll',
      external_notifications: false,
      packs: [
        {
          pack_id: 'pack-1',
          due_cards: 1,
          next_due_at: new Date().toISOString(),
          last_reviewed_at: new Date().toISOString()
        }
      ]
    }).success).toBe(true);
    expect(flashcardReviewResponseSchema.safeParse({
      review: {
        review_id: 'review-1',
        user_id: 'user-1',
        pack_id: 'pack-1',
        card_index: 0,
        rating: 'good',
        reviewed_at: new Date().toISOString(),
        next_due_at: new Date().toISOString()
      },
      progress: {
        user_id: 'user-1',
        pack_id: 'pack-1',
        total_cards: 1,
        reviewed_cards: 1,
        due_cards: 0,
        mastery_score: 0.75,
        cards: [{ card_index: 0, reviewed: true, due: false, last_rating: 'good' }]
      }
    }).success).toBe(true);
  });

  it('validates outcomes analytics payload', () => {
    const result = outcomesAnalyticsSchema.safeParse({
      generated_at: new Date().toISOString(),
      window_hours: 24,
      jobs: { completed: 4, failed: 1, avg_duration_ms: 1200, completion_rate: 0.8 },
      quality: { avg_citation_rate: 0.9, avg_flashcards: 15, avg_quiz_questions: 10 },
      learning: { attempts: 3, retakes: 1, avg_accuracy: 0.66, avg_mastery_score: 0.72, avg_mastery_delta: 0.08 },
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
      },
      security: {
        suspicious_inputs_total: 1,
        signature_alerts_total: 0,
        security_events_total: 2,
        rate_limit_events_total: 1,
        event_categories: [
          { category: 'auth', count: 1 },
          { category: 'rate_limit', count: 1 }
        ],
        rate_limit_events: [{ event_type: 'rate_limit.exceeded', count: 1 }],
        events: [
          { event_type: 'auth.authentication_required', count: 1 },
          { event_type: 'rate_limit.exceeded', count: 1 }
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
        fallbacks_by_reason: [],
        errors_by_type: [
          {
            provider: 'openai_compatible',
            model: 'qwen2.5-14b-instruct-q4_k_m',
            stage: 'active_recall',
            error_type: 'invalid_response',
            events: 1
          }
        ]
      }
    });
    expect(result.success).toBe(true);
  });

  it('validates local LLM runtime health payload', () => {
    const result = localLlmRuntimeHealthSchema.safeParse({
      generated_at: '2026-05-27T00:00:00.000Z',
      provider: 'openai_compatible',
      model: 'qwen2.5-14b-instruct-q4_k_m',
      base_url: 'http://localhost:8080/v1',
      runtime_preset: 'rtx4080_qwen14b_safe',
      quantization: 'q4_k_m',
      context_window: 4096,
      chunk_size: 1000,
      concurrency: 1,
      timeout_ms: 120000,
      status: 'degraded',
      fallback_mode: true,
      timeout_status: 'timeouts_recorded',
      calls: {
        attempted: 3,
        succeeded: 1,
        fallback: 1,
        timeouts: 1,
        timeout_rate: 0.333333
      },
      latency: {
        avg_ms: 2000,
        p95_ms: 3000
      },
      stages: [
        {
          provider: 'openai_compatible',
          model: 'qwen2.5-14b-instruct-q4_k_m',
          stage: 'summaries',
          attempted: 2,
          succeeded: 1,
          fallback: 1,
          avg_latency_ms: 1500,
          p95_latency_ms: 2400
        }
      ]
    });

    expect(result.success).toBe(true);
  });

  it('validates runtime preset visibility payload', () => {
    const result = runtimePresetVisibilitySchema.safeParse({
      generated_at: '2026-05-27T00:00:00.000Z',
      provider: 'openai_compatible',
      model: 'qwen2.5-14b-instruct-q4_k_m',
      default_preset_id: 'rtx4080_qwen14b_safe',
      current_preset_id: 'rtx4080_qwen14b_safe',
      fallback_mode: 'openai_with_rule_based_fallback',
      current_config: {
        quantization: 'q4_k_m',
        context_window: 4096,
        chunk_size: 1000,
        concurrency: 1,
        timeout_ms: 120000
      },
      presets: [
        {
          id: 'rtx4080_qwen14b_safe',
          model: 'qwen2.5-14b',
          hardware: 'rtx4080_12gb',
          quantization: 'q4_k_m',
          context_window: 4096,
          chunk_size: 1000,
          concurrency: 1,
          validated: true,
          selected: true,
          default: true
        }
      ]
    });

    expect(result.success).toBe(true);
  });

  it('validates real-model smoke trigger and status payloads', () => {
    expect(
      realModelSmokeTriggerRequestSchema.safeParse({
        confirm: 'run-real-model-smoke'
      }).success
    ).toBe(true);

    const result = realModelSmokeStatusSchema.safeParse({
      generated_at: '2026-05-27T00:00:00.000Z',
      enabled: true,
      local_only: true,
      status: 'passed',
      run_id: 'smoke-run-1',
      command: 'npm run smoke:real-llm',
      started_at: '2026-05-27T00:00:00.000Z',
      completed_at: '2026-05-27T00:04:00.000Z',
      exit_code: 0,
      output_tail: 'real LLM smoke passed',
      next_action: 'POST {"confirm":"run-real-model-smoke"} to /api/runtime/llm/smoke to start the local smoke.'
    });

    expect(result.success).toBe(true);
  });

  it('validates prompt evaluation payload', () => {
    const metrics = {
      summary_quality: 0.9,
      citation_coverage: 1,
      quiz_validity: 1,
      graph_coherence: 0.88
    };
    const result = promptEvaluationSchema.safeParse({
      generated_at: '2026-01-01T00:00:00.000Z',
      prompt_registry_version: '1.1.0',
      dataset: {
        version: '2026-05-22',
        checksum_sha256: 'sha256',
        topics: 6
      },
      model: 'local-rule-based',
      golden_set: {
        pass: true,
        topics: 6,
        failed_topics: 0,
        quality_threshold_version: '2026-05-20',
        topic_results: [
          {
            topic_id: 'alan_turing',
            title: 'Alan Turing',
            domain: 'biography',
            pass: true,
            checks: [{ id: 'summaries_count', pass: true, actual: 3, target: '=3' }],
            metrics,
            quality_failures: []
          }
        ]
      },
      prompt_regression: {
        pass: true,
        prompt_id: 'summary-by-level',
        baseline: {
          prompt_version: 'summary-by-level@1.0.0',
          version: '1.0.0',
          status: 'active',
          changelog: 'Initial prompt.'
        },
        candidate: {
          prompt_version: 'summary-by-level@1.1.0',
          version: '1.1.0',
          status: 'draft',
          changelog: 'Candidate prompt.'
        },
        threshold_version: '1.0.0',
        thresholds: {
          max_drop_by_metric: {
            summary_quality: 0.03,
            citation_coverage: 0.01,
            quiz_validity: 0.01,
            graph_coherence: 0.02
          },
          max_average_drop: 0.01
        },
        topics: 6,
        failed_topics: 0,
        average_drop: 0,
        topic_results: [
          {
            topic_id: 'alan_turing',
            title: 'Alan Turing',
            domain: 'biography',
            pass: true,
            failures: [],
            average_drop: 0,
            max_metric_drop: 0,
            baseline: metrics,
            candidate: metrics,
            drops: {
              summary_quality: 0,
              citation_coverage: 0,
              quiz_validity: 0,
              graph_coherence: 0
            }
          }
        ]
      },
      user_feedback: {
        dataset: 'user_feedback',
        trusted_artifact: false,
        contaminates_golden_set: false,
        requires_human_review: true,
        total_feedback: 1,
        negative_feedback: 1,
        average_rating: 2,
        latest_feedback_at: '2026-01-01T00:00:00.000Z',
        by_artifact: [
          {
            artifact_type: 'quiz',
            total_feedback: 1,
            negative_feedback: 1,
            average_rating: 2,
            latest_feedback_at: '2026-01-01T00:00:00.000Z',
            signals: [{ signal: 'incorrect', count: 1 }]
          }
        ]
      }
    });

    expect(result.success).toBe(true);
  });

  it('validates cost drilldown analytics payload', () => {
    const result = costDrilldownAnalyticsSchema.safeParse({
      generated_at: new Date().toISOString(),
      window_hours: 168,
      limit: 25,
      filters: {
        pack_id: 'pack-1',
        prompt_version: 'summary-by-level@1.0.0',
        model: 'local-rule-based',
        stage: 'summarization'
      },
      totals: {
        events: 2,
        estimated_tokens: 2400,
        total_estimated_usd: 0.04,
        avg_estimated_usd: 0.02,
        avg_latency_ms: 3000,
        distinct_packs: 1
      },
      rows: [
        {
          pack_id: 'pack-1',
          prompt_version: 'summary-by-level@1.0.0',
          model: 'local-rule-based',
          stage: 'summarization',
          events: 2,
          estimated_tokens: 2400,
          avg_tokens: 1200,
          avg_latency_ms: 3000,
          total_estimated_usd: 0.04,
          avg_estimated_usd: 0.02,
          first_recorded_at: new Date().toISOString(),
          last_recorded_at: new Date().toISOString()
        }
      ]
    });
    expect(result.success).toBe(true);
  });

  it('validates slo analytics payload', () => {
    const result = sloAnalyticsSchema.safeParse({
      generated_at: new Date().toISOString(),
      window_hours: 24,
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
      },
      statuses: [
        {
          id: 'job_success_rate',
          name: 'Job success rate',
          current_value: 0.99,
          target: 0.99,
          comparator: '>=',
          passed: true,
          error_budget_burn: 0
        }
      ]
    });
    expect(result.success).toBe(true);
  });
});
