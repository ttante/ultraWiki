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

export const quizAttemptRequestSchema = z.object({
  pack_id: z.string(),
  selected_indices: z.array(z.number().int().min(0).max(3)).min(1)
});

export const quizAttemptResponseSchema = z.object({
  attempt_id: z.string(),
  pack_id: z.string(),
  total_questions: z.number().int().min(1),
  correct_answers: z.number().int().min(0),
  accuracy: z.number().min(0).max(1),
  submitted_at: z.string()
});

export const outcomesAnalyticsSchema = z.object({
  generated_at: z.string(),
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
    avg_accuracy: z.number().min(0).max(1)
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
    )
  })
});

export const sloAnalyticsSchema = z.object({
  generated_at: z.string(),
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
  })
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
  latest_job: z.object({
    id: z.string(),
    status: z.enum(['queued', 'running', 'completed', 'failed', 'quarantined']),
    stage: z.enum(['ingestion', 'summarization', 'knowledge_structure', 'glossary', 'active_recall', 'done']),
    progress: z.number(),
    updated_at: z.string(),
    degradation_state: z.enum(['none', 'partial']),
    degradation_reason: z.string().optional()
  }).nullable(),
  readiness: packReadinessSchema
});

export const studyPackHistorySchema = z.object({
  items: z.array(studyPackHistoryItemSchema)
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

export type CreateStudyPackRequest = z.infer<typeof createStudyPackRequestSchema>;
export type CostAnalytics = z.infer<typeof costAnalyticsSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type SloAnalytics = z.infer<typeof sloAnalyticsSchema>;
export type StudyPack = z.infer<typeof studyPackSchema>;
export type StudyPackHistory = z.infer<typeof studyPackHistorySchema>;
