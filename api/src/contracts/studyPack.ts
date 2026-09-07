import { z } from 'zod';

export const artifactSchemaVersion = '1.0.0';

export const createStudyPackRequestSchema = z.object({
  title_or_url: z.string().min(1),
  level_target: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  idempotency_key: z.string().min(8)
});

export const createStudyPackResponseSchema = z.object({
  pack_id: z.string(),
  job_id: z.string(),
  accepted_at: z.string()
});

export const queueStatusSchema = z.object({
  queued: z.number().int().min(0),
  running: z.number().int().min(0),
  max_queue_depth: z.number().int().min(0),
  global_concurrency_limit: z.number().int().min(0),
  session_inflight: z.number().int().min(0),
  session_concurrency_limit: z.number().int().min(0),
  capacity_state: z.enum(['open', 'queue_full', 'global_limit', 'session_limit'])
});

export const createBatchStudyPackRequestSchema = z.object({
  idempotency_key: z.string().min(8),
  topics: z.array(z.string().trim().min(1).max(240)).min(1).max(12)
});

export const batchStudyPackItemSchema = z.object({
  index: z.number().int().min(0),
  title_or_url: z.string(),
  status: z.enum(['accepted', 'reused', 'rejected', 'deferred']),
  pack_id: z.string().optional(),
  job_id: z.string().optional(),
  reason: z.string().optional()
});

export const createBatchStudyPackResponseSchema = z.object({
  batch_idempotency_key: z.string(),
  accepted_at: z.string(),
  summary: z.object({
    requested: z.number().int().min(0),
    accepted: z.number().int().min(0),
    reused: z.number().int().min(0),
    rejected: z.number().int().min(0),
    deferred: z.number().int().min(0)
  }),
  capacity_before: queueStatusSchema,
  capacity_after: queueStatusSchema,
  items: z.array(batchStudyPackItemSchema)
});

export const quizAttemptRequestSchema = z.object({
  pack_id: z.string(),
  selected_indices: z.array(z.number().int().min(0).max(3)).min(1)
});

export const quizAttemptResponseSchema = z.object({
  attempt_id: z.string(),
  user_id: z.string(),
  pack_id: z.string(),
  attempt_number: z.number().int().min(1),
  selected_indices: z.array(z.number().int().min(0).max(3)),
  total_questions: z.number().int().min(1),
  correct_answers: z.number().int().min(0),
  accuracy: z.number().min(0).max(1),
  previous_accuracy: z.number().min(0).max(1).optional(),
  accuracy_delta: z.number().min(-1).max(1),
  card_mastery_score: z.number().min(0).max(1),
  mastery_score: z.number().min(0).max(1),
  mastery_delta: z.number().min(-1).max(1),
  submitted_at: z.string()
});

export const quizAttemptListResponseSchema = z.object({
  items: z.array(quizAttemptResponseSchema)
});

export const userProfileSchema = z.object({
  user_id: z.string().min(1),
  display_name: z.string().min(1),
  created_at: z.string(),
  updated_at: z.string()
});

export const upsertUserProfileRequestSchema = z.object({
  display_name: z.string().trim().min(1).max(80).optional()
});

export const shareRoleSchema = z.enum(['viewer', 'editor']);

export const shareLinkSchema = z.object({
  share_id: z.string(),
  pack_id: z.string(),
  owner_user_id: z.string(),
  role: shareRoleSchema,
  created_at: z.string(),
  expires_at: z.string().optional(),
  revoked_at: z.string().optional()
});

export const createShareLinkRequestSchema = z.object({
  role: shareRoleSchema.optional().default('viewer')
});

export const createShareLinkResponseSchema = z.object({
  share: shareLinkSchema,
  share_path: z.string()
});

export const shareManagementItemSchema = z.object({
  share: shareLinkSchema,
  share_path: z.string()
});

export const listShareLinksResponseSchema = z.object({
  items: z.array(shareManagementItemSchema)
});

export const revokeShareLinkResponseSchema = z.object({
  share_id: z.string(),
  revoked: z.literal(true),
  revoked_at: z.string()
});

export const flashcardReviewRatingSchema = z.enum(['again', 'hard', 'good', 'easy']);

export const flashcardReviewRequestSchema = z.object({
  rating: flashcardReviewRatingSchema
});

export const flashcardReviewSchema = z.object({
  review_id: z.string(),
  user_id: z.string(),
  pack_id: z.string(),
  card_index: z.number().int().min(0),
  rating: flashcardReviewRatingSchema,
  reviewed_at: z.string(),
  next_due_at: z.string()
});

