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
        stage: z.enum(['ingestion', 'summarization', 'active_recall', 'knowledge_structure']),
        events: z.number().int().min(0),
        avg_tokens: z.number().min(0),
        avg_latency_ms: z.number().min(0),
        total_estimated_usd: z.number().min(0),
        avg_estimated_usd: z.number().min(0)
      })
    )
  })
});

export const jobStatusSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'quarantined']),
  stage: z.enum(['ingestion', 'summarization', 'active_recall', 'knowledge_structure', 'done']),
  progress: z.number(),
  attempt: z.number(),
  retry_state: z.enum(['none', 'retrying', 'dead_letter']),
  degradation_state: z.enum(['none', 'partial']).default('none'),
  errors: z.array(z.string()).optional()
});

export const sourceSectionSchema = z.object({
  heading: z.string(),
  content: z.string()
});

export const summaryArtifactSchema = z.object({
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  text: z.string(),
  citations: z.array(z.string()),
  prompt_version: z.string(),
  model: z.string()
});

export const flashcardSchema = z.object({
  question: z.string(),
  answer: z.string(),
  citation: z.string(),
  prompt_version: z.string(),
  model: z.string()
});

export const quizQuestionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).min(4).max(4),
  correct_index: z.number().int().min(0).max(3),
  explanation: z.string(),
  citation: z.string(),
  prompt_version: z.string(),
  model: z.string()
});

export const graphNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['person', 'organization', 'event', 'concept', 'place', 'work']),
  citation: z.string()
});

export const graphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  relation: z.enum(['influenced', 'founded', 'member_of', 'occurred_in', 'related_to', 'precedes']),
  citation: z.string()
});

export const timelineEventSchema = z.object({
  year: z.number().int(),
  date_label: z.string(),
  description: z.string(),
  citation: z.string()
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
  flashcards: z.array(flashcardSchema),
  quiz_questions: z.array(quizQuestionSchema),
  graph: z.object({
    nodes: z.array(graphNodeSchema),
    edges: z.array(graphEdgeSchema)
  }),
  timeline: z.array(timelineEventSchema)
});

export type CreateStudyPackRequest = z.infer<typeof createStudyPackRequestSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type StudyPack = z.infer<typeof studyPackSchema>;