export const learningProgressSchema = z.object({
  user_id: z.string(),
  pack_id: z.string(),
  total_cards: z.number().int().min(0),
  reviewed_cards: z.number().int().min(0),
  due_cards: z.number().int().min(0),
  mastery_score: z.number().min(0).max(1),
  next_due_at: z.string().optional(),
  cards: z.array(
    z.object({
      card_index: z.number().int().min(0),
      reviewed: z.boolean(),
      due: z.boolean(),
      last_rating: flashcardReviewRatingSchema.optional(),
      reviewed_at: z.string().optional(),
      next_due_at: z.string().optional()
    })
  )
});

export const learningSessionSchema = z.object({
  session_id: z.string().optional(),
  user_id: z.string(),
  pack_id: z.string(),
  status: z.enum(['ready', 'complete']),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  reviewed_count: z.number().int().min(0).optional(),
  queue: z.array(
    z.object({
      position: z.number().int().min(1),
      card_index: z.number().int().min(0),
      question: z.string(),
      answer: z.string(),
      citation: z.string(),
      prompt_version: z.string(),
      model: z.string(),
      reviewed: z.boolean(),
      due: z.boolean(),
      last_rating: flashcardReviewRatingSchema.optional(),
      reviewed_at: z.string().optional(),
      next_due_at: z.string().optional()
    })
  ),
  metrics: z.object({
    total_cards: z.number().int().min(0),
    reviewed_cards: z.number().int().min(0),
    due_cards: z.number().int().min(0),
    session_total: z.number().int().min(0),
    completed_cards: z.number().int().min(0),
    remaining_cards: z.number().int().min(0),
    mastery_score: z.number().min(0).max(1),
    mastery_delta: z.number().min(-1).max(1)
  })
});

export const learningSessionStartRequestSchema = z.object({
  baseline_due_cards: z.number().int().min(0).optional(),
  baseline_mastery_score: z.number().min(0).max(1).optional()
});

export const studyGoalSchema = z.object({
  user_id: z.string(),
  daily_target_reviews: z.number().int().min(0).max(200),
  reviews_today: z.number().int().min(0).optional(),
  remaining_today: z.number().int().min(0).optional(),
  target_met: z.boolean().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional()
});

export const generationFeedbackArtifactTypeSchema = z.enum([
  'overall',
  'summaries',
  'flashcards',
  'quiz',
  'glossary',
  'concept_graph'
]);

export const generationFeedbackSignalSchema = z.enum([
  'helpful',
  'unclear',
  'incorrect',
  'missing_citation',
  'too_shallow',
  'unsafe',
  'other'
]);

export const generationFeedbackRequestSchema = z.object({
  artifact_type: generationFeedbackArtifactTypeSchema,
  artifact_id: z.string().trim().min(1).max(120).optional(),
  rating: z.number().int().min(1).max(5),
  signal: generationFeedbackSignalSchema,
  comment: z.string().trim().max(500).optional(),
  prompt_version: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(120).optional()
});

export const generationFeedbackSchema = z.object({
  feedback_id: z.string(),
  user_id: z.string(),
  pack_id: z.string(),
  artifact_type: generationFeedbackArtifactTypeSchema,
  artifact_id: z.string().optional(),
  rating: z.number().int().min(1).max(5),
  signal: generationFeedbackSignalSchema,
  comment: z.string().optional(),
  prompt_version: z.string().optional(),
  model: z.string().optional(),
  created_at: z.string(),
  governance: z.object({
    dataset: z.literal('user_feedback'),
    trusted_artifact: z.literal(false),
    eval_candidate: z.literal(true),
    contaminates_golden_set: z.literal(false),
    requires_human_review: z.literal(true)
  })
});

export const generationFeedbackSummarySchema = z.object({
  dataset: z.literal('user_feedback'),
  trusted_artifact: z.literal(false),
  contaminates_golden_set: z.literal(false),
  requires_human_review: z.literal(true),
  total_feedback: z.number().int().min(0),
  negative_feedback: z.number().int().min(0),
  average_rating: z.number().min(0).max(5),
  latest_feedback_at: z.string().nullable(),
  by_artifact: z.array(
    z.object({
      artifact_type: generationFeedbackArtifactTypeSchema,
      total_feedback: z.number().int().min(0),
      negative_feedback: z.number().int().min(0),
      average_rating: z.number().min(0).max(5),
      latest_feedback_at: z.string().nullable(),
      signals: z.array(
        z.object({
          signal: generationFeedbackSignalSchema,
          count: z.number().int().min(0)
        })
      )
    })
  )
});

export const userDataSavedPackSchema = z.object({
  pack_id: z.string(),
  saved_at: z.string(),
  organization: z.object({
    tags: z.array(z.string()),
    collection: z.string().optional()
  }).optional()
});

export const userDataShareSchema = shareLinkSchema.extend({
  share_id: z.string()
});

export const userDataLearningSessionSchema = z.object({
  session_id: z.string(),
  user_id: z.string(),
  pack_id: z.string(),
  status: z.enum(['active', 'completed']),
  started_at: z.string(),
  completed_at: z.string().optional(),
  baseline_due_cards: z.number().int().min(0),
  baseline_mastery_score: z.number().min(0).max(1),
  reviewed_count: z.number().int().min(0),
  outcome: z.object({
    completed_cards: z.number().int().min(0),
    remaining_cards: z.number().int().min(0),
    mastery_score: z.number().min(0).max(1),
    mastery_delta: z.number().min(-1).max(1)
  })
});

export const userDataExportSchema = z.object({
  user_id: z.string(),
  exported_at: z.string(),
  profile: userProfileSchema.optional(),
  library: z.array(userDataSavedPackSchema),
  shares: z.array(userDataShareSchema),
  flashcard_reviews: z.array(flashcardReviewSchema),
  learning_sessions: z.array(userDataLearningSessionSchema),
  quiz_attempts: z.array(quizAttemptResponseSchema),
  study_goal: studyGoalSchema.optional(),
  generation_feedback: z.array(generationFeedbackSchema)
});

export const userDataDeleteResponseSchema = z.object({
  user_id: z.string(),
  deleted_at: z.string(),
  deleted: z.object({
    profile: z.boolean(),
    library: z.number().int().min(0),
    shares: z.number().int().min(0),
    flashcard_reviews: z.number().int().min(0),
    learning_sessions: z.number().int().min(0),
    quiz_attempts: z.number().int().min(0),
    study_goals: z.number().int().min(0),
    generation_feedback: z.number().int().min(0)
  })
});

export const upsertStudyGoalRequestSchema = z.object({
  daily_target_reviews: z.number().int().min(0).max(200)
});

export const savedPackOrganizationSchema = z.object({
  tags: z.array(z.string().min(1).max(32)).max(12),
  collection: z.string().max(60).optional()
});

export const updateSavedPackOrganizationRequestSchema = z.object({
  tags: z.array(z.string().max(80)).max(24).default([]),
  collection: z.string().max(120).nullable().optional()
});

export const updateSavedPackOrganizationResponseSchema = z.object({
  pack_id: z.string(),
  organization: savedPackOrganizationSchema
});

export const learningAnalyticsSchema = z.object({
  user_id: z.string(),
  generated_at: z.string(),
  total_cards: z.number().int().min(0),
  reviewed_cards: z.number().int().min(0),
  due_cards: z.number().int().min(0),
  due_packs: z.number().int().min(0),
  streak: z.object({
    current_days: z.number().int().min(0),
    longest_days: z.number().int().min(0),
    last_activity_at: z.string().optional()
  }),
  goal: studyGoalSchema.omit({ user_id: true }),
  retention: z.object({
    reviewed_cards: z.number().int().min(0),
    retained_cards: z.number().int().min(0),
    due_reviewed_cards: z.number().int().min(0),
    retention_rate: z.number().min(0).max(1)
  }),
  mastery: z.object({
    average_score: z.number().min(0).max(1),
    average_delta: z.number().min(-1).max(1),
    trend: z.array(
      z.object({
        source: z.enum(['session', 'quiz']),
        pack_id: z.string(),
        recorded_at: z.string(),
        mastery_score: z.number().min(0).max(1),
        mastery_delta: z.number().min(-1).max(1)
      })
    )
  }),
  accuracy: z.object({
    attempts: z.number().int().min(0),
    retakes: z.number().int().min(0),
    average_accuracy: z.number().min(0).max(1),
    latest_accuracy: z.number().min(0).max(1).optional(),
    accuracy_delta: z.number().min(-1).max(1),
    trend: z.array(
      z.object({
        pack_id: z.string(),
        attempt_number: z.number().int().min(1),
        submitted_at: z.string(),
        accuracy: z.number().min(0).max(1),
        accuracy_delta: z.number().min(-1).max(1),
        mastery_score: z.number().min(0).max(1)
      })
    )
  }),
  packs: z.array(
    z.object({
      pack_id: z.string(),
      total_cards: z.number().int().min(0),
      reviewed_cards: z.number().int().min(0),
      due_cards: z.number().int().min(0),
      retained_cards: z.number().int().min(0),
      retention_rate: z.number().min(0).max(1),
      mastery_score: z.number().min(0).max(1),
      next_due_at: z.string().optional(),
      last_reviewed_at: z.string().optional(),
      quiz_attempts: z.number().int().min(0),
      latest_accuracy: z.number().min(0).max(1).optional(),
      accuracy_delta: z.number().min(-1).max(1).optional()
    })
  )
});

export const learningReminderSchema = z.object({
  user_id: z.string(),
  generated_at: z.string(),
  due_cards: z.number().int().min(0),
  due_packs: z.number().int().min(0),
  next_due_at: z.string().optional(),
  poll_after_seconds: z.number().int().min(60),
  delivery: z.literal('local_poll'),
  external_notifications: z.literal(false),
  packs: z.array(
    z.object({
      pack_id: z.string(),
      due_cards: z.number().int().min(0),
      next_due_at: z.string().optional(),
      last_reviewed_at: z.string().optional()
    })
  )
});

export const localLlmRuntimeHealthSchema = z.object({
  generated_at: z.string(),
  provider: z.enum(['rule_based', 'openai_compatible']),
  model: z.string(),
  base_url: z.string(),
  runtime_preset: z.string(),
  quantization: z.string(),
  context_window: z.number().int().min(1),
  chunk_size: z.number().int().min(1),
  concurrency: z.number().int().min(1),
  timeout_ms: z.number().int().min(1),
  status: z.enum(['ready', 'idle', 'degraded', 'fallback']),
  fallback_mode: z.boolean(),
  timeout_status: z.enum(['clear', 'timeouts_recorded']),
  calls: z.object({
    attempted: z.number().int().min(0),
    succeeded: z.number().int().min(0),
    fallback: z.number().int().min(0),
    timeouts: z.number().int().min(0),
    timeout_rate: z.number().min(0).max(1)
  }),
  latency: z.object({
    avg_ms: z.number().min(0),
    p95_ms: z.number().min(0)
  }),
  stages: z.array(
    z.object({
      provider: z.string(),
      model: z.string(),
      stage: z.string(),
      attempted: z.number().int().min(0),
      succeeded: z.number().int().min(0),
      fallback: z.number().int().min(0),
      avg_latency_ms: z.number().min(0),
      p95_latency_ms: z.number().min(0)
    })
  )
});

export const realModelSmokeTriggerRequestSchema = z.object({
  confirm: z.literal('run-real-model-smoke')
});

export const realModelSmokeStatusSchema = z.object({
  generated_at: z.string(),
  enabled: z.boolean(),
  local_only: z.literal(true),
  status: z.enum(['disabled', 'idle', 'running', 'passed', 'failed']),
  run_id: z.string().optional(),
  command: z.string(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  exit_code: z.number().int().optional(),
  output_tail: z.string().optional(),
  error: z.string().optional(),
  disabled_reason: z.string().optional(),
  next_action: z.string()
});

export const runtimePresetVisibilitySchema = z.object({
  generated_at: z.string(),
  provider: z.enum(['rule_based', 'openai_compatible']),
  model: z.string(),
  default_preset_id: z.string(),
  current_preset_id: z.string(),
  fallback_mode: z.enum(['rule_based_only', 'openai_with_rule_based_fallback']),
  current_config: z.object({
    quantization: z.string(),
    context_window: z.number().int().min(1),
    chunk_size: z.number().int().min(1),
    concurrency: z.number().int().min(1),
    timeout_ms: z.number().int().min(1)
  }),
  presets: z.array(
    z.object({
      id: z.string(),
      model: z.literal('qwen2.5-14b'),
      hardware: z.literal('rtx4080_12gb'),
      quantization: z.enum(['q4_k_m', 'q5_k_m', 'q8_0']),
      context_window: z.number().int().min(1),
      chunk_size: z.number().int().min(1),
      concurrency: z.number().int().min(1),
      validated: z.boolean(),
      selected: z.boolean(),
      default: z.boolean()
    })
  )
});

export const flashcardReviewResponseSchema = z.object({
  review: flashcardReviewSchema,
  progress: learningProgressSchema
});

export const outcomesAnalyticsSchema = z.object({
  generated_at: z.string(),
  window_hours: z.number().int().min(1),
  jobs: z.object({
    completed: z.number().int().min(0),
    failed: z.number().int().min(0),
    avg_duration_ms: z.number().min(0),
    completion_rate: z.number().min(0).max(1)
  }),
  quality: z.object({
    avg_citation_rate: z.number().min(0).max(1),
    avg_flashcards: z.number().min(0),
    avg_quiz_questions: z.number().min(0)
  }),
  learning: z.object({
    attempts: z.number().int().min(0),
    retakes: z.number().int().min(0),
    avg_accuracy: z.number().min(0).max(1),
    avg_mastery_score: z.number().min(0).max(1),
    avg_mastery_delta: z.number().min(-1).max(1)
  }),
  slo: z.object({
    p95_time_to_first_artifact_ms: z.number().min(0),
    p95_full_pack_completion_ms: z.number().min(0),
    job_success_rate: z.number().min(0).max(1),
    citation_coverage_rate: z.number().min(0).max(1)
  }),
  cost: z.object({
    total_estimated_usd: z.number().min(0),
    avg_estimated_usd_per_pack: z.number().min(0),
    by_stage: z.array(
      z.object({
        stage: z.enum(['ingestion', 'summarization', 'knowledge_structure', 'glossary', 'active_recall']),
        events: z.number().int().min(0),
        avg_tokens: z.number().min(0),
        avg_latency_ms: z.number().min(0),
        total_estimated_usd: z.number().min(0),
        avg_estimated_usd: z.number().min(0)
      })
    )
  }),
  security: z.object({
    suspicious_inputs_total: z.number().int().min(0),
    signature_alerts_total: z.number().int().min(0),
    security_events_total: z.number().int().min(0),
    rate_limit_events_total: z.number().int().min(0),
    event_categories: z.array(
      z.object({
        category: z.enum(['auth', 'share', 'security', 'rate_limit', 'other']),
        count: z.number().int().min(0)
      })
    ),
    rate_limit_events: z.array(
      z.object({
        event_type: z.string(),
        count: z.number().int().min(0)
      })
    ),
    events: z.array(
      z.object({
        event_type: z.string(),
        count: z.number().int().min(0)
      })
    )
  })
});

const costStageAggregateSchema = z.object({
  stage: z.enum(['ingestion', 'summarization', 'knowledge_structure', 'glossary', 'active_recall']),
  events: z.number().int().min(0),
  avg_tokens: z.number().min(0),
  avg_latency_ms: z.number().min(0),
  total_estimated_usd: z.number().min(0),
  avg_estimated_usd: z.number().min(0)
});

export const costAnalyticsSchema = z.object({
  generated_at: z.string(),
  window_hours: z.number().int().min(1),
  total_estimated_usd: z.number().min(0),
  avg_estimated_usd_per_pack: z.number().min(0),
  by_stage: z.array(costStageAggregateSchema),
  by_pack: z.array(
    z.object({
      pack_id: z.string(),
      events: z.number().int().min(0),
      estimated_tokens: z.number().int().min(0),
      total_estimated_usd: z.number().min(0),
      avg_estimated_usd: z.number().min(0)
    })
  ),
  by_prompt_model: z.array(
    z.object({
      prompt_version: z.string(),
      model: z.string(),
      events: z.number().int().min(0),
      avg_latency_ms: z.number().min(0),
      estimated_tokens: z.number().int().min(0),
      total_estimated_usd: z.number().min(0)
    })
  ),
  llm_ops: z.object({
    calls: z.object({
      attempted: z.number().int().min(0),
      succeeded: z.number().int().min(0),
      fallback: z.number().int().min(0),
      invalid_responses: z.number().int().min(0),
      timeouts: z.number().int().min(0),
      timeout_rate: z.number().min(0).max(1)
    }),
    by_stage_model: z.array(
      z.object({
        provider: z.string(),
        model: z.string(),
        stage: z.string(),
        attempted: z.number().int().min(0),
        succeeded: z.number().int().min(0),
        fallback: z.number().int().min(0),
        avg_latency_ms: z.number().min(0),
        p95_latency_ms: z.number().min(0)
      })
    ),
    fallbacks_by_reason: z.array(
      z.object({
        provider: z.string(),
        model: z.string(),
        stage: z.string(),
        reason: z.enum(['missing_client', 'invalid_response', 'client_error']),
        events: z.number().int().min(0)
      })
    ),
    errors_by_type: z.array(
      z.object({
        provider: z.string(),
        model: z.string(),
        stage: z.string(),
        error_type: z.string(),
        events: z.number().int().min(0)
      })
    )
  })
});

export const costDrilldownAnalyticsSchema = z.object({
  generated_at: z.string(),
  window_hours: z.number().int().min(1),
  limit: z.number().int().min(1),
  filters: z.object({
    pack_id: z.string().nullable(),
    prompt_version: z.string().nullable(),
    model: z.string().nullable(),
    stage: z.enum(['ingestion', 'summarization', 'knowledge_structure', 'glossary', 'active_recall']).nullable()
  }),
  totals: z.object({
    events: z.number().int().min(0),
    estimated_tokens: z.number().int().min(0),
    total_estimated_usd: z.number().min(0),
    avg_estimated_usd: z.number().min(0),
    avg_latency_ms: z.number().min(0),
    distinct_packs: z.number().int().min(0)
  }),
  rows: z.array(
    z.object({
      pack_id: z.string(),
      prompt_version: z.string(),
      model: z.string(),
      stage: z.enum(['ingestion', 'summarization', 'knowledge_structure', 'glossary', 'active_recall']),
      events: z.number().int().min(0),
      estimated_tokens: z.number().int().min(0),
      avg_tokens: z.number().min(0),
      avg_latency_ms: z.number().min(0),
      total_estimated_usd: z.number().min(0),
      avg_estimated_usd: z.number().min(0),
      first_recorded_at: z.string().nullable(),
      last_recorded_at: z.string().nullable()
    })
  )
});

export const sloAnalyticsSchema = z.object({
  generated_at: z.string(),
  window_hours: z.number().int().min(1),
  targets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      metric: z.string(),
      promql: z.string(),
      target: z.number(),
      comparator: z.enum(['<=', '>=']),
      window: z.string(),
      owner: z.string()
    })
  ),
  current: z.object({
    p95_time_to_first_artifact_ms: z.number().min(0),
    p95_full_pack_completion_ms: z.number().min(0),
    job_success_rate: z.number().min(0).max(1),
    citation_coverage_rate: z.number().min(0).max(1)
  }),
  statuses: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      current_value: z.number().min(0),
      target: z.number(),
      comparator: z.enum(['<=', '>=']),
      passed: z.boolean(),
      error_budget_burn: z.number().min(0)
    })
  )
});

const promptEvaluationMetricsSchema = z.object({
  summary_quality: z.number().min(0).max(1),
  citation_coverage: z.number().min(0).max(1),
  quiz_validity: z.number().min(0).max(1),
  graph_coherence: z.number().min(0).max(1)
});

export const promptEvaluationSchema = z.object({
  generated_at: z.string(),
  prompt_registry_version: z.string(),
  dataset: z.object({
    version: z.string(),
    checksum_sha256: z.string(),
    topics: z.number().int().min(0)
  }),
  model: z.string(),
  golden_set: z.object({
    pass: z.boolean(),
    topics: z.number().int().min(0),
    failed_topics: z.number().int().min(0),
    quality_threshold_version: z.string(),
    topic_results: z.array(
      z.object({
        topic_id: z.string(),
        title: z.string(),
        domain: z.string(),
        pass: z.boolean(),
        checks: z.array(
          z.object({
            id: z.string(),
            pass: z.boolean(),
            actual: z.number().min(0),
            target: z.string()
          })
        ),
        metrics: promptEvaluationMetricsSchema,
        quality_failures: z.array(z.string())
      })
    )
  }),
  prompt_regression: z.object({
    pass: z.boolean(),
    prompt_id: z.string(),
    baseline: z.object({
      prompt_version: z.string(),
      version: z.string(),
      status: z.enum(['active', 'deprecated', 'draft']),
      changelog: z.string()
    }),
    candidate: z.object({
      prompt_version: z.string(),
      version: z.string(),
      status: z.enum(['active', 'deprecated', 'draft']),
      changelog: z.string()
    }),
    threshold_version: z.string(),
    thresholds: z.object({
      max_drop_by_metric: promptEvaluationMetricsSchema,
      max_average_drop: z.number().min(0).max(1)
    }),
    topics: z.number().int().min(0),
    failed_topics: z.number().int().min(0),
    average_drop: z.number().min(0),
    topic_results: z.array(
      z.object({
        topic_id: z.string(),
        title: z.string(),
        domain: z.string(),
        pass: z.boolean(),
        failures: z.array(z.string()),
        average_drop: z.number().min(0),
        max_metric_drop: z.number().min(0),
        baseline: promptEvaluationMetricsSchema,
        candidate: promptEvaluationMetricsSchema,
        drops: promptEvaluationMetricsSchema
      })
    )
  }),
  user_feedback: generationFeedbackSummarySchema
});

export const jobStatusSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'quarantined']),
  stage: z.enum(['ingestion', 'summarization', 'knowledge_structure', 'glossary', 'active_recall', 'done']),
  progress: z.number(),
  attempt: z.number(),
  retry_state: z.enum(['none', 'retrying', 'dead_letter']),
  degradation_state: z.enum(['none', 'partial']).default('none'),
  degradation_reason: z.string().optional(),
  errors: z.array(z.string()).optional()
});

export const sourceSectionSchema = z.object({
  heading: z.string(),
  content: z.string()
});

export const sourceProvenanceSchema = z.object({
  source_revision_id: z.string(),
  citation: z.string(),
  revision_url: z.string().url(),
  license: z.literal('CC BY-SA 4.0')
});

export const summaryArtifactSchema = z.object({
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  text: z.string(),
  citations: z.array(z.string()),
  prompt_version: z.string(),
  model: z.string(),
  source_provenance: z.array(sourceProvenanceSchema)
});

export const flashcardSchema = z.object({
  question: z.string(),
  answer: z.string(),
  citation: z.string(),
  prompt_version: z.string(),
  model: z.string(),
  source_provenance: sourceProvenanceSchema
});

export const quizQuestionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).min(4).max(4),
  correct_index: z.number().int().min(0).max(3),
  misconceptions: z.array(z.string()),
  explanation: z.string(),
  citation: z.string(),
  prompt_version: z.string(),
  model: z.string(),
  source_provenance: sourceProvenanceSchema
});

export const glossaryTermSchema = z.object({
  term: z.string(),
  definition: z.string(),
  citation: z.string(),
  prompt_version: z.string(),
  model: z.string(),
  source_provenance: sourceProvenanceSchema
});

export const graphNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['person', 'organization', 'event', 'concept', 'place', 'work']),
  citation: z.string(),
  source_provenance: sourceProvenanceSchema
});

export const graphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  relation: z.enum(['influenced', 'founded', 'member_of', 'occurred_in', 'related_to', 'precedes']),
  citation: z.string(),
  source_provenance: sourceProvenanceSchema
});

export const timelineEventSchema = z.object({
  year: z.number().int(),
  date_label: z.string(),
  description: z.string(),
  citation: z.string(),
  source_provenance: sourceProvenanceSchema
});

export const learnNextRecommendationSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  rationale: z.string(),
  score: z.number().min(0).max(1),
  source_heading: z.string()
});

export const cacheEventSchema = z.object({
  stage: z.enum(['source', 'summaries', 'knowledge_structure', 'glossary', 'active_recall']),
  cache_key: z.string(),
  hit: z.boolean(),
  source_revision_id: z.string(),
  parser_version: z.string().optional(),
  prompt_version: z.string().optional(),
  taxonomy_version: z.string().optional(),
  cached_at: z.string().optional(),
  expires_at: z.string().optional(),
  recorded_at: z.string().optional()
});

export const packReadinessSchema = z.object({
  status: z.enum(['full', 'partial']),
  missing_artifacts: z.array(z.enum(['summaries', 'graph', 'glossary', 'flashcards', 'quiz'])),
  can_resume: z.boolean(),
  degradation_reason: z.string().optional()
});

export const studyPackHistoryItemSchema = z.object({
  id: z.string(),
  input: z.string(),
  source_revision_id: z.string(),
  created_at: z.string(),
  saved_at: z.string().optional(),
  latest_job: z.object({
    id: z.string(),
    status: z.enum(['queued', 'running', 'completed', 'failed', 'quarantined']),
    stage: z.enum(['ingestion', 'summarization', 'knowledge_structure', 'glossary', 'active_recall', 'done']),
    progress: z.number(),
    updated_at: z.string(),
    degradation_state: z.enum(['none', 'partial']),
    degradation_reason: z.string().optional()
  }).nullable(),
  readiness: packReadinessSchema,
  progress: z.object({
    total_cards: z.number().int().min(0),
    reviewed_cards: z.number().int().min(0),
    due_cards: z.number().int().min(0),
    mastery_score: z.number().min(0).max(1),
    next_due_at: z.string().optional()
  }).optional(),
  organization: savedPackOrganizationSchema.optional()
});

export const studyPackHistorySchema = z.object({
  items: z.array(studyPackHistoryItemSchema),
  facets: z.object({
    total: z.number().int().min(0),
    readiness: z.object({
      full: z.number().int().min(0),
      partial: z.number().int().min(0)
    }),
    progress: z.object({
      due: z.number().int().min(0),
      reviewed: z.number().int().min(0),
      not_started: z.number().int().min(0)
    }),
    tags: z.array(z.object({ tag: z.string(), count: z.number().int().min(0) })).default([]),
    collections: z.array(z.object({ collection: z.string(), count: z.number().int().min(0) })).default([])
  }).optional()
});

export const savedPackVersionArtifactCountsSchema = z.object({
  summaries: z.number().int().min(0),
  glossary: z.number().int().min(0),
  flashcards: z.number().int().min(0),
  quiz_questions: z.number().int().min(0),
  graph_nodes: z.number().int().min(0),
  graph_edges: z.number().int().min(0),
  timeline_events: z.number().int().min(0)
});

export const savedPackVersionItemSchema = studyPackHistoryItemSchema.extend({
  current: z.boolean(),
  source_revision_changed: z.boolean(),
  artifact_counts: savedPackVersionArtifactCountsSchema
});

export const savedPackVersionHistorySchema = z.object({
  current: savedPackVersionItemSchema,
  versions: z.array(savedPackVersionItemSchema),
  compare: z.object({
    baseline_pack_id: z.string().optional(),
    baseline_source_revision_id: z.string().optional(),
    source_revision_changed: z.boolean(),
    readiness_changed: z.boolean(),
    artifact_deltas: savedPackVersionArtifactCountsSchema,
    missing_artifacts_added: z.array(z.enum(['summaries', 'graph', 'glossary', 'flashcards', 'quiz'])),
    missing_artifacts_removed: z.array(z.enum(['summaries', 'graph', 'glossary', 'flashcards', 'quiz']))
  })
});

export const studyPackSchema = z.object({
  id: z.string(),
  input: z.string(),
  source_revision_id: z.string(),
  source_attribution: z.object({
    canonical_url: z.string().url(),
    revision_url: z.string().url(),
    license: z.literal('CC BY-SA 4.0')
  }),
  schema_version: z.literal(artifactSchemaVersion),
  grounding_stats: z.object({
    citation_rate: z.number(),
    unsupported_claims: z.number()
  }),
  sections: z.array(sourceSectionSchema),
  summaries: z.array(summaryArtifactSchema),
  glossary: z.array(glossaryTermSchema),
  flashcards: z.array(flashcardSchema),
  quiz_questions: z.array(quizQuestionSchema),
  graph: z.object({
    nodes: z.array(graphNodeSchema),
    edges: z.array(graphEdgeSchema)
  }),
  timeline: z.array(timelineEventSchema),
  recommendations: z.array(learnNextRecommendationSchema),
  cache: z.object({
    source: cacheEventSchema.nullable(),
    artifacts: z.array(cacheEventSchema)
  }),
  readiness: packReadinessSchema
});

export const sharedStudyPackResponseSchema = z.object({
  share: shareLinkSchema,
  pack: studyPackSchema
});

export type CreateBatchStudyPackRequest = z.infer<typeof createBatchStudyPackRequestSchema>;
export type CreateBatchStudyPackResponse = z.infer<typeof createBatchStudyPackResponseSchema>;
export type CreateStudyPackRequest = z.infer<typeof createStudyPackRequestSchema>;
export type CostAnalytics = z.infer<typeof costAnalyticsSchema>;
export type CostDrilldownAnalytics = z.infer<typeof costDrilldownAnalyticsSchema>;
export type CreateShareLinkRequest = z.infer<typeof createShareLinkRequestSchema>;
export type FlashcardReviewRating = z.infer<typeof flashcardReviewRatingSchema>;
export type LearningSession = z.infer<typeof learningSessionSchema>;
export type LearningReminder = z.infer<typeof learningReminderSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type LearningProgress = z.infer<typeof learningProgressSchema>;
export type GenerationFeedback = z.infer<typeof generationFeedbackSchema>;
export type GenerationFeedbackRequest = z.infer<typeof generationFeedbackRequestSchema>;
export type PromptEvaluation = z.infer<typeof promptEvaluationSchema>;
export type RealModelSmokeStatus = z.infer<typeof realModelSmokeStatusSchema>;
export type SloAnalytics = z.infer<typeof sloAnalyticsSchema>;
export type StudyPack = z.infer<typeof studyPackSchema>;
export type StudyPackHistory = z.infer<typeof studyPackHistorySchema>;
export type SavedPackVersionHistory = z.infer<typeof savedPackVersionHistorySchema>;
