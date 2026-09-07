'use client';

import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { opsRunbookLinks } from '../lib/runbook-links';

type Summary = {
  level: 'beginner' | 'intermediate' | 'advanced';
  text: string;
  citations: string[];
  prompt_version: string;
  model: string;
  source_provenance: SourceProvenance[];
};

type SourceProvenance = {
  source_revision_id: string;
  citation: string;
  revision_url: string;
  license: 'CC BY-SA 4.0';
};

type Flashcard = {
  question: string;
  answer: string;
  citation: string;
  prompt_version: string;
  model: string;
  source_provenance: SourceProvenance;
};

type QuizQuestion = {
  question: string;
  options: string[];
  correct_index: number;
  misconceptions: string[];
  explanation: string;
  citation: string;
  prompt_version: string;
  model: string;
  source_provenance: SourceProvenance;
};

type GlossaryTerm = {
  term: string;
  definition: string;
  citation: string;
  prompt_version: string;
  model: string;
  source_provenance: SourceProvenance;
};

type GraphNode = {
  id: string;
  label: string;
  type: 'person' | 'organization' | 'event' | 'concept' | 'place' | 'work';
  citation: string;
  source_provenance: SourceProvenance;
};

type GraphEdge = {
  source: string;
  target: string;
  relation: 'influenced' | 'founded' | 'member_of' | 'occurred_in' | 'related_to' | 'precedes';
  citation: string;
  source_provenance: SourceProvenance;
};

type TimelineEvent = {
  year: number;
  date_label: string;
  description: string;
  citation: string;
  source_provenance: SourceProvenance;
};

type Recommendation = {
  title: string;
  url: string;
  rationale: string;
  score: number;
  source_heading: string;
};

type CacheEvent = {
  stage: 'source' | 'summaries' | 'knowledge_structure' | 'glossary' | 'active_recall';
  cache_key: string;
  hit: boolean;
  source_revision_id: string;
  parser_version?: string;
  prompt_version?: string;
  taxonomy_version?: string;
  cached_at?: string;
  expires_at?: string;
  recorded_at?: string;
};

type StudyPack = {
  id: string;
  input: string;
  source_revision_id: string;
  source_attribution: {
    canonical_url: string;
    revision_url: string;
    license: 'CC BY-SA 4.0';
  };
  grounding_stats: {
    citation_rate: number;
    unsupported_claims: number;
  };
  summaries: Summary[];
  glossary: GlossaryTerm[];
  flashcards: Flashcard[];
  quiz_questions: QuizQuestion[];
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  timeline: TimelineEvent[];
  recommendations: Recommendation[];
  cache: {
    source: CacheEvent | null;
    artifacts: CacheEvent[];
  };
  readiness: {
    status: 'full' | 'partial';
    missing_artifacts: Array<'summaries' | 'graph' | 'glossary' | 'flashcards' | 'quiz'>;
    can_resume: boolean;
    degradation_reason?: string;
  };
};

type JobStatus = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'quarantined';
  stage: 'ingestion' | 'summarization' | 'knowledge_structure' | 'glossary' | 'active_recall' | 'done';
  progress: number;
  attempt?: number;
  retry_state?: 'none' | 'retrying' | 'dead_letter';
  degradation_state?: 'none' | 'partial';
  degradation_reason?: string;
  errors?: string[];
};

type StudyPackHistoryItem = {
  id: string;
  input: string;
  source_revision_id: string;
  created_at: string;
  saved_at?: string;
  latest_job: {
    id: string;
    status: JobStatus['status'];
    stage: JobStatus['stage'];
    progress: number;
    updated_at: string;
    degradation_state: 'none' | 'partial';
    degradation_reason?: string;
  } | null;
  readiness: StudyPack['readiness'];
  progress?: {
    total_cards: number;
    reviewed_cards: number;
    due_cards: number;
    mastery_score: number;
    next_due_at?: string;
  };
  organization?: {
    tags: string[];
    collection?: string;
  };
};

type LibraryReadinessFilter = 'all' | 'full' | 'partial';
type LibraryProgressFilter = 'all' | 'due' | 'reviewed' | 'not_started';
type LibrarySort = 'saved_desc' | 'saved_asc' | 'title_asc' | 'title_desc' | 'due_desc' | 'mastery_desc';

type LibraryFacets = {
  total: number;
  readiness: {
    full: number;
    partial: number;
  };
  progress: {
    due: number;
    reviewed: number;
    not_started: number;
  };
  tags: Array<{ tag: string; count: number }>;
  collections: Array<{ collection: string; count: number }>;
};

type VersionArtifactCounts = {
  summaries: number;
  glossary: number;
  flashcards: number;
  quiz_questions: number;
  graph_nodes: number;
  graph_edges: number;
  timeline_events: number;
};

type SavedPackVersionItem = StudyPackHistoryItem & {
  current: boolean;
  source_revision_changed: boolean;
  artifact_counts: VersionArtifactCounts;
};

type SavedPackVersionHistory = {
  current: SavedPackVersionItem;
  versions: SavedPackVersionItem[];
  compare: {
    baseline_pack_id?: string;
    baseline_source_revision_id?: string;
    source_revision_changed: boolean;
    readiness_changed: boolean;
    artifact_deltas: VersionArtifactCounts;
    missing_artifacts_added: Array<'summaries' | 'graph' | 'glossary' | 'flashcards' | 'quiz'>;
    missing_artifacts_removed: Array<'summaries' | 'graph' | 'glossary' | 'flashcards' | 'quiz'>;
  };
};

type UserProfile = {
  user_id: string;
  display_name: string;
  created_at: string;
  updated_at: string;
};

type AuthSessionState = {
  authenticated: boolean;
  source?: 'session' | 'legacy_header';
  user?: UserProfile;
};

type QueueStatus = {
  queued: number;
  running: number;
  max_queue_depth: number;
  global_concurrency_limit: number;
  session_inflight: number;
  session_concurrency_limit: number;
  capacity_state: 'open' | 'queue_full' | 'global_limit' | 'session_limit';
};

type BatchGenerationItem = {
  index: number;
  title_or_url: string;
  status: 'accepted' | 'reused' | 'rejected' | 'deferred';
  pack_id?: string;
  job_id?: string;
  reason?: string;
};

type BatchGenerationResult = {
  batch_idempotency_key: string;
  accepted_at: string;
  summary: {
    requested: number;
    accepted: number;
    reused: number;
    rejected: number;
    deferred: number;
  };
  capacity_before: QueueStatus;
  capacity_after: QueueStatus;
  items: BatchGenerationItem[];
};

type QuizAttemptResult = {
  attempt_id: string;
  user_id: string;
  pack_id: string;
  attempt_number: number;
  selected_indices: number[];
  total_questions: number;
  correct_answers: number;
  accuracy: number;
  previous_accuracy?: number;
  accuracy_delta: number;
  card_mastery_score: number;
  mastery_score: number;
  mastery_delta: number;
  submitted_at: string;
};

type ShareLink = {
  share: {
    share_id: string;
    pack_id: string;
    owner_user_id: string;
    role: 'viewer' | 'editor';
    created_at: string;
    expires_at?: string;
  };
  share_path: string;
};

type FlashcardReviewRating = 'again' | 'hard' | 'good' | 'easy';

type LearningProgress = {
  user_id: string;
  pack_id: string;
  total_cards: number;
  reviewed_cards: number;
  due_cards: number;
  mastery_score: number;
  next_due_at?: string;
  cards: Array<{
    card_index: number;
    reviewed: boolean;
    due: boolean;
    last_rating?: FlashcardReviewRating;
    reviewed_at?: string;
    next_due_at?: string;
  }>;
};

type LearningSession = {
  session_id?: string;
  user_id: string;
  pack_id: string;
  status: 'ready' | 'complete';
  started_at?: string;
  completed_at?: string;
  reviewed_count?: number;
  queue: Array<{
    position: number;
    card_index: number;
    question: string;
    answer: string;
    citation: string;
    prompt_version: string;
    model: string;
    reviewed: boolean;
    due: boolean;
    last_rating?: FlashcardReviewRating;
    reviewed_at?: string;
    next_due_at?: string;
  }>;
  metrics: {
    total_cards: number;
    reviewed_cards: number;
    due_cards: number;
    session_total: number;
    completed_cards: number;
    remaining_cards: number;
    mastery_score: number;
    mastery_delta: number;
  };
};

type LearningSessionBaseline = {
  dueCards: number;
  masteryScore: number;
};

type LearningAnalytics = {
  user_id: string;
  generated_at: string;
  total_cards: number;
  reviewed_cards: number;
  due_cards: number;
  due_packs: number;
  streak: {
    current_days: number;
    longest_days: number;
    last_activity_at?: string;
  };
  goal: {
    daily_target_reviews: number;
    reviews_today: number;
    remaining_today: number;
    target_met: boolean;
    created_at?: string;
    updated_at?: string;
  };
  retention: {
    reviewed_cards: number;
    retained_cards: number;
    due_reviewed_cards: number;
    retention_rate: number;
  };
  mastery: {
    average_score: number;
    average_delta: number;
    trend: Array<{
      source: 'session' | 'quiz';
      pack_id: string;
      recorded_at: string;
      mastery_score: number;
      mastery_delta: number;
    }>;
  };
  accuracy: {
    attempts: number;
    retakes: number;
    average_accuracy: number;
    latest_accuracy?: number;
    accuracy_delta: number;
    trend: Array<{
      pack_id: string;
      attempt_number: number;
      submitted_at: string;
      accuracy: number;
      accuracy_delta: number;
      mastery_score: number;
    }>;
  };
  packs: Array<{
    pack_id: string;
    total_cards: number;
    reviewed_cards: number;
    due_cards: number;
    retained_cards: number;
    retention_rate: number;
    mastery_score: number;
    next_due_at?: string;
    last_reviewed_at?: string;
    quiz_attempts: number;
    latest_accuracy?: number;
    accuracy_delta?: number;
  }>;
};

type LearningReminder = {
  user_id: string;
  generated_at: string;
  due_cards: number;
  due_packs: number;
  next_due_at?: string;
  poll_after_seconds: number;
  delivery: 'local_poll';
  external_notifications: false;
  packs: Array<{
    pack_id: string;
    due_cards: number;
    next_due_at?: string;
    last_reviewed_at?: string;
  }>;
};

type OutcomesAnalytics = {
  window_hours: number;
  jobs: {
    completed: number;
    failed: number;
    completion_rate: number;
  };
  quality: {
    avg_citation_rate: number;
  };
  learning: {
    attempts: number;
    retakes: number;
    avg_accuracy: number;
    avg_mastery_score: number;
    avg_mastery_delta: number;
  };
  security: {
    suspicious_inputs_total: number;
    signature_alerts_total: number;
    security_events_total: number;
    rate_limit_events_total: number;
    event_categories: Array<{
      category: 'auth' | 'share' | 'security' | 'rate_limit' | 'other';
      count: number;
    }>;
    rate_limit_events: Array<{
      event_type: string;
      count: number;
    }>;
    events: Array<{
      event_type: string;
      count: number;
    }>;
  };
};

type CostAnalytics = {
  window_hours: number;
  total_estimated_usd: number;
  avg_estimated_usd_per_pack: number;
  by_stage: Array<{
    stage: string;
    events: number;
    avg_tokens: number;
    avg_latency_ms: number;
    total_estimated_usd: number;
    avg_estimated_usd: number;
  }>;
  by_pack: Array<{
    pack_id: string;
    events: number;
    estimated_tokens: number;
    total_estimated_usd: number;
    avg_estimated_usd: number;
  }>;
  by_prompt_model: Array<{
    prompt_version: string;
    model: string;
    events: number;
    avg_latency_ms: number;
    estimated_tokens: number;
    total_estimated_usd: number;
  }>;
  llm_ops: {
    calls: {
      attempted: number;
      succeeded: number;
      fallback: number;
      invalid_responses: number;
      timeouts: number;
      timeout_rate: number;
    };
    by_stage_model: Array<{
      provider: string;
      model: string;
      stage: string;
      attempted: number;
      succeeded: number;
      fallback: number;
      avg_latency_ms: number;
      p95_latency_ms: number;
    }>;
    fallbacks_by_reason: Array<{
      provider: string;
      model: string;
      stage: string;
      reason: string;
      events: number;
    }>;
    errors_by_type: Array<{
      provider: string;
      model: string;
      stage: string;
      error_type: string;
      events: number;
    }>;
  };
};

type CostStage = 'ingestion' | 'summarization' | 'knowledge_structure' | 'glossary' | 'active_recall';

type CostDrilldownAnalytics = {
  window_hours: number;
  limit: number;
  filters: {
    pack_id: string | null;
    prompt_version: string | null;
    model: string | null;
    stage: CostStage | null;
  };
  totals: {
    events: number;
    estimated_tokens: number;
    total_estimated_usd: number;
    avg_estimated_usd: number;
    avg_latency_ms: number;
    distinct_packs: number;
  };
  rows: Array<{
    pack_id: string;
    prompt_version: string;
    model: string;
    stage: CostStage;
    events: number;
    estimated_tokens: number;
    avg_tokens: number;
    avg_latency_ms: number;
    total_estimated_usd: number;
    avg_estimated_usd: number;
    first_recorded_at: string | null;
    last_recorded_at: string | null;
  }>;
};

type SloAnalytics = {
  window_hours: number;
  targets: Array<{
    id: string;
    name: string;
    target: number;
    comparator: '<=' | '>=';
  }>;
  current: {
    p95_time_to_first_artifact_ms: number;
    p95_full_pack_completion_ms: number;
    job_success_rate: number;
    citation_coverage_rate: number;
  };
  statuses: Array<{
    id: string;
    name: string;
    current_value: number;
    target: number;
    comparator: '<=' | '>=';
    passed: boolean;
    error_budget_burn: number;
  }>;
};

type SloStatus = SloAnalytics['statuses'][number];

type LocalLlmRuntimeHealth = {
  generated_at: string;
  provider: 'rule_based' | 'openai_compatible';
  model: string;
  base_url: string;
  runtime_preset: string;
  quantization: string;
  context_window: number;
  chunk_size: number;
  concurrency: number;
  timeout_ms: number;
  status: 'ready' | 'idle' | 'degraded' | 'fallback';
  fallback_mode: boolean;
  timeout_status: 'clear' | 'timeouts_recorded';
  calls: {
    attempted: number;
    succeeded: number;
    fallback: number;
    timeouts: number;
    timeout_rate: number;
  };
  latency: {
    avg_ms: number;
    p95_ms: number;
  };
  stages: Array<{
    provider: string;
    model: string;
    stage: string;
    attempted: number;
    succeeded: number;
    fallback: number;
    avg_latency_ms: number;
    p95_latency_ms: number;
  }>;
};

type RuntimePresetVisibility = {
  provider: 'rule_based' | 'openai_compatible';
  model: string;
  default_preset_id: string;
  current_preset_id: string;
  fallback_mode: 'rule_based_only' | 'openai_with_rule_based_fallback';
  current_config: {
    quantization: string;
    context_window: number;
    chunk_size: number;
    concurrency: number;
    timeout_ms: number;
  };
  presets: Array<{
    id: string;
    model: 'qwen2.5-14b';
    hardware: 'rtx4080_12gb';
    quantization: 'q4_k_m' | 'q5_k_m' | 'q8_0';
    context_window: number;
    chunk_size: number;
    concurrency: number;
    validated: boolean;
    selected: boolean;
    default: boolean;
  }>;
};

type PromptEvaluationMetrics = {
  summary_quality: number;
  citation_coverage: number;
  quiz_validity: number;
  graph_coherence: number;
};

type PromptEvaluationSnapshot = {
  generated_at: string;
  prompt_registry_version: string;
  dataset: {
    version: string;
    checksum_sha256: string;
    topics: number;
  };
  model: string;
  golden_set: {
    pass: boolean;
    topics: number;
    failed_topics: number;
    quality_threshold_version: string;
    topic_results: Array<{
      topic_id: string;
      title: string;
      domain: string;
      pass: boolean;
      checks: Array<{ id: string; pass: boolean; actual: number; target: string }>;
      metrics: PromptEvaluationMetrics;
      quality_failures: string[];
    }>;
  };
  prompt_regression: {
    pass: boolean;
    prompt_id: string;
    baseline: {
      prompt_version: string;
      version: string;
      status: 'active' | 'deprecated' | 'draft';
      changelog: string;
    };
    candidate: {
      prompt_version: string;
      version: string;
      status: 'active' | 'deprecated' | 'draft';
      changelog: string;
    };
    threshold_version: string;
    thresholds: {
      max_drop_by_metric: PromptEvaluationMetrics;
      max_average_drop: number;
    };
    topics: number;
    failed_topics: number;
    average_drop: number;
    topic_results: Array<{
      topic_id: string;
      title: string;
      domain: string;
      pass: boolean;
      failures: string[];
      average_drop: number;
      max_metric_drop: number;
      baseline: PromptEvaluationMetrics;
      candidate: PromptEvaluationMetrics;
      drops: PromptEvaluationMetrics;
    }>;
  };
  user_feedback: {
    dataset: 'user_feedback';
    trusted_artifact: false;
    contaminates_golden_set: false;
    requires_human_review: true;
    total_feedback: number;
    negative_feedback: number;
    average_rating: number;
    latest_feedback_at: string | null;
    by_artifact: Array<{
      artifact_type: FeedbackArtifactType;
      total_feedback: number;
      negative_feedback: number;
      average_rating: number;
      latest_feedback_at: string | null;
      signals: Array<{ signal: FeedbackSignal; count: number }>;
    }>;
  };
};

type CacheAdminSnapshot = {
  generated_at: string;
  source: {
    total: number;
    fresh: number;
    expired: number;
  };
  artifacts: {
    total: number;
    fresh: number;
    expired: number;
    by_kind: Array<{
      kind: string;
      total: number;
      expired: number;
    }>;
  };
  stale_sources: Array<{
    cache_key: string;
    source_title: string;
    source_revision_id: string;
    parser_version: string;
    expires_at: string;
  }>;
  stale_artifacts: Array<{
    cache_key: string;
    kind: string;
    source_revision_id: string;
    prompt_version: string;
    taxonomy_version: string;
    expires_at: string;
  }>;
  repair_candidates: number;
};

type CacheInvalidationResult = {
  target: 'expired' | 'source' | 'artifacts' | 'cache_key' | 'all';
  dry_run: boolean;
  reason?: string;
  requested_at: string;
  matched: {
    source: number;
    artifacts: number;
    total: number;
  };
  deleted: {
    source: number;
    artifacts: number;
    total: number;
  };
};

type OpsSnapshots = {
  outcomes: OutcomesAnalytics;
  costs: CostAnalytics;
  drilldown: CostDrilldownAnalytics;
  slo: SloAnalytics;
  runtimeHealth: LocalLlmRuntimeHealth;
  runtimePresets: RuntimePresetVisibility;
  promptEvaluation: PromptEvaluationSnapshot;
  cacheAdmin: CacheAdminSnapshot;
};

type OpsDrilldownFilters = {
  packId: string;
  promptVersion: string;
  model: string;
  stage: 'all' | CostStage;
  limit: number;
};

type Tab = 'overview' | 'concepts' | 'flashcards' | 'quiz' | 'learning' | 'ops';

type CitationItem = {
  category: CitationCategory;
  label: string;
  value: string;
};

type CitationCategory = 'summary' | 'glossary' | 'flashcard' | 'quiz' | 'timeline' | 'graph';

type FeedbackArtifactType = 'overall' | 'summaries' | 'flashcards' | 'quiz' | 'glossary' | 'concept_graph';
type FeedbackSignal = 'helpful' | 'unclear' | 'incorrect' | 'missing_citation' | 'too_shallow' | 'unsafe' | 'other';

const feedbackArtifactOptions: Array<{ value: FeedbackArtifactType; label: string }> = [
  { value: 'overall', label: 'Overall' },
  { value: 'summaries', label: 'Summaries' },
  { value: 'flashcards', label: 'Flashcards' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'glossary', label: 'Glossary' },
  { value: 'concept_graph', label: 'Concept Graph' }
];

const feedbackSignalOptions: Array<{ value: FeedbackSignal; label: string }> = [
  { value: 'helpful', label: 'Helpful' },
  { value: 'unclear', label: 'Unclear' },
  { value: 'incorrect', label: 'Incorrect' },
  { value: 'missing_citation', label: 'Missing Citation' },
  { value: 'too_shallow', label: 'Too Shallow' },
  { value: 'unsafe', label: 'Unsafe' },
  { value: 'other', label: 'Other' }
];

const tabs: Array<[Tab, string]> = [
  ['overview', 'Overview'],
  ['concepts', 'Concepts'],
  ['flashcards', 'Flashcards'],
  ['quiz', 'Quiz'],
  ['learning', 'Learning'],
  ['ops', 'Ops']
];

const tabButtonId = (tab: Tab): string => `uw-tab-${tab}`;
const tabPanelId = (tab: Tab): string => `uw-tabpanel-${tab}`;

const nodeFilters = ['all', 'person', 'organization', 'event', 'concept', 'place', 'work'] as const;

const citationCategoryOrder: CitationCategory[] = ['summary', 'glossary', 'flashcard', 'quiz', 'timeline', 'graph'];

const citationCategoryLabels: Record<CitationCategory, string> = {
  summary: 'Summaries',
  glossary: 'Glossary',
  flashcard: 'Flashcards',
  quiz: 'Quiz',
  timeline: 'Timeline',
  graph: 'Concept Graph'
};

const flashcardReviewRatings: FlashcardReviewRating[] = ['again', 'hard', 'good', 'easy'];

const costStageFilters: Array<{ value: OpsDrilldownFilters['stage']; label: string }> = [
  { value: 'all', label: 'All stages' },
  { value: 'ingestion', label: 'Ingestion' },
  { value: 'summarization', label: 'Summaries' },
  { value: 'knowledge_structure', label: 'Knowledge' },
  { value: 'glossary', label: 'Glossary' },
  { value: 'active_recall', label: 'Recall' }
];

const defaultOpsDrilldownFilters: OpsDrilldownFilters = {
  packId: '',
  promptVersion: '',
  model: '',
  stage: 'all',
  limit: 25
};

const exampleTopics = ['Ada Lovelace', 'Manhattan Project', 'Neural network', 'Rosalind Franklin'];

const stageOrder: JobStatus['stage'][] = [
  'ingestion',
  'summarization',
  'knowledge_structure',
  'glossary',
  'active_recall',
  'done'
];

const stageLabel: Record<JobStatus['stage'], string> = {
  ingestion: 'Ingestion',
  summarization: 'Summaries',
  knowledge_structure: 'Knowledge',
  glossary: 'Glossary',
  active_recall: 'Recall',
  done: 'Done'
};

const tabDescriptions: Record<Tab, string> = {
  overview: 'Grounded explanations by depth, with citation chips and generation metadata.',
  concepts: 'A filtered map of people, places, works, events, and relationships.',
  flashcards: 'Active recall cards generated from cited source material.',
  quiz: 'Multiple choice checks with local grading and explanations.',
  learning: 'Due cards, review history, mastery trends, and weak areas across saved packs.',
  ops: 'Operational health, cost posture, SLOs, and model fallback signals.'
};

const getSessionId = (): string => {
  if (typeof window === 'undefined') {
    return 'server-session';
  }
  const existing = window.localStorage.getItem('ultrawiki_session_id');
  if (existing) return existing;
  const id = `sess-${crypto.randomUUID()}`;
  window.localStorage.setItem('ultrawiki_session_id', id);
  return id;
};

const getUserId = (): string => {
  if (typeof window === 'undefined') {
    return 'server-user';
  }
  const existing = window.localStorage.getItem('ultrawiki_user_id');
  if (existing) return existing;
  const id = `user-${crypto.randomUUID()}`;
  window.localStorage.setItem('ultrawiki_user_id', id);
  return id;
};

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

const formatSignedPercent = (value: number): string => {
  const rounded = Math.round(value * 100);
  return rounded > 0 ? `+${rounded}%` : `${rounded}%`;
};

const formatScore = (value: number): string => `${Math.round(value * 100)} relevance`;

const formatCurrency = (value: number): string => `$${value.toFixed(value < 1 ? 4 : 2)}`;

const formatMs = (value: number): string => `${Math.round(value).toLocaleString()} ms`;

const formatDelta = (value: number): string => {
  if (value > 0) return `+${value}`;
  return String(value);
};

const summarizeArtifactDeltas = (counts: VersionArtifactCounts): string => {
  const allDeltas: Array<[string, number]> = [
    ['summaries', counts.summaries],
    ['cards', counts.flashcards],
    ['quiz', counts.quiz_questions],
    ['glossary', counts.glossary],
    ['nodes', counts.graph_nodes],
    ['edges', counts.graph_edges],
    ['timeline', counts.timeline_events]
  ];
  const deltas = allDeltas.filter(([, value]) => value !== 0);
  return deltas.length > 0 ? deltas.map(([label, value]) => `${formatDelta(value)} ${label}`).join(', ') : 'No artifact count changes';
};

const formatWindowLabel = (hours: number): string => hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;

const normalizeOpsDrilldownFilters = (filters: OpsDrilldownFilters): OpsDrilldownFilters => ({
  packId: filters.packId.trim(),
  promptVersion: filters.promptVersion.trim(),
  model: filters.model.trim(),
  stage: filters.stage,
  limit: Number.isFinite(filters.limit) ? Math.max(1, Math.min(50, Math.round(filters.limit))) : 25
});

const buildCostDrilldownQuery = (
  windowHours: number,
  filters: OpsDrilldownFilters,
  format?: 'csv'
): string => {
  const normalized = normalizeOpsDrilldownFilters(filters);
  const params = new URLSearchParams({ window_hours: String(windowHours) });
  if (normalized.packId) params.set('pack_id', normalized.packId);
  if (normalized.promptVersion) params.set('prompt_version', normalized.promptVersion);
  if (normalized.model) params.set('model', normalized.model);
  if (normalized.stage !== 'all') params.set('stage', normalized.stage);
  params.set('limit', String(normalized.limit));
  if (format) params.set('format', format);
  return params.toString();
};

const formatSloMetricValue = (id: string, value: number): string =>
  id.endsWith('_rate') ? formatPercent(value) : formatMs(value);

const formatSloComparison = (status: SloStatus): string =>
  `Target ${status.comparator} ${formatSloMetricValue(status.id, status.target)}`;

const formatSloBurn = (burn: number): string => `${burn.toFixed(2)}x budget burn`;

const sloBurnTone = (status: SloStatus): 'green' | 'red' =>
  status.passed && status.error_budget_burn <= 1 ? 'green' : 'red';

function SloStatusRow({ status }: { status: SloStatus }): React.JSX.Element {
  return (
    <div className="uw-trend-row uw-ops-row">
      <strong>{status.name}</strong>
      <span aria-label={`${status.name} current`}>{formatSloMetricValue(status.id, status.current_value)}</span>
      <span aria-label={`${status.name} target`}>{formatSloComparison(status)}</span>
      <span className="uw-pill" data-tone={status.passed ? 'green' : 'red'} aria-label={`${status.name} status`}>
        {status.passed ? 'Pass' : 'Fail'}
      </span>
      <span className="uw-pill" data-tone={sloBurnTone(status)} aria-label={`${status.name} error budget burn`}>
        {formatSloBurn(status.error_budget_burn)}
      </span>
    </div>
  );
}

const formatDateLabel = (value?: string): string => value ? new Date(value).toLocaleDateString() : 'No activity';

const percentHeight = (value: number): string => `${Math.max(6, Math.round(Math.max(0, Math.min(1, value)) * 100))}%`;

const frontendShareUrl = (shareId: string): string =>
  `${typeof window === 'undefined' ? '' : window.location.origin}/shared/${shareId}`;

const shortCitation = (citation: string): string => {
  if (citation.length <= 76) return citation;
  return `${citation.slice(0, 72)}...`;
};

const titleCase = (value: string): string => value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());

const isShortcutEditableTarget = (target: EventTarget | null): boolean => {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(element.type);
  }
  return element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
};

const isPrimaryShortcut = (event: KeyboardEvent): boolean =>
  (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;

const isControlAltShortcut = (event: KeyboardEvent): boolean =>
  event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey;

const formatCapacityState = (value: QueueStatus['capacity_state']): string => {
  if (value === 'open') return 'Open';
  if (value === 'queue_full') return 'Queue full';
  if (value === 'global_limit') return 'Workers full';
  return 'Session full';
};

const parseTopicList = (value: string): string[] =>
  Array.from(
    new Set(
      value
        .split(/[\n,]+/)
        .map((topic) => topic.trim().replace(/\s+/g, ' '))
        .filter(Boolean)
    )
  ).slice(0, 12);

const formatBatchReason = (reason?: string): string => {
  if (!reason) return 'Accepted';
  if (reason === 'session_limit') return 'Session capacity';
  if (reason === 'queue_full') return 'Queue full';
  if (reason === 'duplicate_topic') return 'Duplicate';
  if (reason === 'invalid_wikipedia_input') return 'Invalid Wikipedia input';
  if (reason === 'budget_exceeded') return 'Budget limit';
  return titleCase(reason);
};

const formatRequestError = (status: number, payload: { error?: unknown; reason?: string }): string => {
  if (status === 429 && payload.error === 'admission_denied') {
    if (payload.reason === 'queue_full') {
      return 'System is at capacity: the generation queue is full. Wait a moment and try again.';
    }
    if (payload.reason === 'session_limit') {
      return 'Session limit reached: another study pack is already running for this browser. Wait for it to finish, then retry.';
    }
    if (payload.reason === 'global_limit') {
      return 'System is at capacity: all workers are busy. Wait a moment and try again.';
    }
    return 'System is at capacity. Wait a moment and try again.';
  }

  if (payload.error === 'budget_exceeded') {
    return `Budget limit hit${payload.reason ? `: ${payload.reason}` : ''}. Try a narrower topic or shorter article.`;
  }

  if (status === 409 && payload.error === 'pack_already_complete') {
    return 'This study pack is already complete.';
  }

  if (status === 409 && payload.error === 'pack_already_in_progress') {
    return 'This study pack is already being resumed. Waiting for the active job.';
  }

  if (typeof payload.error === 'string') {
    return `${payload.error}${payload.reason ? ` (${payload.reason})` : ''}`;
  }

  return 'Request failed';
};

const jobProgressMessage = (job: JobStatus): string => {
  if (job.status === 'queued') {
    return `Queued for ${stageLabel[job.stage]}. Waiting for worker capacity.`;
  }
  if (job.retry_state === 'retrying') {
    return `${stageLabel[job.stage]} is retrying after a transient failure.`;
  }
  if (job.degradation_state === 'partial') {
    return `${stageLabel[job.stage]} is in partial output mode. Available artifacts will stay usable${
      job.degradation_reason ? ` (${titleCase(job.degradation_reason)})` : ''
    }.`;
  }
  return `${stageLabel[job.stage]} is running at ${job.progress}%.`;
};

const formatQuizAttemptError = (status: number, payload: { error?: unknown; reason?: string }): string => {
  if (status === 409 && payload.error === 'quiz_not_ready') {
    return 'Quiz is not ready yet. Generate or reload the study pack before submitting an attempt.';
  }
  if (payload.error === 'invalid_attempt_payload') {
    return `Quiz submission was rejected${payload.reason ? `: ${payload.reason}` : ''}.`;
  }
  if (typeof payload.error === 'string') {
    return `Quiz submission failed: ${payload.error}${payload.reason ? ` (${payload.reason})` : ''}`;
  }
  return 'Quiz submission failed.';
};

const uniqueCitations = (pack: StudyPack | null): CitationItem[] => {
  if (!pack) return [];

  const items: CitationItem[] = [];
  const seen = new Set<string>();
  const add = (category: CitationCategory, label: string, value?: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    items.push({ category, label, value });
  };

  pack.summaries.forEach((summary) => summary.citations.forEach((citation) => add('summary', `${summary.level} summary`, citation)));
  pack.glossary.forEach((term) => add('glossary', term.term, term.citation));
  pack.flashcards.forEach((card, idx) => add('flashcard', `flashcard ${idx + 1}`, card.citation));
  pack.quiz_questions.forEach((question, idx) => add('quiz', `quiz ${idx + 1}`, question.citation));
  pack.timeline.forEach((event) => add('timeline', event.date_label, event.citation));
  pack.graph.nodes.forEach((node) => add('graph', node.label, node.citation));
  pack.graph.edges.forEach((edge, idx) => add('graph', `relationship ${idx + 1}`, edge.citation));

  return items;
};

const modelFootprint = (pack: StudyPack | null): Array<{ artifact: string; version: string; model: string }> => {
  if (!pack) return [];

  const items = [
    ...pack.summaries.map((summary) => ({ artifact: `${summary.level} summary`, version: summary.prompt_version, model: summary.model })),
    ...pack.glossary.slice(0, 2).map((term) => ({ artifact: `glossary ${term.term}`, version: term.prompt_version, model: term.model })),
    ...pack.flashcards.slice(0, 2).map((card, idx) => ({ artifact: `flashcard ${idx + 1}`, version: card.prompt_version, model: card.model })),
    ...pack.quiz_questions.slice(0, 2).map((question, idx) => ({ artifact: `quiz ${idx + 1}`, version: question.prompt_version, model: question.model }))
  ];

  return items.slice(0, 7);
};

const feedbackPromptMetadata = (
  pack: StudyPack | null,
  artifactType: FeedbackArtifactType
): { promptVersion?: string; model?: string; artifactId?: string } => {
  if (!pack) return {};
  if (artifactType === 'summaries') {
    const summary = pack.summaries[0];
    return summary ? { promptVersion: summary.prompt_version, model: summary.model, artifactId: summary.level } : {};
  }
  if (artifactType === 'flashcards') {
    const card = pack.flashcards[0];
    return card ? { promptVersion: card.prompt_version, model: card.model, artifactId: 'card-0' } : {};
  }
  if (artifactType === 'quiz') {
    const question = pack.quiz_questions[0];
    return question ? { promptVersion: question.prompt_version, model: question.model, artifactId: 'question-0' } : {};
  }
  if (artifactType === 'glossary') {
    const term = pack.glossary[0];
    return term ? { promptVersion: term.prompt_version, model: term.model, artifactId: term.term } : {};
  }
  return {};
};

const cacheFootprint = (pack: StudyPack | null): CacheEvent[] => {
  if (!pack) return [];
  return [pack.cache.source, ...pack.cache.artifacts].filter((event): event is CacheEvent => Boolean(event));
};

function RunbookLink({ href, label }: { href: string; label: string }) {
  return (
    <a aria-label={`Open runbook for ${label}`} className="uw-runbook-link" href={href} rel="noreferrer" target="_blank">
      Runbook
    </a>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="uw-metric">
      <strong>{value}</strong>
      <span>{label}</span>
      {detail ? <p className="uw-micro">{detail}</p> : null}
    </div>
  );
}

function StatusPill({ job, busy }: { job: JobStatus | null; busy: boolean }) {
  if (!job) {
    return <span className="uw-pill" role="status" aria-live="polite">Ready</span>;
  }

  const tone = job.status === 'completed' ? 'green' : job.status === 'failed' || job.status === 'quarantined' ? 'red' : 'coral';
  const label = job.status === 'completed' && job.degradation_state === 'partial'
    ? 'Partial'
    : busy
      ? 'Generating'
      : titleCase(job.status);
  return (
    <span className="uw-pill" data-tone={tone} role="status" aria-live="polite">
      {label}
    </span>
  );
}

function TopBar({
  topicInput,
  setTopicInput,
  submitTopic,
  busy,
  job,
  inputRef
}: {
  topicInput: string;
  setTopicInput: (value: string) => void;
  submitTopic: () => void;
  busy: boolean;
  job: JobStatus | null;
  inputRef: React.Ref<HTMLInputElement>;
}) {
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitTopic();
  };

  return (
    <header className="uw-topbar">
      <div className="uw-brand">
        <span className="uw-mark">U</span>
        <span>UltraWiki</span>
      </div>
      <form className="uw-command" onSubmit={onSubmit}>
        <input
          className="uw-input"
          ref={inputRef}
          value={topicInput}
          onChange={(event) => setTopicInput(event.target.value)}
          placeholder="Search a Wikipedia title or URL"
          aria-label="Wikipedia topic or URL"
        />
        <button className="uw-generate" disabled={busy || topicInput.trim().length === 0} type="submit">
          {busy ? 'Generating...' : 'Generate'}
        </button>
      </form>
      <div className="uw-top-meta">
        <StatusPill job={job} busy={busy} />
        <span className="uw-pill">Local first</span>
      </div>
    </header>
  );
}

function RecentPacks({
  history,
  loading,
  error,
  onOpenHistory,
  onRetry
}: {
  history: StudyPackHistoryItem[];
  loading: boolean;
  error: string | null;
  onOpenHistory: (packId: string) => void;
  onRetry: () => void;
}) {
  return (
    <section className="uw-panel uw-panel-pad">
      <div className="uw-split">
        <h2 className="uw-section-title">Recent Packs</h2>
        <button className="uw-filter" disabled={loading} onClick={onRetry} type="button" aria-label="Refresh recent packs">
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>
      {loading && history.length === 0 ? <p className="uw-muted">Loading recent packs...</p> : null}
      {error ? (
        <div className="uw-inline-alert">
          <p className="uw-error-text">{error}</p>
          <button className="uw-secondary" disabled={loading} onClick={onRetry} type="button">
            Retry recent packs
          </button>
        </div>
      ) : null}
      {history.length > 0 ? (
        <div className="uw-history-list">
          {history.map((item) => (
            <button
              className="uw-history-item"
              key={item.id}
              onClick={() => onOpenHistory(item.id)}
              type="button"
            >
              <span>{item.input}</span>
              <strong>{item.readiness.status === 'full' ? 'Full' : `Missing ${item.readiness.missing_artifacts.length}`}</strong>
              <small>rev {item.source_revision_id}</small>
            </button>
          ))}
        </div>
      ) : !loading && !error ? (
        <p className="uw-muted">Generated packs for this browser session will appear here.</p>
      ) : null}
    </section>
  );
}

function SavedLibrary({
  library,
  facets,
  userId,
  search,
  readinessFilter,
  progressFilter,
  tagFilter,
  collectionFilter,
  sort,
  organizationCollection,
  organizationTags,
  organizationSaving,
  organizationStatus,
  organizationError,
  versionHistory,
  versionLoading,
  versionError,
  loading,
  error,
  onUserIdChange,
  onSearchChange,
  onReadinessFilterChange,
  onProgressFilterChange,
  onTagFilterChange,
  onCollectionFilterChange,
  onSortChange,
  onOrganizationCollectionChange,
  onOrganizationTagsChange,
  onSaveOrganization,
  onRetryVersions,
  onResetFilters,
  onOpenLibrary,
  onSaveCurrent,
  onRetry,
  canSave,
  canOrganize,
  saving
}: {
  library: StudyPackHistoryItem[];
  facets: LibraryFacets | null;
  userId: string;
  search: string;
  readinessFilter: LibraryReadinessFilter;
  progressFilter: LibraryProgressFilter;
  tagFilter: string;
  collectionFilter: string;
  sort: LibrarySort;
  organizationCollection: string;
  organizationTags: string;
  organizationSaving: boolean;
  organizationStatus: string | null;
  organizationError: string | null;
  versionHistory: SavedPackVersionHistory | null;
  versionLoading: boolean;
  versionError: string | null;
  loading: boolean;
  error: string | null;
  onUserIdChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onReadinessFilterChange: (value: LibraryReadinessFilter) => void;
  onProgressFilterChange: (value: LibraryProgressFilter) => void;
  onTagFilterChange: (value: string) => void;
  onCollectionFilterChange: (value: string) => void;
  onSortChange: (value: LibrarySort) => void;
  onOrganizationCollectionChange: (value: string) => void;
  onOrganizationTagsChange: (value: string) => void;
  onSaveOrganization: () => void;
  onRetryVersions: () => void;
  onResetFilters: () => void;
  onOpenLibrary: (packId: string) => void;
  onSaveCurrent: () => void;
  onRetry: () => void;
  canSave: boolean;
  canOrganize: boolean;
  saving: boolean;
}) {
  const hasActiveFilters = Boolean(search.trim()) || readinessFilter !== 'all' || progressFilter !== 'all' || tagFilter !== 'all' || collectionFilter !== 'all' || sort !== 'saved_desc';
  return (
    <section className="uw-panel uw-panel-pad">
      <div className="uw-split">
        <div>
          <h2 className="uw-section-title">Saved Library</h2>
          <p className="uw-muted">Use the same library key on another device to load saved packs.</p>
        </div>
        <span className="uw-pill">{library.length} saved</span>
      </div>
      <label className="uw-library-key">
        <span>Library key</span>
        <input
          aria-label="Library key"
          value={userId}
          onChange={(event) => onUserIdChange(event.target.value)}
          spellCheck={false}
        />
      </label>
      <label className="uw-library-key">
        <span>Search</span>
        <input
          aria-label="Search saved library"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          spellCheck={false}
        />
      </label>
      <div className="uw-library-controls">
        <label>
          <span>Readiness</span>
          <select
            aria-label="Library readiness filter"
            value={readinessFilter}
            onChange={(event) => onReadinessFilterChange(event.target.value as LibraryReadinessFilter)}
          >
            <option value="all">All readiness</option>
            <option value="full">Full</option>
            <option value="partial">Partial</option>
          </select>
        </label>
        <label>
          <span>Progress</span>
          <select
            aria-label="Library progress filter"
            value={progressFilter}
            onChange={(event) => onProgressFilterChange(event.target.value as LibraryProgressFilter)}
          >
            <option value="all">All progress</option>
            <option value="due">Due</option>
            <option value="reviewed">Reviewed</option>
            <option value="not_started">Not started</option>
          </select>
        </label>
        <label>
          <span>Tag</span>
          <select aria-label="Library tag filter" value={tagFilter} onChange={(event) => onTagFilterChange(event.target.value)}>
            <option value="all">All tags</option>
            {(facets?.tags ?? []).map((facet) => (
              <option key={facet.tag} value={facet.tag}>
                {facet.tag} ({facet.count})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Collection</span>
          <select aria-label="Library collection filter" value={collectionFilter} onChange={(event) => onCollectionFilterChange(event.target.value)}>
            <option value="all">All collections</option>
            {(facets?.collections ?? []).map((facet) => (
              <option key={facet.collection} value={facet.collection}>
                {facet.collection} ({facet.count})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select aria-label="Library sort" value={sort} onChange={(event) => onSortChange(event.target.value as LibrarySort)}>
            <option value="saved_desc">Newest saved</option>
            <option value="saved_asc">Oldest saved</option>
            <option value="title_asc">Title A-Z</option>
            <option value="title_desc">Title Z-A</option>
            <option value="due_desc">Due first</option>
            <option value="mastery_desc">Mastery high</option>
          </select>
        </label>
      </div>
      {facets ? (
        <div className="uw-library-facets" aria-label="Library facets">
          <span>{facets.total} total</span>
          <span>{facets.readiness.full} full</span>
          <span>{facets.readiness.partial} partial</span>
          <span>{facets.progress.due} due</span>
          <span>{facets.progress.not_started} not started</span>
          <span>{facets.tags?.length ?? 0} tags</span>
          <span>{facets.collections?.length ?? 0} collections</span>
        </div>
      ) : null}
      <button className="uw-secondary" disabled={!canSave || saving} onClick={onSaveCurrent} type="button">
        {saving ? 'Saving...' : 'Save current pack'}
      </button>
      <div className="uw-library-organization">
        <label>
          <span>Collection</span>
          <input
            aria-label="Current pack collection"
            disabled={!canOrganize || organizationSaving}
            value={organizationCollection}
            onChange={(event) => onOrganizationCollectionChange(event.target.value)}
            spellCheck={false}
          />
        </label>
        <label>
          <span>Tags</span>
          <input
            aria-label="Current pack tags"
            disabled={!canOrganize || organizationSaving}
            value={organizationTags}
            onChange={(event) => onOrganizationTagsChange(event.target.value)}
            spellCheck={false}
          />
        </label>
        <button className="uw-filter" disabled={!canOrganize || organizationSaving} onClick={onSaveOrganization} type="button">
          {organizationSaving ? 'Saving organization...' : 'Save pack organization'}
        </button>
        {organizationStatus ? <p className="uw-success-text">{organizationStatus}</p> : null}
        {organizationError ? <p className="uw-error-text">{organizationError}</p> : null}
      </div>
      <section className="uw-library-versions" aria-label="Pack version history">
        <div className="uw-split">
          <div>
            <h3>Version History</h3>
            <p className="uw-muted">Compare saved regenerations for the same topic.</p>
          </div>
          {versionHistory ? <span className="uw-pill">{versionHistory.versions.length} versions</span> : null}
        </div>
        {versionLoading ? <p className="uw-muted">Loading versions...</p> : null}
        {versionError ? (
          <div className="uw-inline-alert">
            <p className="uw-error-text">{versionError}</p>
            <button className="uw-secondary" disabled={versionLoading} onClick={onRetryVersions} type="button">
              Retry versions
            </button>
          </div>
        ) : null}
        {versionHistory && !versionLoading ? (
          <div className="uw-version-summary">
            <div className="uw-kv">
              <span>Source revision</span>
              <strong>{versionHistory.compare.source_revision_changed ? 'Changed' : 'Same'}</strong>
            </div>
            <div className="uw-kv">
              <span>Readiness</span>
              <strong>{versionHistory.compare.readiness_changed ? 'Changed' : 'Same'}</strong>
            </div>
            <p className="uw-micro">{summarizeArtifactDeltas(versionHistory.compare.artifact_deltas)}</p>
            <div className="uw-history-list">
              {versionHistory.versions.map((version) => (
                <button
                  className="uw-history-item"
                  data-current={version.current ? 'true' : undefined}
                  key={version.id}
                  onClick={() => onOpenLibrary(version.id)}
                  type="button"
                >
                  <span>{version.input}</span>
                  <strong>{version.current ? 'Current' : version.source_revision_changed ? 'Source changed' : 'Same source'}</strong>
                  <small>rev {version.source_revision_id}</small>
                  <small>
                    {version.artifact_counts.summaries} summaries, {version.artifact_counts.flashcards} cards,{' '}
                    {version.artifact_counts.quiz_questions} quiz
                  </small>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {!versionHistory && !versionLoading && !versionError ? (
          <p className="uw-muted">Save this pack to compare regenerated versions.</p>
        ) : null}
      </section>
      <button className="uw-filter" disabled={loading} onClick={onRetry} type="button">
        {loading ? 'Loading...' : 'Refresh saved library'}
      </button>
      <button className="uw-filter" disabled={!hasActiveFilters || loading} onClick={onResetFilters} type="button">
        Reset library filters
      </button>
      {loading && library.length === 0 ? <p className="uw-muted">Loading saved library...</p> : null}
      {error ? (
        <div className="uw-inline-alert">
          <p className="uw-error-text">{error}</p>
          <button className="uw-secondary" disabled={loading} onClick={onRetry} type="button">
            Retry saved library
          </button>
        </div>
      ) : null}
      {library.length > 0 ? (
        <div className="uw-history-list">
          {library.map((item) => (
            <button
              className="uw-history-item"
              key={item.id}
              onClick={() => onOpenLibrary(item.id)}
              type="button"
            >
              <span>{item.input}</span>
              <strong>{item.readiness.status === 'full' ? 'Full' : `Missing ${item.readiness.missing_artifacts.length}`}</strong>
              {item.progress ? (
                <small>
                  {item.progress.reviewed_cards}/{item.progress.total_cards} reviewed, {item.progress.due_cards} due,{' '}
                  {Math.round(item.progress.mastery_score * 100)}% mastery
                </small>
              ) : null}
              {item.organization?.collection ? <small>Collection: {item.organization.collection}</small> : null}
              {item.organization?.tags.length ? <small>Tags: {item.organization.tags.join(', ')}</small> : null}
              <small>rev {item.source_revision_id}</small>
            </button>
          ))}
        </div>
      ) : !loading && !error ? (
        <p className="uw-muted">{hasActiveFilters ? 'No saved packs match these filters.' : 'Saved packs for this library key will appear here.'}</p>
      ) : null}
    </section>
  );
}

const accountSourceLabel = (session: AuthSessionState, activeUserId: string): string => {
  if (session.authenticated && session.source === 'session') {
    return 'Session';
  }
  if (session.authenticated && session.source === 'legacy_header') {
    return 'Header';
  }
  return activeUserId ? 'Library key' : 'Signed out';
};

function AccountPanel({
  session,
  activeProfile,
  activeUserId,
  displayNameDraft,
  onDisplayNameChange,
  onSaveDisplayName,
  profileSaving,
  accountDataBusy,
  deleteDataConfirming,
  authLoading,
  authError,
  onExportData,
  onDeleteData,
  onLogout
}: {
  session: AuthSessionState;
  activeProfile: UserProfile | null;
  activeUserId: string;
  displayNameDraft: string;
  onDisplayNameChange: (value: string) => void;
  onSaveDisplayName: () => void;
  profileSaving: boolean;
  accountDataBusy: boolean;
  deleteDataConfirming: boolean;
  authLoading: boolean;
  authError: string | null;
  onExportData: () => void;
  onDeleteData: () => void;
  onLogout: () => void;
}) {
  const signedIn = Boolean(session.authenticated && session.user);
  const source = accountSourceLabel(session, activeUserId);
  const displayLabel = activeProfile?.display_name ?? activeUserId;

  return (
    <section className="uw-panel uw-panel-pad">
      <div className="uw-split">
        <h2 className="uw-section-title">Account</h2>
        <span className="uw-pill" data-tone={signedIn ? 'green' : activeUserId ? 'coral' : undefined}>
          {source}
        </span>
      </div>
      <div className="uw-kv">
        <span>Active user</span>
        <strong>{displayLabel || 'None'}</strong>
      </div>
      {activeUserId ? (
        <div className="uw-kv">
          <span>User ID</span>
          <strong>{activeUserId}</strong>
        </div>
      ) : null}
      <label className="uw-library-key">
        <span>Display name</span>
        <input
          aria-label="Display name"
          disabled={!activeUserId || profileSaving}
          value={displayNameDraft}
          onChange={(event) => onDisplayNameChange(event.target.value)}
        />
      </label>
      <div className="uw-account-actions">
        <button
          className="uw-secondary"
          disabled={!activeUserId || !displayNameDraft.trim() || profileSaving}
          onClick={onSaveDisplayName}
          type="button"
        >
          {profileSaving ? 'Saving...' : 'Save display name'}
        </button>
        <a className="uw-secondary uw-account-link" href="/api/auth/login?redirect_path=/">
          Login
        </a>
        <button className="uw-secondary" disabled={!signedIn || authLoading} onClick={onLogout} type="button">
          {authLoading ? 'Working...' : 'Logout'}
        </button>
      </div>
      <div className="uw-account-actions">
        <button
          className="uw-secondary"
          disabled={!activeUserId || accountDataBusy}
          onClick={onExportData}
          type="button"
        >
          {accountDataBusy ? 'Working...' : 'Export data'}
        </button>
        <button
          className="uw-secondary"
          data-tone={deleteDataConfirming ? 'coral' : undefined}
          disabled={!activeUserId || accountDataBusy}
          onClick={onDeleteData}
          type="button"
        >
          {deleteDataConfirming ? 'Confirm delete' : 'Delete data'}
        </button>
      </div>
      {authError ? <p className="uw-error-text">{authError}</p> : null}
    </section>
  );
}

function LeftRail({
  pack,
  history,
  library,
  libraryFacets,
  userId,
  librarySearch,
  libraryReadinessFilter,
  libraryProgressFilter,
  libraryTagFilter,
  libraryCollectionFilter,
  librarySort,
  libraryOrganizationCollection,
  libraryOrganizationTags,
  libraryOrganizationSaving,
  libraryOrganizationStatus,
  libraryOrganizationError,
  libraryVersionHistory,
  libraryVersionLoading,
  libraryVersionError,
  historyLoading,
  historyError,
  libraryLoading,
  libraryError,
  accountSession,
  activeProfile,
  activeUserId,
  displayNameDraft,
  onUserIdChange,
  onLibrarySearchChange,
  onLibraryReadinessFilterChange,
  onLibraryProgressFilterChange,
  onLibraryTagFilterChange,
  onLibraryCollectionFilterChange,
  onLibrarySortChange,
  onLibraryOrganizationCollectionChange,
  onLibraryOrganizationTagsChange,
  onResetLibraryFilters,
  onDisplayNameChange,
  onSaveDisplayName,
  onExportData,
  onDeleteData,
  onLogout,
  onOpenHistory,
  onOpenLibrary,
  onSaveCurrent,
  onSaveLibraryOrganization,
  onRetryLibraryVersions,
  onRetryHistory,
  onRetryLibrary,
  librarySaving,
  profileSaving,
  accountDataBusy,
  deleteDataConfirming,
  authLoading,
  authError
}: {
  pack: StudyPack | null;
  history: StudyPackHistoryItem[];
  library: StudyPackHistoryItem[];
  libraryFacets: LibraryFacets | null;
  userId: string;
  librarySearch: string;
  libraryReadinessFilter: LibraryReadinessFilter;
  libraryProgressFilter: LibraryProgressFilter;
  libraryTagFilter: string;
  libraryCollectionFilter: string;
  librarySort: LibrarySort;
  libraryOrganizationCollection: string;
  libraryOrganizationTags: string;
  libraryOrganizationSaving: boolean;
  libraryOrganizationStatus: string | null;
  libraryOrganizationError: string | null;
  libraryVersionHistory: SavedPackVersionHistory | null;
  libraryVersionLoading: boolean;
  libraryVersionError: string | null;
  historyLoading: boolean;
  historyError: string | null;
  libraryLoading: boolean;
  libraryError: string | null;
  accountSession: AuthSessionState;
  activeProfile: UserProfile | null;
  activeUserId: string;
  displayNameDraft: string;
  onUserIdChange: (value: string) => void;
  onLibrarySearchChange: (value: string) => void;
  onLibraryReadinessFilterChange: (value: LibraryReadinessFilter) => void;
  onLibraryProgressFilterChange: (value: LibraryProgressFilter) => void;
  onLibraryTagFilterChange: (value: string) => void;
  onLibraryCollectionFilterChange: (value: string) => void;
  onLibrarySortChange: (value: LibrarySort) => void;
  onLibraryOrganizationCollectionChange: (value: string) => void;
  onLibraryOrganizationTagsChange: (value: string) => void;
  onResetLibraryFilters: () => void;
  onDisplayNameChange: (value: string) => void;
  onSaveDisplayName: () => void;
  onExportData: () => void;
  onDeleteData: () => void;
  onLogout: () => void;
  onOpenHistory: (packId: string) => void;
  onOpenLibrary: (packId: string) => void;
  onSaveCurrent: () => void;
  onSaveLibraryOrganization: () => void;
  onRetryLibraryVersions: () => void;
  onRetryHistory: () => void;
  onRetryLibrary: () => void;
  librarySaving: boolean;
  profileSaving: boolean;
  accountDataBusy: boolean;
  deleteDataConfirming: boolean;
  authLoading: boolean;
  authError: string | null;
}) {
  const accountPanel = (
    <AccountPanel
      session={accountSession}
      activeProfile={activeProfile}
      activeUserId={activeUserId}
      displayNameDraft={displayNameDraft}
      onDisplayNameChange={onDisplayNameChange}
      onSaveDisplayName={onSaveDisplayName}
      profileSaving={profileSaving}
      accountDataBusy={accountDataBusy}
      deleteDataConfirming={deleteDataConfirming}
      authLoading={authLoading}
      authError={authError}
      onExportData={onExportData}
      onDeleteData={onDeleteData}
      onLogout={onLogout}
    />
  );

  if (!pack) {
    return (
      <aside className="uw-sidebar">
        <section className="uw-panel uw-panel-pad">
          <h2 className="uw-section-title">Workspace</h2>
          <p className="uw-muted">Generate a pack to populate grounded summaries, graph entities, recall cards, and quiz checks.</p>
        </section>
        <RecentPacks
          history={history}
          loading={historyLoading}
          error={historyError}
          onOpenHistory={onOpenHistory}
          onRetry={onRetryHistory}
        />
        {accountPanel}
        <SavedLibrary
          library={library}
          facets={libraryFacets}
          userId={userId}
          search={librarySearch}
          readinessFilter={libraryReadinessFilter}
          progressFilter={libraryProgressFilter}
          tagFilter={libraryTagFilter}
          collectionFilter={libraryCollectionFilter}
          sort={librarySort}
          organizationCollection={libraryOrganizationCollection}
          organizationTags={libraryOrganizationTags}
          organizationSaving={libraryOrganizationSaving}
          organizationStatus={libraryOrganizationStatus}
          organizationError={libraryOrganizationError}
          versionHistory={libraryVersionHistory}
          versionLoading={libraryVersionLoading}
          versionError={libraryVersionError}
          loading={libraryLoading}
          error={libraryError}
          onUserIdChange={onUserIdChange}
          onSearchChange={onLibrarySearchChange}
          onReadinessFilterChange={onLibraryReadinessFilterChange}
          onProgressFilterChange={onLibraryProgressFilterChange}
          onTagFilterChange={onLibraryTagFilterChange}
          onCollectionFilterChange={onLibraryCollectionFilterChange}
          onSortChange={onLibrarySortChange}
          onOrganizationCollectionChange={onLibraryOrganizationCollectionChange}
          onOrganizationTagsChange={onLibraryOrganizationTagsChange}
          onSaveOrganization={onSaveLibraryOrganization}
          onRetryVersions={onRetryLibraryVersions}
          onResetFilters={onResetLibraryFilters}
          onOpenLibrary={onOpenLibrary}
          onSaveCurrent={onSaveCurrent}
          onRetry={onRetryLibrary}
          canSave={false}
          canOrganize={false}
          saving={librarySaving}
        />
        <section className="uw-panel uw-panel-pad">
          <h2 className="uw-section-title">Built For</h2>
          <div className="uw-kv"><span>Source</span><strong>Wikipedia revision</strong></div>
          <div className="uw-kv"><span>AI</span><strong>Prompt versioned</strong></div>
          <div className="uw-kv"><span>Mode</span><strong>Study workflow</strong></div>
        </section>
      </aside>
    );
  }

  return (
    <aside className="uw-sidebar">
      <section className="uw-panel uw-panel-pad">
        <h2 className="uw-section-title">Source</h2>
        <div className="uw-kv"><span>Revision</span><strong>{pack.source_revision_id}</strong></div>
        <div className="uw-links">
          <a href={pack.source_attribution.canonical_url} target="_blank" rel="noreferrer">Canonical article</a>
          <a href={pack.source_attribution.revision_url} target="_blank" rel="noreferrer">Exact revision</a>
        </div>
        <p className="uw-micro">License: {pack.source_attribution.license}</p>
      </section>
      <section className="uw-panel uw-panel-pad">
        <h2 className="uw-section-title">Grounding</h2>
        <div className="uw-kv"><span>Citation rate</span><strong>{formatPercent(pack.grounding_stats.citation_rate)}</strong></div>
        <div className="uw-kv"><span>Unsupported</span><strong>{pack.grounding_stats.unsupported_claims}</strong></div>
      </section>
      <section className="uw-panel uw-panel-pad">
        <h2 className="uw-section-title">Artifacts</h2>
        <div className="uw-kv"><span>Summaries</span><strong>{pack.summaries.length}</strong></div>
        <div className="uw-kv"><span>Glossary</span><strong>{pack.glossary.length}</strong></div>
        <div className="uw-kv"><span>Concept nodes</span><strong>{pack.graph.nodes.length}</strong></div>
        <div className="uw-kv"><span>Relationships</span><strong>{pack.graph.edges.length}</strong></div>
        <div className="uw-kv"><span>Recall cards</span><strong>{pack.flashcards.length}</strong></div>
        <div className="uw-kv"><span>Quiz items</span><strong>{pack.quiz_questions.length}</strong></div>
      </section>
      <RecentPacks
        history={history}
        loading={historyLoading}
        error={historyError}
        onOpenHistory={onOpenHistory}
        onRetry={onRetryHistory}
      />
      {accountPanel}
      <SavedLibrary
        library={library}
        facets={libraryFacets}
        userId={userId}
        search={librarySearch}
        readinessFilter={libraryReadinessFilter}
        progressFilter={libraryProgressFilter}
        tagFilter={libraryTagFilter}
        collectionFilter={libraryCollectionFilter}
        sort={librarySort}
        organizationCollection={libraryOrganizationCollection}
        organizationTags={libraryOrganizationTags}
        organizationSaving={libraryOrganizationSaving}
        organizationStatus={libraryOrganizationStatus}
        organizationError={libraryOrganizationError}
        versionHistory={libraryVersionHistory}
        versionLoading={libraryVersionLoading}
        versionError={libraryVersionError}
        loading={libraryLoading}
        error={libraryError}
        onUserIdChange={onUserIdChange}
        onSearchChange={onLibrarySearchChange}
        onReadinessFilterChange={onLibraryReadinessFilterChange}
        onProgressFilterChange={onLibraryProgressFilterChange}
        onTagFilterChange={onLibraryTagFilterChange}
        onCollectionFilterChange={onLibraryCollectionFilterChange}
        onSortChange={onLibrarySortChange}
        onOrganizationCollectionChange={onLibraryOrganizationCollectionChange}
        onOrganizationTagsChange={onLibraryOrganizationTagsChange}
        onSaveOrganization={onSaveLibraryOrganization}
        onRetryVersions={onRetryLibraryVersions}
        onResetFilters={onResetLibraryFilters}
        onOpenLibrary={onOpenLibrary}
        onSaveCurrent={onSaveCurrent}
        onRetry={onRetryLibrary}
        canSave={Boolean(pack && activeUserId)}
        canOrganize={Boolean(pack && activeUserId && library.some((item) => item.id === pack.id))}
        saving={librarySaving}
      />
    </aside>
  );
}

function RightRail({
  pack,
  job,
  error,
  queueStatus,
  queueStatusLoading,
  queueStatusError,
  isOffline,
  batchTopicInput,
  batchSubmitting,
  batchResult,
  batchError,
  shareLink,
  shareLinks,
  shareBusy,
  shareManagementLoading,
  shareManagementError,
  shareRevokingId,
  inspectedShareId,
  copiedShareId,
  feedbackArtifactType,
  feedbackSignal,
  feedbackRating,
  feedbackComment,
  feedbackSubmitting,
  feedbackStatus,
  feedbackError,
  activeUserId,
  onBatchTopicInputChange,
  onStartBatchGeneration,
  onCreateShareLink,
  onRefreshQueueStatus,
  onRefreshShareLinks,
  onCopyShareLink,
  onInspectShareLink,
  onRevokeShareLink,
  onFeedbackArtifactTypeChange,
  onFeedbackSignalChange,
  onFeedbackRatingChange,
  onFeedbackCommentChange,
  onSubmitFeedback
}: {
  pack: StudyPack | null;
  job: JobStatus | null;
  error: string | null;
  queueStatus: QueueStatus | null;
  queueStatusLoading: boolean;
  queueStatusError: string | null;
  isOffline: boolean;
  batchTopicInput: string;
  batchSubmitting: boolean;
  batchResult: BatchGenerationResult | null;
  batchError: string | null;
  shareLink: ShareLink | null;
  shareLinks: ShareLink[];
  shareBusy: boolean;
  shareManagementLoading: boolean;
  shareManagementError: string | null;
  shareRevokingId: string | null;
  inspectedShareId: string | null;
  copiedShareId: string | null;
  feedbackArtifactType: FeedbackArtifactType;
  feedbackSignal: FeedbackSignal;
  feedbackRating: string;
  feedbackComment: string;
  feedbackSubmitting: boolean;
  feedbackStatus: string | null;
  feedbackError: string | null;
  activeUserId: string;
  onBatchTopicInputChange: (value: string) => void;
  onStartBatchGeneration: () => void;
  onCreateShareLink: () => void;
  onRefreshQueueStatus: () => void;
  onRefreshShareLinks: () => void;
  onCopyShareLink: (share: ShareLink) => void;
  onInspectShareLink: (shareId: string) => void;
  onRevokeShareLink: (shareId: string) => void;
  onFeedbackArtifactTypeChange: (value: FeedbackArtifactType) => void;
  onFeedbackSignalChange: (value: FeedbackSignal) => void;
  onFeedbackRatingChange: (value: string) => void;
  onFeedbackCommentChange: (value: string) => void;
  onSubmitFeedback: () => void;
}) {
  const [citationSearch, setCitationSearch] = useState('');
  const [citationCategoryFilter, setCitationCategoryFilter] = useState<'all' | CitationCategory>('all');
  const citations = useMemo(() => uniqueCitations(pack), [pack]);
  const citationCounts = useMemo(() => {
    const counts = new Map<CitationCategory, number>();
    citations.forEach((citation) => counts.set(citation.category, (counts.get(citation.category) ?? 0) + 1));
    return counts;
  }, [citations]);
  const normalizedCitationSearch = citationSearch.trim().toLowerCase();
  const filteredCitations = useMemo(() => {
    return citations.filter((citation) => {
      if (citationCategoryFilter !== 'all' && citation.category !== citationCategoryFilter) return false;
      if (!normalizedCitationSearch) return true;
      return [
        citationCategoryLabels[citation.category],
        citation.label,
        citation.value
      ].join(' ').toLowerCase().includes(normalizedCitationSearch);
    });
  }, [citationCategoryFilter, citations, normalizedCitationSearch]);
  const groupedCitations = useMemo(() => {
    return citationCategoryOrder
      .map((category) => ({
        category,
        items: filteredCitations.filter((citation) => citation.category === category)
      }))
      .filter((group) => group.items.length > 0);
  }, [filteredCitations]);
  const footprint = useMemo(() => modelFootprint(pack), [pack]);
  const cacheEvents = useMemo(() => cacheFootprint(pack), [pack]);
  const batchTopics = useMemo(() => parseTopicList(batchTopicInput), [batchTopicInput]);
  const currentStageIndex = job ? Math.max(stageOrder.indexOf(job.stage), 0) : -1;
  const shareUrl = shareLink
    ? frontendShareUrl(shareLink.share.share_id)
    : null;
  const inspectedShare = inspectedShareId ? shareLinks.find((item) => item.share.share_id === inspectedShareId) ?? null : null;

  return (
    <aside className="uw-right-rail">
      <section className="uw-panel uw-panel-pad">
        <h2 className="uw-section-title">Generation</h2>
        <div className="uw-progress-track" aria-label="Generation progress">
          <div className="uw-progress-bar" style={{ width: `${job?.progress ?? 0}%` }} />
        </div>
        <div className="uw-stage-list">
          {stageOrder.map((stage, idx) => {
            const state = !job ? 'pending' : job.status === 'completed' || idx < currentStageIndex ? 'done' : idx === currentStageIndex ? 'active' : 'pending';
            return (
              <div className="uw-stage" data-state={state} key={stage}>
                <span className="uw-dot" />
                <span>{stageLabel[stage]}</span>
                <span className="uw-micro">{state}</span>
              </div>
            );
          })}
        </div>
        {job?.retry_state === 'retrying' ? (
          <p className="uw-warning uw-panel-pad">
            Retrying after a transient failure{typeof job.attempt === 'number' ? ` (attempt ${job.attempt})` : ''}.
          </p>
        ) : null}
        {job?.degradation_state === 'partial' ? (
          <p className="uw-warning uw-panel-pad">
            Partial output mode is active. UltraWiki will show completed artifacts and avoid hiding usable work.
            {job.degradation_reason ? ` Reason: ${titleCase(job.degradation_reason)}.` : ''}
          </p>
        ) : null}
        {error ? <p className="uw-error uw-panel-pad">{error}</p> : null}
      </section>
      <section className="uw-panel uw-panel-pad">
        <h2 className="uw-section-title">Export</h2>
        {pack ? (
          <div className="uw-grid">
            <div className="uw-export-actions">
              <a href={`/api/study-packs/${pack.id}/export?format=markdown`}>Markdown</a>
              <a href={`/api/study-packs/${pack.id}/export?format=json`}>JSON</a>
              <a href={`/api/study-packs/${pack.id}/export?format=anki_csv`}>Anki CSV</a>
            </div>
            <div className="uw-share-box" aria-label="Pack sharing">
              <button className="uw-secondary" disabled={shareBusy} onClick={onCreateShareLink} type="button">
                {shareBusy ? 'Creating share...' : 'Create share link'}
              </button>
              {shareUrl ? (
                <div className="uw-share-link">
                  <span>Viewer link</span>
                  <strong>{shareUrl}</strong>
                </div>
              ) : (
                <p className="uw-muted">Create a read-only link for another browser or device.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="uw-muted">Exports appear after a pack is loaded.</p>
        )}
      </section>
      <section className="uw-panel uw-panel-pad" aria-label="Generation quality feedback">
        <h2 className="uw-section-title">Quality Feedback</h2>
        {pack ? (
          <div className="uw-goal-form">
            <label>
              <span>Artifact</span>
              <select
                aria-label="Feedback artifact"
                value={feedbackArtifactType}
                onChange={(event) => onFeedbackArtifactTypeChange(event.target.value as FeedbackArtifactType)}
              >
                {feedbackArtifactOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Signal</span>
              <select
                aria-label="Feedback signal"
                value={feedbackSignal}
                onChange={(event) => onFeedbackSignalChange(event.target.value as FeedbackSignal)}
              >
                {feedbackSignalOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Rating</span>
              <select
                aria-label="Feedback rating"
                value={feedbackRating}
                onChange={(event) => onFeedbackRatingChange(event.target.value)}
              >
                <option value="5">5</option>
                <option value="4">4</option>
                <option value="3">3</option>
                <option value="2">2</option>
                <option value="1">1</option>
              </select>
            </label>
            <label>
              <span>Comment</span>
              <textarea
                aria-label="Feedback comment"
                maxLength={500}
                onChange={(event) => onFeedbackCommentChange(event.target.value)}
                rows={3}
                value={feedbackComment}
              />
            </label>
            <button
              className="uw-secondary"
              disabled={!activeUserId || feedbackSubmitting}
              onClick={onSubmitFeedback}
              type="button"
            >
              {feedbackSubmitting ? 'Sending...' : 'Send feedback'}
            </button>
            <p className="uw-micro">Stored as untrusted eval-candidate feedback. Golden-set fixtures stay unchanged until reviewed.</p>
            {feedbackStatus ? <p className="uw-success-text">{feedbackStatus}</p> : null}
            {feedbackError ? <p className="uw-error-text">{feedbackError}</p> : null}
          </div>
        ) : (
          <p className="uw-muted">Feedback appears after a pack is loaded.</p>
        )}
      </section>
      <section className="uw-panel uw-panel-pad">
        <div className="uw-split">
          <div>
            <h2 className="uw-section-title">Managed Share Links</h2>
            <p className="uw-muted">Owner controls for active viewer links.</p>
          </div>
          <button
            className="uw-secondary"
            disabled={!pack || shareManagementLoading}
            onClick={onRefreshShareLinks}
            type="button"
            aria-label="Refresh managed share links"
          >
            {shareManagementLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        {shareManagementError ? <p className="uw-error-text">{shareManagementError}</p> : null}
        {pack && shareLinks.length > 0 ? (
          <div className="uw-share-list">
            {shareLinks.map((item) => {
              const shareId = item.share.share_id;
              const copied = copiedShareId === shareId;
              return (
                <article className="uw-share-item" key={shareId}>
                  <div>
                    <strong>{shareId}</strong>
                    <span className="uw-micro">{titleCase(item.share.role)} / {new Date(item.share.created_at).toLocaleDateString()}</span>
                  </div>
                  <span className="uw-share-url">{frontendShareUrl(shareId)}</span>
                  <div className="uw-share-actions">
                    <button className="uw-filter" onClick={() => onCopyShareLink(item)} type="button" aria-label={`Copy share link ${shareId}`}>
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button className="uw-filter" onClick={() => onInspectShareLink(shareId)} type="button" aria-label={`Inspect share link ${shareId}`}>
                      Inspect
                    </button>
                    <button
                      className="uw-filter"
                      disabled={shareRevokingId === shareId}
                      onClick={() => onRevokeShareLink(shareId)}
                      type="button"
                      aria-label={`Revoke share link ${shareId}`}
                    >
                      {shareRevokingId === shareId ? 'Revoking...' : 'Revoke'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : pack ? (
          <p className="uw-muted">No active share links yet.</p>
        ) : (
          <p className="uw-muted">Share links appear after a pack is loaded.</p>
        )}
        {inspectedShare ? (
          <div className="uw-share-inspector" aria-label="Selected share details">
            <h3>Selected Share</h3>
            <div className="uw-kv"><span>Role</span><strong>{titleCase(inspectedShare.share.role)}</strong></div>
            <div className="uw-kv"><span>Owner</span><strong>{inspectedShare.share.owner_user_id}</strong></div>
            <div className="uw-kv"><span>Frontend URL</span><strong>{frontendShareUrl(inspectedShare.share.share_id)}</strong></div>
            <div className="uw-kv"><span>API path</span><strong>{inspectedShare.share_path}</strong></div>
          </div>
        ) : null}
      </section>
      <section className="uw-panel uw-panel-pad">
        <div className="uw-split">
          <h2 className="uw-section-title">Capacity</h2>
          <button
            className="uw-filter"
            disabled={queueStatusLoading}
            onClick={onRefreshQueueStatus}
            type="button"
            aria-label="Refresh capacity status"
          >
            {queueStatusLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        {isOffline ? (
          <p className="uw-warning-text">Offline. Showing the last capacity snapshot if one is available.</p>
        ) : null}
        {queueStatusError ? <p className="uw-error-text">{queueStatusError}</p> : null}
        {queueStatus ? (
          <div className="uw-model-list">
            <div className="uw-kv">
              <span>State</span>
              <strong>{formatCapacityState(queueStatus.capacity_state)}</strong>
            </div>
            <div className="uw-kv">
              <span>Queue</span>
              <strong>{queueStatus.queued}/{queueStatus.max_queue_depth}</strong>
            </div>
            <div className="uw-kv">
              <span>Workers</span>
              <strong>{queueStatus.running}/{queueStatus.global_concurrency_limit}</strong>
            </div>
            <div className="uw-kv">
              <span>This session</span>
              <strong>{queueStatus.session_inflight}/{queueStatus.session_concurrency_limit}</strong>
            </div>
          </div>
        ) : queueStatusLoading ? (
          <p className="uw-muted">Loading capacity status...</p>
        ) : (
          <p className="uw-muted">Capacity status appears once the API responds.</p>
        )}
      </section>
      <section className="uw-panel uw-panel-pad" aria-label="Batch generation">
        <div className="uw-split">
          <h2 className="uw-section-title">Batch Generation</h2>
          {batchTopics.length > 0 ? <span className="uw-pill">{batchTopics.length} topics</span> : null}
        </div>
        <div className="uw-batch-form">
          <label>
            <span>Topic list</span>
            <textarea
              aria-label="Topic list"
              disabled={batchSubmitting}
              onChange={(event) => onBatchTopicInputChange(event.target.value)}
              rows={4}
              value={batchTopicInput}
            />
          </label>
          <button
            className="uw-secondary"
            disabled={batchSubmitting || batchTopics.length === 0}
            onClick={onStartBatchGeneration}
            type="button"
          >
            {batchSubmitting ? 'Queueing...' : 'Start batch generation'}
          </button>
        </div>
        {batchError ? <p className="uw-error-text">{batchError}</p> : null}
        {batchResult ? (
          <div className="uw-batch-results" aria-label="Batch generation results">
            <div className="uw-model-list">
              <div className="uw-kv">
                <span>Queued</span>
                <strong>{batchResult.summary.accepted + batchResult.summary.reused}/{batchResult.summary.requested}</strong>
              </div>
              <div className="uw-kv">
                <span>Deferred</span>
                <strong>{batchResult.summary.deferred}</strong>
              </div>
              <div className="uw-kv">
                <span>Capacity</span>
                <strong>{formatCapacityState(batchResult.capacity_after.capacity_state)}</strong>
              </div>
            </div>
            <div className="uw-history-list">
              {batchResult.items.map((item) => (
                <div className="uw-history-item" data-current={item.status === 'accepted' ? 'true' : undefined} key={`${item.index}-${item.title_or_url}`}>
                  <span>{item.title_or_url}</span>
                  <strong>{titleCase(item.status)}</strong>
                  <small>{formatBatchReason(item.reason)}</small>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
      <section className="uw-panel uw-panel-pad" aria-label="Citation stream">
        <div className="uw-split">
          <h2 className="uw-section-title">Citation Stream</h2>
          {citations.length > 0 ? <span className="uw-pill">{filteredCitations.length}/{citations.length}</span> : null}
        </div>
        {citations.length > 0 ? (
          <div className="uw-grid">
            <div className="uw-citation-controls">
              <label className="uw-citation-search">
                <span>Search citations</span>
                <input
                  aria-label="Search citation stream"
                  onChange={(event) => setCitationSearch(event.target.value)}
                  placeholder="Find evidence snippets"
                  value={citationSearch}
                />
              </label>
              <div className="uw-filter-row" aria-label="Citation artifact filters">
                <button
                  className="uw-filter"
                  data-active={citationCategoryFilter === 'all'}
                  onClick={() => setCitationCategoryFilter('all')}
                  type="button"
                >
                  All {citations.length}
                </button>
                {citationCategoryOrder.map((category) => {
                  const count = citationCounts.get(category) ?? 0;
                  return (
                    <button
                      className="uw-filter"
                      data-active={citationCategoryFilter === category}
                      disabled={count === 0}
                      key={category}
                      onClick={() => setCitationCategoryFilter(category)}
                      type="button"
                    >
                      {citationCategoryLabels[category]} {count}
                    </button>
                  );
                })}
              </div>
            </div>
            {groupedCitations.length > 0 ? (
              <div className="uw-citation-groups" aria-label="Grouped citations">
                {groupedCitations.map((group) => (
                  <section className="uw-citation-group" key={group.category} aria-label={`${citationCategoryLabels[group.category]} citations`}>
                    <div className="uw-card-meta">
                      <h3>{citationCategoryLabels[group.category]}</h3>
                      <span className="uw-pill">{group.items.length}</span>
                    </div>
                    <div className="uw-grid">
                      {group.items.map((citation) => (
                        <div className="uw-citation-link" key={`${citation.label}-${citation.value}`}>
                          <span>{citation.label}</span>
                          <strong>{shortCitation(citation.value)}</strong>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <p className="uw-muted">No citations match the current filters.</p>
            )}
          </div>
        ) : (
          <p className="uw-muted">Citations appear after generation completes.</p>
        )}
      </section>
      <section className="uw-panel uw-panel-pad">
        <h2 className="uw-section-title">AI Ops</h2>
        {footprint.length > 0 ? (
          <div className="uw-model-list">
            {footprint.map((item) => (
              <div className="uw-kv" key={`${item.artifact}-${item.version}-${item.model}`}>
                <span>{item.artifact}</span>
                <strong>{item.version} / {item.model}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="uw-muted">Prompt versions, model IDs, and traceable artifacts are retained per output.</p>
        )}
      </section>
      <section className="uw-panel uw-panel-pad">
        <h2 className="uw-section-title">Cache</h2>
        {cacheEvents.length > 0 ? (
          <div className="uw-model-list">
            {cacheEvents.map((event) => (
              <div className="uw-kv" key={`${event.stage}-${event.cache_key}`}>
                <span>{event.stage}</span>
                <strong>{event.hit ? 'hit' : 'miss'} / rev {event.source_revision_id}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="uw-muted">Cache provenance appears after generation completes.</p>
        )}
      </section>
    </aside>
  );
}

function EmptyState({ setTopicInput }: { setTopicInput: (value: string) => void }) {
  return (
    <section className="uw-hero">
      <div>
        <p className="uw-eyebrow">Study intelligence workspace</p>
        <h1>Turn source material into a navigable learning system.</h1>
      </div>
      <div className="uw-empty-grid">
        <p>Start with a Wikipedia title or URL. UltraWiki will create cited summaries, a glossary, concept relationships, flashcards, and quiz checks from the exact source revision.</p>
        <div className="uw-examples" aria-label="Example topics">
          {exampleTopics.map((topic) => (
            <button key={topic} type="button" onClick={() => setTopicInput(topic)}>{topic}</button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Tabs({ activeTab, setActiveTab, disabled }: { activeTab: Tab; setActiveTab: (tab: Tab) => void; disabled: boolean }) {
  const activateTab = (tab: Tab): void => {
    document.getElementById(tabButtonId(tab))?.focus();
    setActiveTab(tab);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, tab: Tab): void => {
    if (disabled) return;
    const currentIndex = tabs.findIndex(([candidate]) => candidate === tab);
    if (currentIndex < 0) return;

    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex === undefined) return;
    event.preventDefault();
    activateTab(tabs[nextIndex][0]);
  };

  return (
    <nav className="uw-tabs" aria-label="Study pack sections" role="tablist">
      {tabs.map(([tab, label]) => (
        <button
          className="uw-tab"
          data-active={tab === activeTab}
          disabled={disabled}
          id={tabButtonId(tab)}
          key={tab}
          onClick={() => setActiveTab(tab)}
          onKeyDown={(event) => handleKeyDown(event, tab)}
          role="tab"
          aria-controls={tabPanelId(tab)}
          aria-selected={tab === activeTab}
          tabIndex={tab === activeTab && !disabled ? 0 : -1}
          type="button"
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

function TopicHeader({ pack }: { pack: StudyPack }) {
  const leadSummary = pack.summaries[0]?.text;

  return (
    <section className="uw-topic-head">
      <div>
        <p className="uw-eyebrow">Study pack</p>
        <h1 className="uw-topic-title">{pack.input}</h1>
        <p className="uw-muted">
          {leadSummary ? `${leadSummary.slice(0, 180)}${leadSummary.length > 180 ? '...' : ''}` : 'Summary artifact is not available yet.'}
        </p>
      </div>
      <div className="uw-metrics">
        <Metric label="Citation rate" value={formatPercent(pack.grounding_stats.citation_rate)} detail="claims anchored to sources" />
        <Metric label="Glossary terms" value={String(pack.glossary.length)} detail="source-grounded definitions" />
        <Metric label="Concept nodes" value={String(pack.graph.nodes.length)} detail="people, events, works, places" />
        <Metric label="Relationships" value={String(pack.graph.edges.length)} detail="structured graph edges" />
        <Metric label="Recall assets" value={String(pack.flashcards.length + pack.quiz_questions.length)} detail="cards plus quiz items" />
      </div>
    </section>
  );
}

function PartialPackBanner({
  pack,
  busy,
  onResume,
  onViewAvailable
}: {
  pack: StudyPack;
  busy: boolean;
  onResume: () => void;
  onViewAvailable: () => void;
}) {
  if (pack.readiness.status !== 'partial') {
    return null;
  }

  return (
    <section className="uw-partial-banner" aria-label="Partial pack actions">
      <div>
        <p className="uw-eyebrow">Partial pack</p>
        <h2>Available artifacts are ready. Missing artifacts can be resumed.</h2>
        <p>
          Missing: {pack.readiness.missing_artifacts.map((artifact) => titleCase(artifact)).join(', ')}
          {pack.readiness.degradation_reason ? ` (${titleCase(pack.readiness.degradation_reason)})` : ''}
        </p>
      </div>
      <div className="uw-partial-actions">
        <button className="uw-generate" disabled={busy || !pack.readiness.can_resume} onClick={onResume} type="button">
          {busy ? 'Resuming...' : 'Resume missing artifacts'}
        </button>
        <button className="uw-secondary" onClick={onViewAvailable} type="button">
          View available outputs
        </button>
      </div>
    </section>
  );
}

function RecommendationsPanel({
  recommendations,
  onStartRecommendation,
  busy
}: {
  recommendations: Recommendation[];
  onStartRecommendation: (title: string) => void;
  busy: boolean;
}) {
  return (
    <section className="uw-panel uw-panel-pad uw-recommendations" aria-label="Learn next recommendations">
      <div className="uw-split">
        <div>
          <h2 className="uw-section-title">Learn Next</h2>
          <p className="uw-muted">Grounded branches from the article link graph and concept entities.</p>
        </div>
        <span className="uw-pill">{recommendations.length} paths</span>
      </div>
      {recommendations.length > 0 ? (
        <div className="uw-recommendation-grid">
          {recommendations.map((recommendation) => (
            <article className="uw-recommendation" key={`${recommendation.title}-${recommendation.source_heading}`}>
              <div>
                <div className="uw-card-meta">
                  <span className="uw-pill" data-tone="green">{formatScore(recommendation.score)}</span>
                  <span className="uw-micro">from {recommendation.source_heading}</span>
                </div>
                <h3>{recommendation.title}</h3>
                <p>{recommendation.rationale}</p>
              </div>
              <div className="uw-recommendation-actions">
                <a href={recommendation.url} target="_blank" rel="noreferrer">Open source</a>
                <button
                  className="uw-secondary"
                  disabled={busy}
                  onClick={() => onStartRecommendation(recommendation.title)}
                  type="button"
                  aria-label={`Study ${recommendation.title} next`}
                >
                  Study this next
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="uw-muted">No adjacent topics were found for this pack yet.</p>
      )}
    </section>
  );
}

function GlossaryPanel({ pack }: { pack: StudyPack }) {
  if (pack.glossary.length === 0) {
    return null;
  }

  return (
    <section className="uw-panel uw-panel-pad uw-glossary" aria-label="Glossary">
      <div className="uw-split">
        <div>
          <h2 className="uw-section-title">Glossary</h2>
          <p className="uw-muted">Source-grounded terms to stabilize the mental model before recall work.</p>
        </div>
        <span className="uw-pill">{pack.glossary.length} terms</span>
      </div>
      <div className="uw-glossary-grid">
        {pack.glossary.map((term) => (
          <article className="uw-glossary-term" key={`${term.term}-${term.citation}`}>
            <div className="uw-card-meta">
              <span className="uw-pill" data-tone="green">{term.term}</span>
              <span className="uw-micro">{term.prompt_version} / {term.model}</span>
            </div>
            <p>{term.definition}</p>
            <span className="uw-citation">{shortCitation(term.citation)}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function OverviewPanel({
  pack,
  onStartRecommendation,
  busy
}: {
  pack: StudyPack;
  onStartRecommendation: (title: string) => void;
  busy: boolean;
}) {
  return (
    <div className="uw-grid">
      <section className="uw-grid" aria-label="Overview summaries">
        {pack.summaries.length > 0 ? (
          pack.summaries.map((summary) => (
            <article className="uw-panel uw-summary" key={summary.level}>
              <div className="uw-card-meta">
                <span className="uw-pill" data-tone={summary.level === 'advanced' ? 'coral' : 'green'}>{summary.level}</span>
                <span className="uw-micro">{summary.prompt_version} / {summary.model}</span>
              </div>
              <h3>{summary.level}</h3>
              <p>{summary.text}</p>
              <div className="uw-citations">
                {summary.citations.slice(0, 4).map((citation) => (
                  <span className="uw-citation" key={`${summary.level}-${citation}`}>{shortCitation(citation)}</span>
                ))}
              </div>
            </article>
          ))
        ) : (
          <article className="uw-panel uw-summary">
            <h3>No summaries available</h3>
            <p>No summaries are available for this pack yet. Resume missing artifacts when the source is ready.</p>
          </article>
        )}
      </section>
      <GlossaryPanel pack={pack} />
      <RecommendationsPanel recommendations={pack.recommendations} onStartRecommendation={onStartRecommendation} busy={busy} />
    </div>
  );
}

function ConceptsPanel({ pack, nodeTypeFilter, setNodeTypeFilter }: {
  pack: StudyPack;
  nodeTypeFilter: 'all' | GraphNode['type'];
  setNodeTypeFilter: (value: 'all' | GraphNode['type']) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedEvidence, setSelectedEvidence] = useState<{
    kind: 'Node' | 'Relationship' | 'Timeline';
    title: string;
    detail: string;
    citation: string;
  } | null>(null);
  const [selectedTimelineIndex, setSelectedTimelineIndex] = useState(0);
  const [graphSearch, setGraphSearch] = useState('');
  const [relationFilter, setRelationFilter] = useState<'all' | GraphEdge['relation']>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(pack.graph.nodes[0]?.id ?? null);
  const graphSearchRef = useRef<HTMLInputElement>(null);
  const nodeById = useMemo(() => new Map(pack.graph.nodes.map((node) => [node.id, node])), [pack.graph.nodes]);
  const nodeLabel = useCallback((id: string): string => nodeById.get(id)?.label ?? id, [nodeById]);
  const relationFilters = useMemo(
    () => ['all', ...Array.from(new Set(pack.graph.edges.map((edge) => edge.relation))).sort()] as Array<'all' | GraphEdge['relation']>,
    [pack.graph.edges]
  );
  const normalizedGraphSearch = graphSearch.trim().toLowerCase();
  const filteredEdges = useMemo(() => {
    return pack.graph.edges.filter((edge) => {
      if (relationFilter !== 'all' && edge.relation !== relationFilter) return false;
      if (!normalizedGraphSearch) return true;
      return [edge.relation, edge.citation, nodeLabel(edge.source), nodeLabel(edge.target)]
        .join(' ')
        .toLowerCase()
        .includes(normalizedGraphSearch);
    });
  }, [nodeLabel, normalizedGraphSearch, pack.graph.edges, relationFilter]);
  const nodes = useMemo(() => {
    const edgeMatchedNodeIds = new Set(filteredEdges.flatMap((edge) => [edge.source, edge.target]));
    return pack.graph.nodes.filter((node) => {
      if (nodeTypeFilter !== 'all' && node.type !== nodeTypeFilter) return false;
      if (!normalizedGraphSearch) return true;
      const nodeMatches = `${node.label} ${node.type} ${node.citation}`.toLowerCase().includes(normalizedGraphSearch);
      return nodeMatches || edgeMatchedNodeIds.has(node.id);
    });
  }, [filteredEdges, nodeTypeFilter, normalizedGraphSearch, pack.graph.nodes]);
  const visibleNodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const selectedNode = selectedNodeId && visibleNodeIds.has(selectedNodeId)
    ? nodeById.get(selectedNodeId) ?? null
    : nodes[0] ?? null;
  const selectedNodeConnections = selectedNode
    ? pack.graph.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
    : [];
  const timelineEvents = useMemo(
    () => [...pack.timeline].sort((a, b) => a.year - b.year || a.date_label.localeCompare(b.date_label)),
    [pack.timeline]
  );
  const timelineClusters = useMemo(() => {
    const byYear = timelineEvents.reduce((acc, event, index) => {
      const current = acc.get(event.year) ?? { year: event.year, count: 0, firstIndex: index };
      current.count += 1;
      acc.set(event.year, current);
      return acc;
    }, new Map<number, { year: number; count: number; firstIndex: number }>());
    return Array.from(byYear.values());
  }, [timelineEvents]);
  const selectedTimelineEvent = timelineEvents[Math.min(selectedTimelineIndex, Math.max(timelineEvents.length - 1, 0))] ?? null;
  const timelineMinYear = timelineEvents[0]?.year ?? 0;
  const timelineMaxYear = timelineEvents[timelineEvents.length - 1]?.year ?? timelineMinYear;
  const positionedNodes = useMemo(() => {
    const visible = nodes.slice(0, 42);
    return visible.map((node, idx) => {
      const angle = (idx / Math.max(visible.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const ring = idx % 3;
      const radiusX = 20 + ring * 9;
      const radiusY = 18 + ring * 8;
      return {
        node,
        x: 50 + Math.cos(angle) * radiusX,
        y: 50 + Math.sin(angle) * radiusY
      };
    });
  }, [nodes]);
  const positionById = useMemo(
    () => new Map(positionedNodes.map((entry) => [entry.node.id, entry])),
    [positionedNodes]
  );
  const visibleEdges = filteredEdges
    .map((edge, idx) => ({
      edge,
      idx,
      sourcePosition: positionById.get(edge.source),
      targetPosition: positionById.get(edge.target)
    }))
    .filter((entry) => entry.sourcePosition && entry.targetPosition)
    .slice(0, 24);
  const graphHasActiveFilters = Boolean(normalizedGraphSearch) || nodeTypeFilter !== 'all' || relationFilter !== 'all';
  const graphEmptyMessage = graphHasActiveFilters
    ? 'No concept nodes match the current graph filters.'
    : 'No concept nodes were extracted for this pack yet.';
  const relationshipEmptyMessage = graphHasActiveFilters
    ? 'No relationships match the current graph filters.'
    : 'No relationships were extracted for this pack yet.';
  const evidence = selectedEvidence ?? (nodes[0]
    ? {
        kind: 'Node' as const,
        title: nodes[0].label,
        detail: `A ${nodes[0].type} entity extracted from the source text.`,
        citation: nodes[0].citation
      }
    : null);

  const zoomIn = useCallback(() => {
    setZoom((value) => Math.min(1.75, Number((value + 0.25).toFixed(2))));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((value) => Math.max(0.75, Number((value - 0.25).toFixed(2))));
  }, []);

  const panLeft = useCallback(() => {
    setPan((value) => ({ ...value, x: value.x - 24 }));
  }, []);

  const panRight = useCallback(() => {
    setPan((value) => ({ ...value, x: value.x + 24 }));
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setGraphSearch('');
    setRelationFilter('all');
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isShortcutEditableTarget(event.target) || !isControlAltShortcut(event)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'f') {
        event.preventDefault();
        graphSearchRef.current?.focus();
        graphSearchRef.current?.select();
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomIn();
      } else if (event.key === '-') {
        event.preventDefault();
        zoomOut();
      } else if (event.key === '[') {
        event.preventDefault();
        panLeft();
      } else if (event.key === ']') {
        event.preventDefault();
        panRight();
      } else if (event.key === '0') {
        event.preventDefault();
        resetView();
      }
    };

    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [panLeft, panRight, resetView, zoomIn, zoomOut]);

  const inspectTimelineEvent = (event: TimelineEvent, index: number) => {
    setSelectedTimelineIndex(index);
    setSelectedEvidence({
      kind: 'Timeline',
      title: event.date_label,
      detail: event.description,
      citation: event.citation
    });
  };

  const selectTimelineYear = (year: number) => {
    if (timelineEvents.length === 0) {
      return;
    }
    const closestIndex = timelineEvents.reduce((closest, event, index) => {
      const closestDelta = Math.abs(timelineEvents[closest].year - year);
      const nextDelta = Math.abs(event.year - year);
      return nextDelta < closestDelta ? index : closest;
    }, 0);
    const event = timelineEvents[closestIndex];
    if (event) {
      inspectTimelineEvent(event, closestIndex);
    }
  };

  return (
    <section className="uw-grid" aria-label="Concept map">
      <div className="uw-panel uw-panel-pad">
        <div className="uw-split">
          <div>
            <h2 className="uw-section-title">Concept Graph</h2>
            <p className="uw-muted">{nodes.length} visible nodes, {filteredEdges.length} relationships.</p>
          </div>
          <div className="uw-graph-filters">
            <label className="uw-graph-search">
              <span>Graph search</span>
              <input
                aria-label="Search graph nodes and relationships"
                ref={graphSearchRef}
                value={graphSearch}
                onChange={(event) => setGraphSearch(event.target.value)}
                placeholder="Find entities, relations, evidence"
              />
            </label>
            <div className="uw-filter-row" aria-label="Node type filters">
              {nodeFilters.map((value) => (
                <button className="uw-filter" data-active={value === nodeTypeFilter} key={value} onClick={() => setNodeTypeFilter(value)} type="button">
                  {value}
                </button>
              ))}
            </div>
            <div className="uw-filter-row" aria-label="Relationship filters">
              {relationFilters.map((value) => (
                <button className="uw-filter" data-active={value === relationFilter} key={value} onClick={() => setRelationFilter(value)} type="button">
                  {value === 'all' ? 'all relations' : titleCase(value)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="uw-concepts-layout">
        <article className="uw-panel uw-graph-shell">
          <div className="uw-graph-toolbar" aria-label="Graph controls">
            <button className="uw-filter" onClick={zoomIn} type="button">
              Zoom in
            </button>
            <button className="uw-filter" onClick={zoomOut} type="button">
              Zoom out
            </button>
            <button className="uw-filter" onClick={panLeft} type="button">
              Pan left
            </button>
            <button className="uw-filter" onClick={panRight} type="button">
              Pan right
            </button>
            <button className="uw-filter" onClick={resetView} type="button">
              Reset view
            </button>
            <span className="uw-pill" aria-live="polite">Zoom {Math.round(zoom * 100)}%</span>
          </div>
          <div className="uw-graph-canvas" aria-label="Interactive concept graph">
            <div className="uw-graph-stage" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              <svg className="uw-graph-lines" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
                {visibleEdges.map(({ edge, idx, sourcePosition, targetPosition }) => (
                  <line
                    key={`${edge.source}-${edge.target}-${idx}`}
                    x1={sourcePosition!.x}
                    y1={sourcePosition!.y}
                    x2={targetPosition!.x}
                    y2={targetPosition!.y}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
              {positionedNodes.map(({ node, x, y }) => (
                <button
                  className="uw-node"
                  data-type={node.type}
                  key={node.id}
                  onClick={() => {
                    setSelectedNodeId(node.id);
                    setSelectedEvidence({
                      kind: 'Node',
                      title: node.label,
                      detail: `A ${node.type} entity extracted from the source text.`,
                      citation: node.citation
                    });
                  }}
                  style={{ left: `${x}%`, top: `${y}%` }}
                  type="button"
                >
                  {node.label} <span className="uw-node-meta">{node.type}</span>
                </button>
              ))}
            </div>
            {positionedNodes.length === 0 ? (
              <div className="uw-graph-empty">
                <p>{graphEmptyMessage}</p>
              </div>
            ) : null}
          </div>
          <div className="uw-evidence-panel" aria-label="Selected evidence">
            <h2 className="uw-section-title">Evidence</h2>
            {evidence ? (
              <div className="uw-grid">
                <span className="uw-pill">{evidence.kind}</span>
                <strong>{evidence.title}</strong>
                <p className="uw-muted">{evidence.detail}</p>
                <span className="uw-citation">{shortCitation(evidence.citation)}</span>
              </div>
            ) : (
              <p className="uw-muted">Select a node, relationship, or timeline event to inspect source evidence.</p>
            )}
          </div>
          <div className="uw-evidence-panel" aria-label="Path inspector">
            <h2 className="uw-section-title">Path Inspector</h2>
            {selectedNode ? (
              <div className="uw-grid">
                <div className="uw-card-meta">
                  <span className="uw-pill">{selectedNode.type}</span>
                  <strong>{selectedNode.label}</strong>
                </div>
                {selectedNodeConnections.length > 0 ? (
                  selectedNodeConnections.slice(0, 6).map((edge, idx) => {
                    const neighborId = edge.source === selectedNode.id ? edge.target : edge.source;
                    return (
                      <button
                        className="uw-edge"
                        key={`${selectedNode.id}-${neighborId}-${idx}`}
                        onClick={() => {
                          setSelectedNodeId(neighborId);
                          setSelectedEvidence({
                            kind: 'Relationship',
                            title: `${nodeLabel(edge.source)} -> ${nodeLabel(edge.target)}`,
                            detail: `${nodeLabel(edge.source)} ${titleCase(edge.relation).toLowerCase()} ${nodeLabel(edge.target)}.`,
                            citation: edge.citation
                          });
                        }}
                        type="button"
                      >
                        <span className="uw-muted">{titleCase(edge.relation)} connection</span>
                        <strong>{nodeLabel(neighborId)}</strong>
                      </button>
                    );
                  })
                ) : (
                  <p className="uw-muted">No direct connections are available for this node.</p>
                )}
              </div>
            ) : (
              <p className="uw-muted">Select a node to inspect adjacent paths.</p>
            )}
          </div>
        </article>
        <div className="uw-grid">
          <section className="uw-panel uw-panel-pad">
            <h2 className="uw-section-title">Relationships</h2>
            {filteredEdges.length > 0 ? (
              <div className="uw-grid">
                {filteredEdges.slice(0, 16).map((edge, idx) => (
                <button
                  className="uw-edge"
                  key={`${edge.source}-${edge.target}-${idx}`}
                  aria-label={`Inspect relationship ${nodeLabel(edge.source)} ${titleCase(edge.relation)} ${nodeLabel(edge.target)}`}
                  onClick={() => {
                    setSelectedNodeId(edge.source);
                    setSelectedEvidence({
                      kind: 'Relationship',
                      title: `${nodeLabel(edge.source)} -> ${nodeLabel(edge.target)}`,
                      detail: `${nodeLabel(edge.source)} ${titleCase(edge.relation).toLowerCase()} ${nodeLabel(edge.target)}.`,
                      citation: edge.citation
                    });
                  }}
                  type="button"
                >
                  <strong>{nodeLabel(edge.source)}</strong>
                  <span className="uw-muted">{titleCase(edge.relation)}{' -> '}{nodeLabel(edge.target)}</span>
                  <span className="uw-micro">{shortCitation(edge.citation)}</span>
                </button>
                ))}
              </div>
            ) : (
              <p className="uw-muted">{relationshipEmptyMessage}</p>
            )}
          </section>
          <section className="uw-panel uw-panel-pad">
            <div className="uw-split">
              <div>
                <h2 className="uw-section-title">Timeline Navigator</h2>
                <p className="uw-muted">Scrub chronology, inspect clustered years, and keep each event tied to source evidence.</p>
              </div>
              <span className="uw-pill">{timelineEvents.length} events</span>
            </div>
            {timelineEvents.length > 0 ? (
              <div className="uw-timeline-navigator">
                <div className="uw-timeline-range">
                  <div className="uw-split">
                    <span className="uw-micro">{timelineMinYear}</span>
                    <strong>{selectedTimelineEvent?.date_label}</strong>
                    <span className="uw-micro">{timelineMaxYear}</span>
                  </div>
                  <input
                    aria-label="Timeline year scrubber"
                    disabled={timelineMinYear === timelineMaxYear}
                    max={timelineMaxYear}
                    min={timelineMinYear}
                    onChange={(event) => selectTimelineYear(Number(event.target.value))}
                    type="range"
                    value={selectedTimelineEvent?.year ?? timelineMinYear}
                  />
                </div>
                <div className="uw-timeline-clusters" aria-label="Timeline year clusters">
                  {timelineClusters.map((cluster) => (
                    <button
                      className="uw-timeline-cluster"
                      data-active={timelineEvents[selectedTimelineIndex]?.year === cluster.year}
                      key={cluster.year}
                      onClick={() => selectTimelineYear(cluster.year)}
                      type="button"
                    >
                      <strong>{cluster.year}</strong>
                      <span>{cluster.count} event{cluster.count === 1 ? '' : 's'}</span>
                    </button>
                  ))}
                </div>
                {selectedTimelineEvent ? (
                  <article className="uw-timeline-detail" aria-label="Selected timeline event">
                    <div className="uw-card-meta">
                      <span className="uw-pill" data-tone="green">Selected</span>
                      <span className="uw-micro">{selectedTimelineEvent.source_provenance?.source_revision_id ?? pack.source_revision_id}</span>
                    </div>
                    <h3>{selectedTimelineEvent.date_label}</h3>
                    <p>{selectedTimelineEvent.description}</p>
                    <div className="uw-recommendation-actions">
                      <span className="uw-citation">{shortCitation(selectedTimelineEvent.citation)}</span>
                      {selectedTimelineEvent.source_provenance?.revision_url ? (
                        <a href={selectedTimelineEvent.source_provenance.revision_url} target="_blank" rel="noreferrer">
                          Open revision
                        </a>
                      ) : null}
                    </div>
                  </article>
                ) : null}
                <div className="uw-grid">
                  {timelineEvents.slice(0, 14).map((event, idx) => (
                    <button
                      className="uw-timeline-item"
                      data-active={idx === selectedTimelineIndex}
                      key={`${event.year}-${idx}`}
                      aria-label={`Inspect timeline event ${event.date_label}`}
                      onClick={() => inspectTimelineEvent(event, idx)}
                      type="button"
                    >
                      <strong>{event.date_label}</strong>
                      <p>{event.description}</p>
                      <span className="uw-micro">{shortCitation(event.citation)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="uw-muted">No timeline events were extracted for this pack yet.</p>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}

function ReviewButtons({
  cardIndex,
  disabled,
  onReview
}: {
  cardIndex: number;
  disabled: boolean;
  onReview: (cardIndex: number, rating: FlashcardReviewRating) => void;
}) {
  return (
    <div className="uw-review-actions" aria-label={`Review card ${cardIndex + 1}`}>
      {flashcardReviewRatings.map((rating) => (
        <button
          className="uw-filter"
          disabled={disabled}
          key={rating}
          onClick={() => onReview(cardIndex, rating)}
          type="button"
          aria-label={`Mark card ${cardIndex + 1} ${rating}`}
        >
          {titleCase(rating)}
        </button>
      ))}
    </div>
  );
}

function FlashcardsPanel({
  pack,
  progress,
  session,
  sessionActive,
  sessionLoading,
  sessionError,
  reviewingCardIndex,
  onStartSession,
  onExitSession,
  onReviewCard
}: {
  pack: StudyPack;
  progress: LearningProgress | null;
  session: LearningSession | null;
  sessionActive: boolean;
  sessionLoading: boolean;
  sessionError: string | null;
  reviewingCardIndex: number | null;
  onStartSession: () => void;
  onExitSession: () => void;
  onReviewCard: (cardIndex: number, rating: FlashcardReviewRating) => void;
}) {
  const [feature, ...rest] = pack.flashcards;

  if (!feature) {
    return <p className="uw-panel uw-panel-pad uw-muted">No flashcards were generated for this source.</p>;
  }
  const featureProgress = progress?.cards.find((card) => card.card_index === 0);
  const currentSessionCard = session?.queue[0];

  return (
    <section className="uw-grid" aria-label="Flashcards">
      <div className="uw-progress-summary">
        <Metric
          label="Reviewed"
          value={`${progress?.reviewed_cards ?? 0}/${progress?.total_cards ?? pack.flashcards.length}`}
          detail="cards with at least one saved review"
        />
        <Metric
          label="Due now"
          value={String(progress?.due_cards ?? pack.flashcards.length)}
          detail="new or scheduled cards to revisit"
        />
        <Metric
          label="Mastery"
          value={formatPercent(progress?.mastery_score ?? 0)}
          detail="weighted by latest spaced-repetition rating"
        />
      </div>
      <section className="uw-panel uw-panel-pad" aria-label="Learning session">
        <div className="uw-split">
          <div>
            <h2 className="uw-section-title">Learning Session</h2>
            <p className="uw-muted">Due cards: {progress?.due_cards ?? pack.flashcards.length}</p>
          </div>
          {sessionActive ? (
            <button className="uw-secondary" onClick={onExitSession} type="button">
              Exit session
            </button>
          ) : (
            <button className="uw-primary" disabled={sessionLoading || (progress?.due_cards ?? pack.flashcards.length) === 0} onClick={onStartSession} type="button">
              {sessionLoading ? 'Starting...' : 'Start due-card session'}
            </button>
          )}
        </div>
        {sessionError ? <p className="uw-error-text">{sessionError}</p> : null}
        {sessionActive ? (
          sessionLoading && !session ? (
            <p className="uw-muted">Loading session...</p>
          ) : session ? (
            <div className="uw-grid">
              <div className="uw-progress-summary">
                <Metric
                  label="Session"
                  value={`${session.metrics.completed_cards}/${session.metrics.session_total}`}
                  detail="completed due cards"
                />
                <Metric
                  label="Remaining"
                  value={String(session.metrics.remaining_cards)}
                  detail="cards left in queue"
                />
                <Metric
                  label="Mastery trend"
                  value={formatSignedPercent(session.metrics.mastery_delta)}
                  detail={`${formatPercent(session.metrics.mastery_score)} current mastery`}
                />
              </div>
              {session.status === 'complete' ? (
                <article className="uw-panel uw-panel-pad">
                  <p className="uw-eyebrow">Session complete</p>
                  <h3>No due cards remain.</h3>
                </article>
              ) : currentSessionCard ? (
                <article className="uw-panel uw-card-feature" aria-label="Learning session card">
                  <div>
                    <p className="uw-eyebrow">Card {currentSessionCard.position} of {session.metrics.session_total}</p>
                    <h3>{currentSessionCard.question}</h3>
                  </div>
                  <div>
                    <p className="uw-card-answer">{currentSessionCard.answer}</p>
                    <span className="uw-citation">{shortCitation(currentSessionCard.citation)}</span>
                    <p className="uw-micro">
                      {currentSessionCard.reviewed
                        ? `Last reviewed: ${titleCase(currentSessionCard.last_rating ?? 'good')}`
                        : 'New card'}
                    </p>
                    <ReviewButtons
                      cardIndex={currentSessionCard.card_index}
                      disabled={reviewingCardIndex === currentSessionCard.card_index}
                      onReview={onReviewCard}
                    />
                  </div>
                </article>
              ) : null}
              {session.queue.length > 1 ? (
                <div className="uw-card-stack" aria-label="Learning session queue">
                  {session.queue.slice(1).map((card) => (
                    <article className="uw-card" key={card.card_index}>
                      <div className="uw-card-meta">
                        <span className="uw-pill">Card {card.position}</span>
                        <span className="uw-micro">{card.prompt_version} / {card.model}</span>
                      </div>
                      <h3>{card.question}</h3>
                      <span className="uw-micro">{shortCitation(card.citation)}</span>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null
        ) : null}
      </section>
      {!sessionActive ? (
        <div className="uw-deck">
          <article className="uw-panel uw-card-feature">
            <div>
              <p className="uw-eyebrow">Featured card</p>
              <h3>{feature.question}</h3>
            </div>
            <div>
              <p className="uw-card-answer">{feature.answer}</p>
              <span className="uw-citation">{shortCitation(feature.citation)}</span>
              <p className="uw-micro">
                {featureProgress?.reviewed ? `Last reviewed: ${titleCase(featureProgress.last_rating ?? 'good')}` : 'New card'}
              </p>
              <ReviewButtons cardIndex={0} disabled={reviewingCardIndex === 0} onReview={onReviewCard} />
            </div>
          </article>
          <div className="uw-card-stack">
            {rest.map((card, idx) => (
              <article className="uw-card" key={`${card.question}-${idx}`}>
                <div className="uw-card-meta">
                  <span className="uw-pill">Card {idx + 2}</span>
                  <span className="uw-micro">{card.prompt_version} / {card.model}</span>
                </div>
                <h3>{card.question}</h3>
                <p className="uw-muted">{card.answer}</p>
                <span className="uw-micro">{shortCitation(card.citation)}</span>
                <p className="uw-micro">
                  {progress?.cards.find((item) => item.card_index === idx + 1)?.reviewed
                    ? `Last reviewed: ${titleCase(progress.cards.find((item) => item.card_index === idx + 1)?.last_rating ?? 'good')}`
                    : 'New card'}
                </p>
                <ReviewButtons cardIndex={idx + 1} disabled={reviewingCardIndex === idx + 1} onReview={onReviewCard} />
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function QuizPanel({
  pack,
  selectedAnswers,
  setSelectedAnswers,
  showQuizResult,
  gradeQuiz,
  quizScore,
  quizSubmitting,
  quizError,
  quizAttemptResult,
  quizAttemptHistory,
  onRetake
}: {
  pack: StudyPack;
  selectedAnswers: Record<number, number>;
  setSelectedAnswers: (next: Record<number, number> | ((prev: Record<number, number>) => Record<number, number>)) => void;
  showQuizResult: boolean;
  quizScore: { correct: number; total: number } | null;
  gradeQuiz: () => void;
  quizSubmitting: boolean;
  quizError: string | null;
  quizAttemptResult: QuizAttemptResult | null;
  quizAttemptHistory: QuizAttemptResult[];
  onRetake: () => void;
}) {
  if (pack.quiz_questions.length === 0) {
    return <p className="uw-panel uw-panel-pad uw-muted">No quiz questions are available yet. Resume missing artifacts to generate the quiz.</p>;
  }

  return (
    <section className="uw-grid" aria-label="Quiz">
      {pack.quiz_questions.map((question, qIdx) => (
        <article className="uw-question" key={`${question.question}-${qIdx}`}>
          <div className="uw-card-meta">
            <span className="uw-pill">Question {qIdx + 1}</span>
            <span className="uw-micro">{question.prompt_version} / {question.model}</span>
          </div>
          <h3>{question.question}</h3>
          <div className="uw-grid">
            {question.options.map((option, oIdx) => {
              const checked = selectedAnswers[qIdx] === oIdx;
              return (
                <label className="uw-option" data-checked={checked} key={`${qIdx}-${oIdx}`}>
                  <input
                    type="radio"
                    name={`quiz-${qIdx}`}
                    checked={checked}
                    onChange={() => setSelectedAnswers((prev) => ({ ...prev, [qIdx]: oIdx }))}
                  />
                  <span>{option}</span>
                </label>
              );
            })}
          </div>
          {showQuizResult ? (
            <div className="uw-feedback">
              <p className="uw-muted">
                <strong>{selectedAnswers[qIdx] === question.correct_index ? 'Correct.' : 'Incorrect.'}</strong> {question.explanation}
              </p>
              {(question.misconceptions ?? []).length > 0 ? (
                <div className="uw-misconceptions">
                  <span className="uw-micro">Misconception checks</span>
                  {(question.misconceptions ?? []).map((misconception, idx) => (
                    <p key={`${qIdx}-misconception-${idx}`}>
                      <strong>{String.fromCharCode(65 + idx)}.</strong> {misconception}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <span className="uw-micro">{shortCitation(question.citation)}</span>
        </article>
      ))}
      <div className="uw-grade">
        <button className="uw-generate" disabled={quizSubmitting} onClick={gradeQuiz} type="button">
          {quizSubmitting ? 'Saving...' : quizAttemptResult ? 'Save Retake' : 'Grade Quiz'}
        </button>
        {quizAttemptResult ? (
          <button className="uw-secondary" onClick={onRetake} type="button">
            Retake Quiz
          </button>
        ) : null}
        <div className="uw-grade-result">
          {quizScore ? <strong>Score: {quizScore.correct}/{quizScore.total}</strong> : <span className="uw-muted">Select answers, then save the attempt.</span>}
          {quizAttemptResult ? (
            <>
              <span className="uw-micro">Saved attempt {quizAttemptResult.attempt_number}</span>
              <span className="uw-micro">Accuracy trend {formatSignedPercent(quizAttemptResult.accuracy_delta)}</span>
              <span className="uw-micro">Mastery trend {formatSignedPercent(quizAttemptResult.mastery_delta)}</span>
            </>
          ) : null}
          {quizError ? <span className="uw-error-text">{quizError}</span> : null}
        </div>
      </div>
      {quizAttemptHistory.length > 0 ? (
        <section className="uw-panel uw-panel-pad" aria-label="Quiz attempt history">
          <h3 className="uw-section-title">Retake Trend</h3>
          <div className="uw-trend-list">
            {quizAttemptHistory.map((attempt) => (
              <div className="uw-trend-row" key={attempt.attempt_id}>
                <strong>Attempt {attempt.attempt_number}</strong>
                <span>{formatPercent(attempt.accuracy)} accuracy</span>
                <span>{formatPercent(attempt.mastery_score)} mastery</span>
                <span>{formatSignedPercent(attempt.mastery_delta)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}

function LearningBarChart({
  title,
  points
}: {
  title: string;
  points: Array<{ id: string; label: string; value: number; detail: string }>;
}) {
  return (
    <div className="uw-learning-chart" aria-label={title}>
      <h4>{title}</h4>
      {points.length === 0 ? (
        <p className="uw-muted">No trend points yet.</p>
      ) : (
        <div className="uw-learning-bars">
          {points.map((point) => (
            <div className="uw-learning-bar" key={point.id}>
              <span style={{ height: percentHeight(point.value) }} title={`${point.label}: ${formatPercent(point.value)}`} />
              <small>{point.label}</small>
              <em>{point.detail}</em>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LearningDashboardPanel({
  analytics,
  reminder,
  loading,
  error,
  goalDraft,
  goalSaving,
  goalError,
  onGoalDraftChange,
  onSaveGoal,
  onRefresh
}: {
  analytics: LearningAnalytics | null;
  reminder: LearningReminder | null;
  loading: boolean;
  error: string | null;
  goalDraft: string;
  goalSaving: boolean;
  goalError: string | null;
  onGoalDraftChange: (value: string) => void;
  onSaveGoal: () => void;
  onRefresh: () => void;
}) {
  if (loading && !analytics) {
    return <p className="uw-panel uw-panel-pad uw-muted">Loading learning dashboard...</p>;
  }

  if (error) {
    return (
      <section className="uw-panel uw-panel-pad">
        <h2 className="uw-section-title">Learning Dashboard</h2>
        <p className="uw-error-text">{error}</p>
        <button className="uw-secondary" onClick={onRefresh} type="button">Retry learning refresh</button>
      </section>
    );
  }

  if (!analytics) {
    return (
      <section className="uw-panel uw-panel-pad">
        <h2 className="uw-section-title">Learning Dashboard</h2>
        <p className="uw-muted">Save a pack to start tracking learning analytics.</p>
        <button className="uw-secondary" onClick={onRefresh} type="button">Load learning dashboard</button>
      </section>
    );
  }

  const latestPacks = [...analytics.packs]
    .sort((left, right) => {
      const leftTime = Date.parse(left.last_reviewed_at ?? left.next_due_at ?? '');
      const rightTime = Date.parse(right.last_reviewed_at ?? right.next_due_at ?? '');
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
    })
    .slice(0, 6);
  const weakAreas = [...analytics.packs]
    .filter((pack) => pack.due_cards > 0 || pack.retention_rate < 0.7 || pack.mastery_score < 0.6)
    .sort((left, right) => right.due_cards - left.due_cards || left.mastery_score - right.mastery_score)
    .slice(0, 5);
  const accuracyPoints = analytics.accuracy.trend.slice(-8).map((point) => ({
    id: `${point.pack_id}-${point.attempt_number}-${point.submitted_at}`,
    label: `Attempt ${point.attempt_number}`,
    value: point.accuracy,
    detail: `${formatSignedPercent(point.accuracy_delta)} / ${formatPercent(point.mastery_score)} mastery`
  }));
  const masteryPoints = analytics.mastery.trend.slice(-8).map((point, index) => ({
    id: `${point.source}-${point.pack_id}-${point.recorded_at}-${index}`,
    label: titleCase(point.source),
    value: point.mastery_score,
    detail: `${formatSignedPercent(point.mastery_delta)} on ${formatDateLabel(point.recorded_at)}`
  }));
  const reminderIntervalMinutes = reminder ? Math.max(1, Math.round(reminder.poll_after_seconds / 60)) : 0;

  return (
    <section className="uw-grid" aria-label="Learning dashboard">
      <div className="uw-panel uw-panel-pad">
        <div className="uw-split">
          <div>
            <h2 className="uw-section-title">Learning Dashboard</h2>
            <p className="uw-muted">Updated {formatDateLabel(analytics.generated_at)}</p>
          </div>
          <button className="uw-secondary" disabled={loading} onClick={onRefresh} type="button">
            {loading ? 'Refreshing...' : 'Refresh learning'}
          </button>
        </div>
      </div>
      <div className="uw-progress-summary uw-learning-summary">
        <Metric label="Due cards" value={String(analytics.due_cards)} detail={`${analytics.due_packs} packs due`} />
        <Metric label="Streak" value={`${analytics.streak.current_days}d`} detail={`${analytics.streak.longest_days}d longest`} />
        <Metric
          label="Daily goal"
          value={analytics.goal.daily_target_reviews > 0 ? `${analytics.goal.reviews_today}/${analytics.goal.daily_target_reviews}` : 'Off'}
          detail={analytics.goal.target_met ? 'target met today' : `${analytics.goal.remaining_today} remaining today`}
        />
        <Metric label="Retention" value={formatPercent(analytics.retention.retention_rate)} detail={`${analytics.retention.retained_cards}/${analytics.retention.reviewed_cards} retained`} />
        <Metric label="Mastery" value={formatPercent(analytics.mastery.average_score)} detail={`${formatSignedPercent(analytics.mastery.average_delta)} recent trend`} />
        <Metric label="Accuracy" value={formatPercent(analytics.accuracy.latest_accuracy ?? analytics.accuracy.average_accuracy)} detail={`${analytics.accuracy.attempts} attempts`} />
        <Metric label="Retakes" value={String(analytics.accuracy.retakes)} detail={`${formatSignedPercent(analytics.accuracy.accuracy_delta)} latest accuracy`} />
      </div>
      <section className="uw-panel uw-panel-pad" aria-label="Study goal">
        <div className="uw-split">
          <div>
            <h3 className="uw-section-title">Study Goal</h3>
            <p className="uw-muted">
              {analytics.goal.daily_target_reviews > 0
                ? `${analytics.goal.reviews_today} of ${analytics.goal.daily_target_reviews} reviews today.`
                : 'No daily review target set.'}
            </p>
          </div>
          <div className="uw-goal-form">
            <label>
              <span>Daily review target</span>
              <input
                aria-label="Daily review target"
                min={0}
                max={200}
                onChange={(event) => onGoalDraftChange(event.target.value)}
                type="number"
                value={goalDraft}
              />
            </label>
            <button className="uw-secondary" disabled={goalSaving} onClick={onSaveGoal} type="button">
              {goalSaving ? 'Saving...' : 'Save goal'}
            </button>
          </div>
        </div>
        {goalError ? <p className="uw-error-text">{goalError}</p> : null}
      </section>
      <section className="uw-panel uw-panel-pad" aria-label="Due reminder">
        <h3 className="uw-section-title">Due Reminder</h3>
        {reminder ? (
          <div className="uw-learning-weak-list">
            <div className="uw-kv">
              <span>Ready</span>
              <strong>{reminder.due_cards} cards / {reminder.due_packs} packs</strong>
            </div>
            <div className="uw-kv">
              <span>Next due</span>
              <strong>{formatDateLabel(reminder.next_due_at)}</strong>
            </div>
            <div className="uw-kv">
              <span>Check interval</span>
              <strong>{reminderIntervalMinutes} min</strong>
            </div>
            <div className="uw-kv">
              <span>External notifications</span>
              <strong>{reminder.external_notifications ? 'On' : 'Off'}</strong>
            </div>
          </div>
        ) : (
          <p className="uw-muted">No reminder status loaded.</p>
        )}
      </section>
      <section className="uw-panel uw-panel-pad" aria-label="Learning trend chart">
        <h3 className="uw-section-title">Trend Chart</h3>
        <div className="uw-learning-chart-grid">
          <LearningBarChart title="Accuracy Trend" points={accuracyPoints} />
          <LearningBarChart title="Mastery Trend" points={masteryPoints} />
        </div>
      </section>
      <section className="uw-panel uw-panel-pad" aria-label="Review history">
        <h3 className="uw-section-title">Review History</h3>
        {latestPacks.length === 0 ? (
          <p className="uw-muted">No saved packs have review history yet.</p>
        ) : (
          <div className="uw-trend-list">
            {latestPacks.map((pack) => (
              <div className="uw-trend-row uw-learning-row" key={pack.pack_id}>
                <strong>{pack.pack_id}</strong>
                <span>{pack.reviewed_cards}/{pack.total_cards} reviewed</span>
                <span>{pack.due_cards} due</span>
                <span>{formatDateLabel(pack.last_reviewed_at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="uw-panel uw-panel-pad" aria-label="Weak areas">
        <h3 className="uw-section-title">Weak Areas</h3>
        {weakAreas.length === 0 ? (
          <p className="uw-muted">No weak areas detected.</p>
        ) : (
          <div className="uw-learning-weak-list">
            {weakAreas.map((pack) => (
              <div className="uw-kv" key={pack.pack_id}>
                <span>{pack.pack_id}</span>
                <strong>{pack.due_cards} due / {formatPercent(pack.mastery_score)} mastery</strong>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function OpsPanel({
  snapshots,
  loading,
  error,
  windowHours,
  drilldownFilters,
  drilldownDraft,
  onWindowChange,
  onDrilldownDraftChange,
  onDrilldownApply,
  onDrilldownReset,
  onRefresh,
  cacheInvalidating,
  cacheInvalidationResult,
  cacheInvalidationError,
  onRepairExpiredCache
}: {
  snapshots: OpsSnapshots | null;
  loading: boolean;
  error: string | null;
  windowHours: number;
  drilldownFilters: OpsDrilldownFilters;
  drilldownDraft: OpsDrilldownFilters;
  onWindowChange: (hours: number) => void;
  onDrilldownDraftChange: (filters: OpsDrilldownFilters) => void;
  onDrilldownApply: (event: FormEvent<HTMLFormElement>) => void;
  onDrilldownReset: () => void;
  onRefresh: () => void;
  cacheInvalidating: boolean;
  cacheInvalidationResult: CacheInvalidationResult | null;
  cacheInvalidationError: string | null;
  onRepairExpiredCache: () => void;
}) {
  if (loading && !snapshots) {
    return <p className="uw-panel uw-panel-pad uw-muted">Loading operational dashboard...</p>;
  }

  if (error) {
    return (
      <section className="uw-panel uw-panel-pad">
        <h2 className="uw-section-title">Ops Dashboard</h2>
        <p className="uw-error-text">{error}</p>
        <button className="uw-secondary" onClick={onRefresh} type="button">Retry ops refresh</button>
      </section>
    );
  }

  if (!snapshots) {
    return (
      <section className="uw-panel uw-panel-pad">
        <h2 className="uw-section-title">Ops Dashboard</h2>
        <p className="uw-muted">Open this tab to load operational metrics from the backend.</p>
        <button className="uw-secondary" onClick={onRefresh} type="button">Load ops dashboard</button>
      </section>
    );
  }

  const topCostPacks = snapshots.costs.by_pack.slice(0, 5);
  const topPromptModels = snapshots.costs.by_prompt_model.slice(0, 5);
  const fallbackRows = snapshots.costs.llm_ops.fallbacks_by_reason.slice(0, 5);
  const errorRows = snapshots.costs.llm_ops.errors_by_type.slice(0, 5);
  const securityRows = snapshots.outcomes.security.events.slice(0, 6);
  const securityCategoryRows = snapshots.outcomes.security.event_categories.slice(0, 5);
  const rateLimitRows = snapshots.outcomes.security.rate_limit_events.slice(0, 5);
  const drilldownRows = snapshots.drilldown.rows;
  const runtimeHealth = snapshots.runtimeHealth;
  const runtimePresets = snapshots.runtimePresets;
  const promptEvaluation = snapshots.promptEvaluation;
  const cacheAdmin = snapshots.cacheAdmin;
  const selectedRuntimePreset = runtimePresets.presets.find((preset) => preset.selected) ?? runtimePresets.presets[0];
  const runtimeStageRows = runtimeHealth.stages.slice(0, 5);
  const regressionTopicRows = promptEvaluation.prompt_regression.topic_results.slice(0, 6);
  const failedGoldenTopics = promptEvaluation.golden_set.topic_results.filter((topic) => !topic.pass).slice(0, 4);
  const staleArtifactRows = cacheAdmin.stale_artifacts.slice(0, 5);
  const staleSourceRows = cacheAdmin.stale_sources.slice(0, 3);
  const costSummaryCsvHref = `/api/analytics/costs?window_hours=${windowHours}&format=csv`;
  const costDrilldownCsvHref = `/api/analytics/costs/drilldown?${buildCostDrilldownQuery(windowHours, drilldownFilters, 'csv')}`;

  return (
    <section className="uw-grid" aria-label="Ops dashboard">
      <div className="uw-panel uw-panel-pad">
        <div className="uw-split">
          <div>
            <div className="uw-section-heading">
              <h2 className="uw-section-title">Ops Dashboard</h2>
              <RunbookLink href={opsRunbookLinks.overview} label="Ops Dashboard" />
            </div>
            <p className="uw-muted">Backend health, cost posture, learning outcomes, and model fallback signals for {formatWindowLabel(windowHours)}.</p>
          </div>
          <div className="uw-goal-form">
            <label>
              <span>Time window</span>
              <select
                aria-label="Ops time window"
                onChange={(event) => onWindowChange(Number(event.target.value))}
                value={windowHours}
              >
                <option value={1}>1h</option>
                <option value={24}>24h</option>
                <option value={168}>7d</option>
                <option value={720}>30d</option>
              </select>
            </label>
            <button className="uw-secondary" disabled={loading} onClick={onRefresh} type="button">
              {loading ? 'Refreshing...' : 'Refresh ops'}
            </button>
          </div>
        </div>
      </div>
      <div className="uw-ops-grid">
        <Metric label="Job success" value={formatPercent(snapshots.slo.current.job_success_rate)} detail="current SLO success rate" />
        <Metric label="Citation coverage" value={formatPercent(snapshots.slo.current.citation_coverage_rate)} detail="grounded output coverage" />
        <Metric label="Total cost" value={formatCurrency(snapshots.costs.total_estimated_usd)} detail="estimated LLM and pipeline cost" />
        <Metric label="Avg pack cost" value={formatCurrency(snapshots.costs.avg_estimated_usd_per_pack)} detail="estimated per generated pack" />
        <Metric
          label="Quiz attempts"
          value={String(snapshots.outcomes.learning.attempts)}
          detail={`${formatPercent(snapshots.outcomes.learning.avg_accuracy)} accuracy / ${formatPercent(snapshots.outcomes.learning.avg_mastery_score)} mastery`}
        />
        <Metric label="Retakes" value={String(snapshots.outcomes.learning.retakes)} detail={`${formatSignedPercent(snapshots.outcomes.learning.avg_mastery_delta)} avg mastery trend`} />
        <Metric label="LLM fallback" value={String(snapshots.costs.llm_ops.calls.fallback)} detail={`${snapshots.costs.llm_ops.calls.attempted} attempted model calls`} />
        <Metric
          label="Prompt eval"
          value={promptEvaluation.prompt_regression.pass && promptEvaluation.golden_set.pass ? 'Pass' : 'Fail'}
          detail={`${promptEvaluation.prompt_regression.failed_topics} regression failures`}
        />
        <Metric
          label="User feedback"
          value={String(promptEvaluation.user_feedback.total_feedback)}
          detail={`${promptEvaluation.user_feedback.negative_feedback} untrusted review candidates`}
        />
        <Metric label="Security events" value={String(snapshots.outcomes.security.security_events_total)} detail={`${snapshots.outcomes.security.rate_limit_events_total} rate-limit events`} />
      </div>
      <section className="uw-panel uw-panel-pad" aria-label="Local LLM runtime health">
        <div className="uw-section-heading">
          <h2 className="uw-section-title">Local LLM Runtime</h2>
          <RunbookLink href={opsRunbookLinks.reliability} label="Local LLM Runtime" />
        </div>
        <div className="uw-grid">
          <div className="uw-kv">
            <span>Provider</span>
            <strong>{titleCase(runtimeHealth.provider)}</strong>
          </div>
          <div className="uw-kv">
            <span>Model</span>
            <strong>{runtimeHealth.model}</strong>
          </div>
          <div className="uw-kv">
            <span>Runtime status</span>
            <strong>{titleCase(runtimeHealth.status)}</strong>
          </div>
          <div className="uw-kv">
            <span>Timeout status</span>
            <strong>{runtimeHealth.timeout_status === 'clear' ? 'Clear' : 'Timeouts recorded'}</strong>
          </div>
          <div className="uw-kv">
            <span>Fallback count</span>
            <strong>{runtimeHealth.calls.fallback}</strong>
          </div>
          <div className="uw-kv">
            <span>Avg latency</span>
            <strong>{formatMs(runtimeHealth.latency.avg_ms)}</strong>
          </div>
          <div className="uw-kv">
            <span>P95 latency</span>
            <strong>{formatMs(runtimeHealth.latency.p95_ms)}</strong>
          </div>
          <div className="uw-kv">
            <span>Preset</span>
            <strong>{runtimeHealth.runtime_preset}</strong>
          </div>
          <div className="uw-kv">
            <span>Fallback mode</span>
            <strong>{runtimePresets.fallback_mode === 'rule_based_only' ? 'Rule-based only' : 'OpenAI with rule-based fallback'}</strong>
          </div>
        </div>
        <div className="uw-goal-form">
          <label>
            <span>Preset selection</span>
            <select aria-label="Runtime preset selection" disabled value={runtimePresets.current_preset_id}>
              {runtimePresets.presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.id}
                </option>
              ))}
            </select>
          </label>
          {selectedRuntimePreset ? (
            <div className="uw-kv">
              <span>Selected profile</span>
              <strong>{selectedRuntimePreset.model} / {titleCase(selectedRuntimePreset.hardware)} / {selectedRuntimePreset.quantization}</strong>
            </div>
          ) : null}
        </div>
        <div className="uw-trend-list" aria-label="Runtime preset matrix">
          {runtimePresets.presets.map((preset) => (
            <div className="uw-trend-row uw-ops-row" key={preset.id}>
              <strong>{preset.id}</strong>
              <span>{preset.model}</span>
              <span>{titleCase(preset.hardware)}</span>
              <span>{preset.quantization}</span>
              <span>{preset.context_window.toLocaleString()} ctx</span>
              <span>{preset.chunk_size.toLocaleString()} chunk</span>
              <span>{preset.concurrency} concurrency</span>
              <span>{preset.selected ? 'Selected' : preset.default ? 'Default' : 'Validated'}</span>
            </div>
          ))}
        </div>
        <div className="uw-trend-list" aria-label="Local LLM runtime stage health">
          {runtimeStageRows.length === 0 ? (
            <p className="uw-muted">No runtime model calls recorded yet.</p>
          ) : runtimeStageRows.map((entry) => (
            <div className="uw-trend-row uw-ops-row" key={`${entry.provider}-${entry.model}-${entry.stage}`}>
              <strong>{titleCase(entry.stage)}</strong>
              <span>{entry.model}</span>
              <span>{entry.attempted} calls</span>
              <span>{entry.fallback} fallbacks</span>
              <span>{formatMs(entry.avg_latency_ms)} avg</span>
              <span>{formatMs(entry.p95_latency_ms)} p95</span>
            </div>
          ))}
        </div>
      </section>
      <section className="uw-panel uw-panel-pad" aria-label="Prompt evaluation results">
        <div className="uw-section-heading">
          <h2 className="uw-section-title">Prompt Evaluation</h2>
        </div>
        <div className="uw-grid">
          <div className="uw-kv">
            <span>Golden set</span>
            <strong>{promptEvaluation.golden_set.pass ? 'Pass' : 'Fail'}</strong>
          </div>
          <div className="uw-kv">
            <span>Golden topics</span>
            <strong>{promptEvaluation.golden_set.topics - promptEvaluation.golden_set.failed_topics}/{promptEvaluation.golden_set.topics} passed</strong>
          </div>
          <div className="uw-kv">
            <span>Prompt regression</span>
            <strong>{promptEvaluation.prompt_regression.pass ? 'Pass' : 'Fail'}</strong>
          </div>
          <div className="uw-kv">
            <span>Average drop</span>
            <strong>{formatPercent(promptEvaluation.prompt_regression.average_drop)}</strong>
          </div>
        </div>
        <div className="uw-trend-list" aria-label="Prompt regression summary">
          <div className="uw-trend-row uw-ops-row">
            <strong>{promptEvaluation.prompt_regression.prompt_id}</strong>
            <span>{promptEvaluation.prompt_regression.baseline.prompt_version}</span>
            <span>{'->'}</span>
            <span>{promptEvaluation.prompt_regression.candidate.prompt_version}</span>
            <span>{titleCase(promptEvaluation.prompt_regression.candidate.status)}</span>
            <span>{promptEvaluation.model}</span>
          </div>
        </div>
        <div className="uw-learning-chart-grid">
          <div className="uw-trend-list" aria-label="Prompt regression topic results">
            {regressionTopicRows.map((topic) => (
              <div className="uw-trend-row uw-ops-row" key={topic.topic_id}>
                <strong>{topic.title}</strong>
                <span>{titleCase(topic.domain)}</span>
                <span className="uw-pill" data-tone={topic.pass ? 'green' : 'red'}>{topic.pass ? 'Pass' : 'Fail'}</span>
                <span>{formatPercent(topic.max_metric_drop)} max drop</span>
                <span>{topic.failures.length > 0 ? topic.failures.map(titleCase).join(', ') : 'No failures'}</span>
              </div>
            ))}
          </div>
          <div className="uw-trend-list" aria-label="Golden-set topic failures">
            {failedGoldenTopics.length === 0 ? (
              <p className="uw-muted">No golden-set topic failures.</p>
            ) : failedGoldenTopics.map((topic) => (
              <div className="uw-trend-row uw-ops-row" key={topic.topic_id}>
                <strong>{topic.title}</strong>
                <span>{titleCase(topic.domain)}</span>
                <span>{topic.quality_failures.length > 0 ? topic.quality_failures.map(titleCase).join(', ') : 'Check failure'}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="uw-trend-list" aria-label="User feedback eval candidates">
          {promptEvaluation.user_feedback.by_artifact.length === 0 ? (
            <p className="uw-muted">No user feedback eval candidates yet.</p>
          ) : promptEvaluation.user_feedback.by_artifact.map((entry) => (
            <div className="uw-trend-row uw-ops-row" key={entry.artifact_type}>
              <strong>{titleCase(entry.artifact_type)}</strong>
              <span>{entry.total_feedback} feedback</span>
              <span>{entry.negative_feedback} review candidates</span>
              <span>{entry.average_rating.toFixed(1)} avg rating</span>
              <span>{entry.signals.map((signal) => `${titleCase(signal.signal)} ${signal.count}`).join(', ')}</span>
            </div>
          ))}
        </div>
        <p className="uw-micro">User feedback is untrusted signal data and does not change golden-set or prompt-regression fixtures.</p>
      </section>
      <section className="uw-panel uw-panel-pad" aria-label="SLO status">
        <div className="uw-section-heading">
          <h2 className="uw-section-title">SLO Targets</h2>
          <RunbookLink href={opsRunbookLinks.slo} label="SLO Targets" />
        </div>
        <div className="uw-trend-list">
          {snapshots.slo.statuses.map((status) => (
            <SloStatusRow key={status.id} status={status} />
          ))}
        </div>
      </section>
      <section className="uw-panel uw-panel-pad" aria-label="Cost drilldowns">
        <div className="uw-section-heading">
          <h2 className="uw-section-title">Cost Drilldowns</h2>
          <RunbookLink href={opsRunbookLinks.cost} label="Cost Drilldowns" />
        </div>
        <div className="uw-ops-table-actions">
          <a href={costSummaryCsvHref}>Export cost summary CSV</a>
          <a href={costDrilldownCsvHref}>Export cost drilldown CSV</a>
        </div>
        <div className="uw-learning-chart-grid">
          <div className="uw-trend-list">
            {topCostPacks.length === 0 ? (
              <p className="uw-muted">No pack cost events in this window.</p>
            ) : topCostPacks.map((entry) => (
              <div className="uw-trend-row uw-ops-row" key={entry.pack_id}>
                <strong>{entry.pack_id}</strong>
                <span>{entry.events} events</span>
                <span>{entry.estimated_tokens.toLocaleString()} tokens</span>
                <span>{formatCurrency(entry.total_estimated_usd)}</span>
                <span>{formatCurrency(entry.avg_estimated_usd)} avg</span>
              </div>
            ))}
          </div>
          <div className="uw-trend-list">
            {topPromptModels.length === 0 ? (
              <p className="uw-muted">No prompt/model cost events in this window.</p>
            ) : topPromptModels.map((entry) => (
              <div className="uw-trend-row uw-ops-row" key={`${entry.prompt_version}-${entry.model}`}>
                <strong>{entry.prompt_version}</strong>
                <span>{entry.model}</span>
                <span>{entry.events} events</span>
                <span>{formatMs(entry.avg_latency_ms)}</span>
                <span>{formatCurrency(entry.total_estimated_usd)}</span>
              </div>
            ))}
          </div>
        </div>
        <form className="uw-ops-filter-form" aria-label="Cost drilldown filters" onSubmit={onDrilldownApply}>
          <label>
            <span>Pack ID</span>
            <input
              aria-label="Drilldown pack ID"
              onChange={(event) => onDrilldownDraftChange({ ...drilldownDraft, packId: event.target.value })}
              placeholder="pack id"
              value={drilldownDraft.packId}
            />
          </label>
          <label>
            <span>Prompt version</span>
            <input
              aria-label="Drilldown prompt version"
              onChange={(event) => onDrilldownDraftChange({ ...drilldownDraft, promptVersion: event.target.value })}
              placeholder="prompt@version"
              value={drilldownDraft.promptVersion}
            />
          </label>
          <label>
            <span>Model</span>
            <input
              aria-label="Drilldown model"
              onChange={(event) => onDrilldownDraftChange({ ...drilldownDraft, model: event.target.value })}
              placeholder="model"
              value={drilldownDraft.model}
            />
          </label>
          <label>
            <span>Stage</span>
            <select
              aria-label="Drilldown stage"
              onChange={(event) => onDrilldownDraftChange({ ...drilldownDraft, stage: event.target.value as OpsDrilldownFilters['stage'] })}
              value={drilldownDraft.stage}
            >
              {costStageFilters.map((stage) => (
                <option key={stage.value} value={stage.value}>{stage.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Rows</span>
            <select
              aria-label="Drilldown row limit"
              onChange={(event) => onDrilldownDraftChange({ ...drilldownDraft, limit: Number(event.target.value) })}
              value={drilldownDraft.limit}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </label>
          <div className="uw-ops-filter-actions">
            <button className="uw-primary" disabled={loading} type="submit">Apply filters</button>
            <button className="uw-secondary" disabled={loading} onClick={onDrilldownReset} type="button">Reset filters</button>
          </div>
        </form>
        <div className="uw-grid" aria-label="Filtered cost totals">
          <div className="uw-kv">
            <span>Filtered events</span>
            <strong>{snapshots.drilldown.totals.events}</strong>
          </div>
          <div className="uw-kv">
            <span>Filtered packs</span>
            <strong>{snapshots.drilldown.totals.distinct_packs}</strong>
          </div>
          <div className="uw-kv">
            <span>Filtered tokens</span>
            <strong>{snapshots.drilldown.totals.estimated_tokens.toLocaleString()}</strong>
          </div>
          <div className="uw-kv">
            <span>Filtered cost</span>
            <strong>{formatCurrency(snapshots.drilldown.totals.total_estimated_usd)}</strong>
          </div>
        </div>
        <div className="uw-trend-list" aria-label="Filtered cost drilldown rows">
          {drilldownRows.length === 0 ? (
            <p className="uw-muted">No cost rows match the active filters.</p>
          ) : drilldownRows.map((entry) => (
            <div className="uw-trend-row uw-ops-drilldown-row" key={`${entry.pack_id}-${entry.prompt_version}-${entry.model}-${entry.stage}`}>
              <strong>{entry.pack_id}</strong>
              <span>{entry.prompt_version}</span>
              <span>{entry.model}</span>
              <span>{titleCase(entry.stage)}</span>
              <span>{entry.events} events</span>
              <span>{entry.estimated_tokens.toLocaleString()} tokens</span>
              <span>{formatMs(entry.avg_latency_ms)}</span>
              <span>{formatCurrency(entry.total_estimated_usd)}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="uw-panel uw-panel-pad" aria-label="Fallback and error tables">
        <div className="uw-section-heading">
          <h2 className="uw-section-title">Fallback And Errors</h2>
          <RunbookLink href={opsRunbookLinks.fallback} label="Fallback And Errors" />
        </div>
        <div className="uw-learning-chart-grid">
          <div className="uw-trend-list">
            {fallbackRows.length === 0 ? (
              <p className="uw-muted">No LLM fallbacks recorded.</p>
            ) : fallbackRows.map((entry) => (
              <div className="uw-trend-row uw-ops-row" key={`${entry.provider}-${entry.model}-${entry.stage}-${entry.reason}`}>
                <strong>{titleCase(entry.reason)}</strong>
                <span>{entry.stage}</span>
                <span>{entry.model}</span>
                <span>{entry.provider}</span>
                <span>{entry.events} events</span>
              </div>
            ))}
          </div>
          <div className="uw-trend-list">
            {errorRows.length === 0 ? (
              <p className="uw-muted">No LLM errors recorded.</p>
            ) : errorRows.map((entry) => (
              <div className="uw-trend-row uw-ops-row" key={`${entry.provider}-${entry.model}-${entry.stage}-${entry.error_type}`}>
                <strong>{titleCase(entry.error_type)}</strong>
                <span>{entry.stage}</span>
                <span>{entry.model}</span>
                <span>{entry.provider}</span>
                <span>{entry.events} events</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="uw-panel uw-panel-pad" aria-label="Security and rate-limit metrics">
        <div className="uw-section-heading">
          <h2 className="uw-section-title">Security And Rate Limits</h2>
          <RunbookLink href={opsRunbookLinks.security} label="Security And Rate Limits" />
        </div>
        <div className="uw-grid">
          <div className="uw-kv">
            <span>Suspicious inputs</span>
            <strong>{snapshots.outcomes.security.suspicious_inputs_total}</strong>
          </div>
          <div className="uw-kv">
            <span>Signature alerts</span>
            <strong>{snapshots.outcomes.security.signature_alerts_total}</strong>
          </div>
          <div className="uw-kv">
            <span>Audited security events</span>
            <strong>{snapshots.outcomes.security.security_events_total}</strong>
          </div>
          <div className="uw-kv">
            <span>Rate-limit events</span>
            <strong>{snapshots.outcomes.security.rate_limit_events_total}</strong>
          </div>
        </div>
        <div className="uw-learning-chart-grid">
          <div className="uw-trend-list" aria-label="Security event categories">
            {securityCategoryRows.length > 0 ? securityCategoryRows.map((entry) => (
              <div className="uw-trend-row uw-ops-row" key={entry.category}>
                <strong>{titleCase(entry.category)}</strong>
                <span>{entry.count} events</span>
              </div>
            )) : (
              <p className="uw-muted">No security event categories recorded.</p>
            )}
          </div>
          <div className="uw-trend-list" aria-label="Rate-limit event sources">
            {rateLimitRows.length > 0 ? rateLimitRows.map((entry) => (
              <div className="uw-trend-row uw-ops-row" key={entry.event_type}>
                <strong>{entry.event_type}</strong>
                <span>{entry.count} events</span>
              </div>
            )) : (
              <p className="uw-muted">No rate-limit events recorded.</p>
            )}
          </div>
        </div>
        {securityRows.length > 0 ? (
          <div className="uw-trend-list" aria-label="Security event types">
            {securityRows.map((entry) => (
              <div className="uw-trend-row uw-ops-row" key={entry.event_type}>
                <strong>{entry.event_type}</strong>
                <span>{entry.count} events</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="uw-muted">No audited security events recorded.</p>
        )}
      </section>
      <section className="uw-panel uw-panel-pad" aria-label="Cache invalidation controls">
        <div className="uw-section-heading">
          <h2 className="uw-section-title">Cache Invalidation</h2>
          <RunbookLink href={opsRunbookLinks.reliability} label="Cache Invalidation" />
        </div>
        <div className="uw-grid">
          <div className="uw-kv">
            <span>Source cache</span>
            <strong>{cacheAdmin.source.fresh}/{cacheAdmin.source.total} fresh</strong>
          </div>
          <div className="uw-kv">
            <span>Artifact cache</span>
            <strong>{cacheAdmin.artifacts.fresh}/{cacheAdmin.artifacts.total} fresh</strong>
          </div>
          <div className="uw-kv">
            <span>Repair candidates</span>
            <strong>{cacheAdmin.repair_candidates}</strong>
          </div>
          <div className="uw-kv">
            <span>Last scanned</span>
            <strong>{formatDateLabel(cacheAdmin.generated_at)}</strong>
          </div>
        </div>
        <div className="uw-split">
          <button className="uw-secondary" disabled={cacheInvalidating || cacheAdmin.repair_candidates === 0} onClick={onRepairExpiredCache} type="button">
            {cacheInvalidating ? 'Repairing...' : 'Repair stale cache artifacts'}
          </button>
          {cacheInvalidationResult ? (
            <p className="uw-muted">
              Deleted {cacheInvalidationResult.deleted.total} of {cacheInvalidationResult.matched.total} matched cache entries.
            </p>
          ) : null}
        </div>
        {cacheInvalidationError ? <p className="uw-error-text">{cacheInvalidationError}</p> : null}
        <div className="uw-learning-chart-grid">
          <div className="uw-trend-list" aria-label="Stale artifact cache candidates">
            {staleArtifactRows.length === 0 ? (
              <p className="uw-muted">No stale artifact cache entries.</p>
            ) : staleArtifactRows.map((entry) => (
              <div className="uw-trend-row uw-ops-row" key={entry.cache_key}>
                <strong>{titleCase(entry.kind)}</strong>
                <span>{entry.prompt_version}</span>
                <span>{formatDateLabel(entry.expires_at)}</span>
              </div>
            ))}
          </div>
          <div className="uw-trend-list" aria-label="Stale source cache candidates">
            {staleSourceRows.length === 0 ? (
              <p className="uw-muted">No stale source cache entries.</p>
            ) : staleSourceRows.map((entry) => (
              <div className="uw-trend-row uw-ops-row" key={entry.cache_key}>
                <strong>{entry.source_title}</strong>
                <span>{entry.parser_version}</span>
                <span>{formatDateLabel(entry.expires_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="uw-panel uw-panel-pad">
        <div className="uw-section-heading">
          <h2 className="uw-section-title">Reliability Inputs</h2>
          <RunbookLink href={opsRunbookLinks.reliability} label="Reliability Inputs" />
        </div>
        <div className="uw-grid">
          <div className="uw-kv">
            <span>Completed jobs</span>
            <strong>{snapshots.outcomes.jobs.completed}</strong>
          </div>
          <div className="uw-kv">
            <span>Failed jobs</span>
            <strong>{snapshots.outcomes.jobs.failed}</strong>
          </div>
          <div className="uw-kv">
            <span>LLM timeout rate</span>
            <strong>{formatPercent(snapshots.costs.llm_ops.calls.timeout_rate)}</strong>
          </div>
          <div className="uw-kv">
            <span>Model calls succeeded</span>
            <strong>{snapshots.costs.llm_ops.calls.succeeded}</strong>
          </div>
        </div>
      </section>
    </section>
  );
}

export default function StudyPackApp() {
  const topicInputRef = useRef<HTMLInputElement>(null);
  const [topicInput, setTopicInput] = useState('Alan Turing');
  const [job, setJob] = useState<JobStatus | null>(null);
  const [packId, setPackId] = useState<string | null>(null);
  const [studyPack, setStudyPack] = useState<StudyPack | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [showQuizResult, setShowQuizResult] = useState(false);
  const [quizSubmitting, setQuizSubmitting] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [quizAttemptResult, setQuizAttemptResult] = useState<QuizAttemptResult | null>(null);
  const [quizAttemptHistory, setQuizAttemptHistory] = useState<QuizAttemptResult[]>([]);
  const [nodeTypeFilter, setNodeTypeFilter] = useState<'all' | GraphNode['type']>('all');
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [queueStatusLoading, setQueueStatusLoading] = useState(false);
  const [queueStatusError, setQueueStatusError] = useState<string | null>(null);
  const [batchTopicInput, setBatchTopicInput] = useState('');
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchGenerationResult | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [history, setHistory] = useState<StudyPackHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [library, setLibrary] = useState<StudyPackHistoryItem[]>([]);
  const [libraryFacets, setLibraryFacets] = useState<LibraryFacets | null>(null);
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryReadinessFilter, setLibraryReadinessFilter] = useState<LibraryReadinessFilter>('all');
  const [libraryProgressFilter, setLibraryProgressFilter] = useState<LibraryProgressFilter>('all');
  const [libraryTagFilter, setLibraryTagFilter] = useState('all');
  const [libraryCollectionFilter, setLibraryCollectionFilter] = useState('all');
  const [librarySort, setLibrarySort] = useState<LibrarySort>('saved_desc');
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryOrganizationCollection, setLibraryOrganizationCollection] = useState('');
  const [libraryOrganizationTags, setLibraryOrganizationTags] = useState('');
  const [libraryOrganizationSaving, setLibraryOrganizationSaving] = useState(false);
  const [libraryOrganizationStatus, setLibraryOrganizationStatus] = useState<string | null>(null);
  const [libraryOrganizationError, setLibraryOrganizationError] = useState<string | null>(null);
  const [libraryVersionHistory, setLibraryVersionHistory] = useState<SavedPackVersionHistory | null>(null);
  const [libraryVersionLoading, setLibraryVersionLoading] = useState(false);
  const [libraryVersionError, setLibraryVersionError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [userId, setUserId] = useState('');
  const [authSession, setAuthSession] = useState<AuthSessionState>({ authenticated: false });
  const [accountProfile, setAccountProfile] = useState<UserProfile | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [accountDataBusy, setAccountDataBusy] = useState(false);
  const [deleteDataConfirming, setDeleteDataConfirming] = useState(false);
  const [librarySaving, setLibrarySaving] = useState(false);
  const [shareLink, setShareLink] = useState<ShareLink | null>(null);
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareManagementLoading, setShareManagementLoading] = useState(false);
  const [shareManagementError, setShareManagementError] = useState<string | null>(null);
  const [shareRevokingId, setShareRevokingId] = useState<string | null>(null);
  const [inspectedShareId, setInspectedShareId] = useState<string | null>(null);
  const [copiedShareId, setCopiedShareId] = useState<string | null>(null);
  const [learningProgress, setLearningProgress] = useState<LearningProgress | null>(null);
  const [learningSession, setLearningSession] = useState<LearningSession | null>(null);
  const [learningSessionActive, setLearningSessionActive] = useState(false);
  const [learningSessionBaseline, setLearningSessionBaseline] = useState<LearningSessionBaseline | null>(null);
  const [learningSessionLoading, setLearningSessionLoading] = useState(false);
  const [learningSessionError, setLearningSessionError] = useState<string | null>(null);
  const [reviewingCardIndex, setReviewingCardIndex] = useState<number | null>(null);
  const [learningAnalytics, setLearningAnalytics] = useState<LearningAnalytics | null>(null);
  const [learningReminder, setLearningReminder] = useState<LearningReminder | null>(null);
  const [learningAnalyticsLoading, setLearningAnalyticsLoading] = useState(false);
  const [learningAnalyticsError, setLearningAnalyticsError] = useState<string | null>(null);
  const [studyGoalDraft, setStudyGoalDraft] = useState('0');
  const [studyGoalSaving, setStudyGoalSaving] = useState(false);
  const [studyGoalError, setStudyGoalError] = useState<string | null>(null);
  const [opsSnapshots, setOpsSnapshots] = useState<OpsSnapshots | null>(null);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [opsWindowHours, setOpsWindowHours] = useState(24);
  const [opsDrilldownFilters, setOpsDrilldownFilters] = useState<OpsDrilldownFilters>(defaultOpsDrilldownFilters);
  const [opsDrilldownDraft, setOpsDrilldownDraft] = useState<OpsDrilldownFilters>(defaultOpsDrilldownFilters);
  const [cacheInvalidating, setCacheInvalidating] = useState(false);
  const [cacheInvalidationResult, setCacheInvalidationResult] = useState<CacheInvalidationResult | null>(null);
  const [cacheInvalidationError, setCacheInvalidationError] = useState<string | null>(null);
  const [feedbackArtifactType, setFeedbackArtifactType] = useState<FeedbackArtifactType>('overall');
  const [feedbackSignal, setFeedbackSignal] = useState<FeedbackSignal>('helpful');
  const [feedbackRating, setFeedbackRating] = useState('5');
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const sessionId = useMemo(() => getSessionId(), []);
  const sessionProfile = authSession.authenticated ? authSession.user ?? null : null;
  const activeProfile = sessionProfile ?? accountProfile;
  const activeUserId = sessionProfile?.user_id ?? userId.trim();
  const hasSessionAccount = Boolean(sessionProfile);
  const currentLibraryItem = studyPack ? library.find((item) => item.id === studyPack.id) : undefined;

  const identityHeaders = useCallback((): Record<string, string> => {
    if (hasSessionAccount) {
      return {};
    }
    const trimmedUserId = userId.trim();
    return trimmedUserId ? { 'x-user-id': trimmedUserId } : {};
  }, [hasSessionAccount, userId]);

  const refreshAuthSession = useCallback(async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const response = await fetch('/api/auth/session');
      if (!response.ok) {
        throw new Error('session_fetch_failed');
      }
      const payload = (await response.json()) as AuthSessionState;
      setAuthSession(payload.authenticated ? payload : { authenticated: false });
      if (payload.authenticated && payload.user) {
        setAccountProfile(payload.user);
        setDisplayNameDraft(payload.user.display_name);
      }
    } catch {
      setAuthSession({ authenticated: false });
      setAuthError('Could not load account session.');
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    setUserId(getUserId());
    void refreshAuthSession();
  }, [refreshAuthSession]);

  useEffect(() => {
    const organization = currentLibraryItem?.organization;
    setLibraryOrganizationCollection(organization?.collection ?? '');
    setLibraryOrganizationTags((organization?.tags ?? []).join(', '));
  }, [currentLibraryItem?.id, currentLibraryItem?.organization?.collection, currentLibraryItem?.organization?.tags]);

  useEffect(() => {
    setLibraryOrganizationStatus(null);
    setLibraryOrganizationError(null);
  }, [currentLibraryItem?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const syncOfflineState = () => setIsOffline(window.navigator.onLine === false);
    syncOfflineState();
    window.addEventListener('online', syncOfflineState);
    window.addEventListener('offline', syncOfflineState);
    return () => {
      window.removeEventListener('online', syncOfflineState);
      window.removeEventListener('offline', syncOfflineState);
    };
  }, []);

  const refreshQueueStatus = useCallback(async () => {
    setQueueStatusLoading(true);
    setQueueStatusError(null);
    try {
      const response = await fetch('/api/queue/status', {
        headers: {
          'x-session-id': sessionId
        }
      });
      if (!response.ok) {
        throw new Error('queue_status_fetch_failed');
      }
      setQueueStatus((await response.json()) as QueueStatus);
    } catch {
      setQueueStatusError('Could not load capacity status.');
    } finally {
      setQueueStatusLoading(false);
    }
  }, [sessionId]);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await fetch('/api/study-packs?limit=8', {
        headers: {
          'x-session-id': sessionId
        }
      });
      if (!response.ok) {
        throw new Error('history_fetch_failed');
      }
      const payload = (await response.json()) as { items?: StudyPackHistoryItem[] };
      setHistory(Array.isArray(payload.items) ? payload.items : []);
    } catch {
      setHistoryError('Could not load recent packs.');
    } finally {
      setHistoryLoading(false);
    }
  }, [sessionId]);

  const refreshLibrary = useCallback(async () => {
    if (!activeUserId) {
      setLibrary([]);
      setLibraryFacets(null);
      setLibraryError(null);
      setLibraryLoading(false);
      return;
    }

    setLibraryLoading(true);
    setLibraryError(null);
    try {
      const params = new URLSearchParams({ limit: '8' });
      const trimmedSearch = librarySearch.trim();
      if (trimmedSearch) {
        params.set('q', trimmedSearch);
      }
      if (libraryReadinessFilter !== 'all') {
        params.set('readiness', libraryReadinessFilter);
      }
      if (libraryProgressFilter !== 'all') {
        params.set('progress', libraryProgressFilter);
      }
      if (libraryTagFilter !== 'all') {
        params.set('tag', libraryTagFilter);
      }
      if (libraryCollectionFilter !== 'all') {
        params.set('collection', libraryCollectionFilter);
      }
      if (librarySort !== 'saved_desc') {
        params.set('sort', librarySort);
      }
      const response = await fetch(`/api/library?${params.toString()}`, {
        headers: identityHeaders()
      });
      if (!response.ok) {
        throw new Error('library_fetch_failed');
      }
      const payload = (await response.json()) as { items?: StudyPackHistoryItem[]; facets?: LibraryFacets };
      setLibrary(Array.isArray(payload.items) ? payload.items : []);
      setLibraryFacets(payload.facets ?? null);
    } catch {
      setLibraryError('Could not load saved library.');
    } finally {
      setLibraryLoading(false);
    }
  }, [activeUserId, identityHeaders, libraryCollectionFilter, libraryProgressFilter, libraryReadinessFilter, librarySearch, librarySort, libraryTagFilter]);

  const refreshLibraryVersions = useCallback(async (nextPackId?: string) => {
    if (!activeUserId || !nextPackId) {
      setLibraryVersionHistory(null);
      setLibraryVersionError(null);
      setLibraryVersionLoading(false);
      return;
    }

    setLibraryVersionLoading(true);
    setLibraryVersionError(null);
    try {
      const response = await fetch(`/api/library/${nextPackId}/versions?limit=8`, {
        headers: identityHeaders()
      });
      if (!response.ok) {
        throw new Error('version_history_fetch_failed');
      }
      setLibraryVersionHistory((await response.json()) as SavedPackVersionHistory);
    } catch {
      setLibraryVersionHistory(null);
      setLibraryVersionError('Could not load version history.');
    } finally {
      setLibraryVersionLoading(false);
    }
  }, [activeUserId, identityHeaders]);

  useEffect(() => {
    void refreshLibraryVersions(currentLibraryItem?.id);
  }, [currentLibraryItem?.id, refreshLibraryVersions]);

  const refreshLearningProgress = useCallback(async (nextPackId: string) => {
    if (!activeUserId) {
      setLearningProgress(null);
      return;
    }
    const response = await fetch(`/api/study-packs/${nextPackId}/progress`, {
      headers: identityHeaders()
    });
    if (!response.ok) return;
    setLearningProgress((await response.json()) as LearningProgress);
  }, [activeUserId, identityHeaders]);

  const refreshQuizAttempts = useCallback(async (nextPackId: string) => {
    if (!activeUserId) {
      setQuizAttemptHistory([]);
      return;
    }
    const response = await fetch(`/api/study-packs/${nextPackId}/quiz-attempts?limit=5`, {
      headers: identityHeaders()
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { items?: QuizAttemptResult[] };
    setQuizAttemptHistory(Array.isArray(payload.items) ? payload.items : []);
  }, [activeUserId, identityHeaders]);

  const refreshLearningAnalytics = useCallback(async () => {
    if (!activeUserId) {
      setLearningAnalytics(null);
      setLearningReminder(null);
      setLearningAnalyticsError(null);
      setLearningAnalyticsLoading(false);
      return;
    }

    setLearningAnalyticsLoading(true);
    setLearningAnalyticsError(null);
    try {
      const headers = identityHeaders();
      const [response, reminderResponse] = await Promise.all([
        fetch('/api/learning/analytics', { headers }),
        fetch('/api/learning/reminders', { headers })
      ]);
      if (!response.ok) {
        throw new Error('learning_analytics_fetch_failed');
      }
      const payload = (await response.json()) as LearningAnalytics;
      setLearningAnalytics(payload);
      setStudyGoalDraft(String(payload.goal.daily_target_reviews));
      setLearningReminder(reminderResponse.ok ? ((await reminderResponse.json()) as LearningReminder) : null);
    } catch {
      setLearningAnalyticsError('Could not load learning dashboard.');
      setLearningReminder(null);
    } finally {
      setLearningAnalyticsLoading(false);
    }
  }, [activeUserId, identityHeaders]);

  const refreshLearningSession = useCallback(async (
    nextPackId: string,
    baseline: LearningSessionBaseline | null,
    sessionId?: string
  ) => {
    if (!activeUserId) {
      setLearningSession(null);
      setLearningSessionLoading(false);
      setLearningSessionError(null);
      return;
    }

    setLearningSessionLoading(true);
    setLearningSessionError(null);
    const params = new URLSearchParams();
    if (sessionId) {
      params.set('session_id', sessionId);
    } else if (baseline) {
      params.set('baseline_due_cards', String(baseline.dueCards));
      params.set('baseline_mastery_score', String(baseline.masteryScore));
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    try {
      const response = await fetch(`/api/study-packs/${nextPackId}/learning-session${suffix}`, {
        headers: identityHeaders()
      });
      if (!response.ok) {
        throw new Error('learning_session_fetch_failed');
      }
      setLearningSession((await response.json()) as LearningSession);
    } catch {
      setLearningSessionError('Could not load learning session.');
    } finally {
      setLearningSessionLoading(false);
    }
  }, [activeUserId, identityHeaders]);

  const refreshShareLinks = useCallback(async () => {
    if (!studyPack || !activeUserId) {
      setShareLinks([]);
      setShareManagementError(null);
      return;
    }

    setShareManagementLoading(true);
    setShareManagementError(null);
    const response = await fetch(`/api/study-packs/${studyPack.id}/shares?limit=10`, {
      headers: identityHeaders()
    });

    if (!response.ok) {
      setShareLinks([]);
      setInspectedShareId(null);
      setShareManagementError('Could not load share links for this pack.');
      setShareManagementLoading(false);
      return;
    }

    const payload = (await response.json()) as { items?: ShareLink[] };
    setShareLinks(Array.isArray(payload.items) ? payload.items : []);
    setShareManagementLoading(false);
  }, [activeUserId, identityHeaders, studyPack]);

  const refreshOpsSnapshots = useCallback(async () => {
    setOpsLoading(true);
    setOpsError(null);
    try {
      const query = `window_hours=${opsWindowHours}`;
      const drilldownQuery = buildCostDrilldownQuery(opsWindowHours, opsDrilldownFilters);
      const [
        outcomesResponse,
        costsResponse,
        drilldownResponse,
        sloResponse,
        runtimeHealthResponse,
        runtimePresetsResponse,
        promptEvaluationResponse,
        cacheAdminResponse
      ] = await Promise.all([
        fetch(`/api/analytics/outcomes?${query}`),
        fetch(`/api/analytics/costs?${query}`),
        fetch(`/api/analytics/costs/drilldown?${drilldownQuery}`),
        fetch(`/api/analytics/slo?${query}`),
        fetch('/api/runtime/llm/health'),
        fetch('/api/runtime/llm/presets'),
        fetch('/api/evaluation/prompts'),
        fetch('/api/admin/cache', { headers: identityHeaders() })
      ]);
      if (
        !outcomesResponse.ok ||
        !costsResponse.ok ||
        !drilldownResponse.ok ||
        !sloResponse.ok ||
        !runtimeHealthResponse.ok ||
        !runtimePresetsResponse.ok ||
        !promptEvaluationResponse.ok ||
        !cacheAdminResponse.ok
      ) {
        throw new Error('ops_fetch_failed');
      }
      setOpsSnapshots({
        outcomes: (await outcomesResponse.json()) as OutcomesAnalytics,
        costs: (await costsResponse.json()) as CostAnalytics,
        drilldown: (await drilldownResponse.json()) as CostDrilldownAnalytics,
        slo: (await sloResponse.json()) as SloAnalytics,
        runtimeHealth: (await runtimeHealthResponse.json()) as LocalLlmRuntimeHealth,
        runtimePresets: (await runtimePresetsResponse.json()) as RuntimePresetVisibility,
        promptEvaluation: (await promptEvaluationResponse.json()) as PromptEvaluationSnapshot,
        cacheAdmin: (await cacheAdminResponse.json()) as CacheAdminSnapshot
      });
    } catch {
      setOpsError('Could not load operational metrics.');
    } finally {
      setOpsLoading(false);
    }
  }, [identityHeaders, opsDrilldownFilters, opsWindowHours]);

  const handleOpsWindowChange = useCallback((hours: number) => {
    setOpsWindowHours(hours);
    setOpsSnapshots(null);
  }, []);

  const handleOpsDrilldownApply = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOpsDrilldownFilters(normalizeOpsDrilldownFilters(opsDrilldownDraft));
    setOpsSnapshots(null);
  }, [opsDrilldownDraft]);

  const handleOpsDrilldownReset = useCallback(() => {
    setOpsDrilldownDraft(defaultOpsDrilldownFilters);
    setOpsDrilldownFilters(defaultOpsDrilldownFilters);
    setOpsSnapshots(null);
  }, []);

  const handleRepairExpiredCache = useCallback(async () => {
    setCacheInvalidating(true);
    setCacheInvalidationError(null);
    try {
      const response = await fetch('/api/admin/cache/invalidate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...identityHeaders() },
        body: JSON.stringify({
          target: 'expired',
          dry_run: false,
          reason: 'ops_stale_artifact_repair'
        })
      });
      if (!response.ok) {
        throw new Error('cache_invalidation_failed');
      }
      setCacheInvalidationResult((await response.json()) as CacheInvalidationResult);
      await refreshOpsSnapshots();
    } catch {
      setCacheInvalidationError('Could not repair stale cache entries.');
    } finally {
      setCacheInvalidating(false);
    }
  }, [identityHeaders, refreshOpsSnapshots]);

  useEffect(() => {
    void refreshQueueStatus();
    void refreshHistory();
  }, [refreshHistory, refreshQueueStatus]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  useEffect(() => {
    void refreshLearningAnalytics();
  }, [refreshLearningAnalytics]);

  useEffect(() => {
    if (studyPack) {
      void refreshLearningProgress(studyPack.id);
      void refreshQuizAttempts(studyPack.id);
    } else {
      setLearningProgress(null);
      setQuizAttemptHistory([]);
      setLearningSession(null);
      setLearningSessionActive(false);
      setLearningSessionBaseline(null);
      setLearningSessionError(null);
    }
  }, [refreshLearningProgress, refreshQuizAttempts, studyPack]);

  useEffect(() => {
    if (studyPack) {
      void refreshShareLinks();
    } else {
      setShareLinks([]);
      setInspectedShareId(null);
      setShareManagementError(null);
    }
  }, [refreshShareLinks, studyPack]);

  useEffect(() => {
    if (activeTab === 'ops' && !opsSnapshots && !opsLoading) {
      void refreshOpsSnapshots();
    }
  }, [activeTab, opsLoading, opsSnapshots, refreshOpsSnapshots]);

  useEffect(() => {
    if (!job || job.status === 'completed' || job.status === 'failed' || job.status === 'quarantined') {
      return;
    }

    const interval = setInterval(async () => {
      const response = await fetch(`/api/jobs/${job.id}`);
      if (!response.ok) return;
      const next = (await response.json()) as JobStatus;
      setJob(next);

      if (next.status === 'completed' && packId) {
        const packResponse = await fetch(`/api/study-packs/${packId}`);
        if (!packResponse.ok) return;
        const pack = (await packResponse.json()) as StudyPack;
        setStudyPack(pack);
        setBusy(false);
        void refreshQueueStatus();
        void refreshHistory();
        void refreshLibrary();
        void refreshLearningProgress(pack.id);
        void refreshQuizAttempts(pack.id);
        void refreshLearningAnalytics();
      }

      if (next.status === 'failed' || next.status === 'quarantined') {
        setBusy(false);
        setError(next.errors?.join('; ') ?? 'Job failed');
        void refreshQueueStatus();
        void refreshHistory();
        void refreshLibrary();
      }
    }, 800);

    return () => clearInterval(interval);
  }, [job, packId, refreshHistory, refreshLearningAnalytics, refreshLibrary, refreshLearningProgress, refreshQueueStatus, refreshQuizAttempts]);

  useEffect(() => {
    setSelectedAnswers({});
    setShowQuizResult(false);
    setQuizSubmitting(false);
    setQuizError(null);
    setQuizAttemptResult(null);
    setQuizAttemptHistory([]);
    setShareLink(null);
    setShareLinks([]);
    setShareManagementError(null);
    setShareRevokingId(null);
    setInspectedShareId(null);
    setCopiedShareId(null);
    setLearningSession(null);
    setLearningSessionActive(false);
    setLearningSessionBaseline(null);
    setLearningSessionLoading(false);
    setLearningSessionError(null);
    setFeedbackArtifactType('overall');
    setFeedbackSignal('helpful');
    setFeedbackRating('5');
    setFeedbackComment('');
    setFeedbackStatus(null);
    setFeedbackError(null);
  }, [studyPack?.id]);

  const updateUserId = (value: string) => {
    setUserId(value);
    setDeleteDataConfirming(false);
    const trimmed = value.trim();
    if (typeof window !== 'undefined') {
      if (trimmed.length > 0) {
        window.localStorage.setItem('ultrawiki_user_id', trimmed);
      } else {
        window.localStorage.removeItem('ultrawiki_user_id');
      }
    }
    if (!hasSessionAccount) {
      setAccountProfile(null);
      setDisplayNameDraft('');
    }
  };

  const resetLibraryFilters = () => {
    setLibrarySearch('');
    setLibraryReadinessFilter('all');
    setLibraryProgressFilter('all');
    setLibraryTagFilter('all');
    setLibraryCollectionFilter('all');
    setLibrarySort('saved_desc');
  };

  const saveDisplayName = async () => {
    const displayName = displayNameDraft.trim();
    if (!activeUserId || !displayName) return;

    setProfileSaving(true);
    setAuthError(null);
    setDeleteDataConfirming(false);
    try {
      const response = await fetch('/api/me', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...identityHeaders()
        },
        body: JSON.stringify({ display_name: displayName })
      });
      if (!response.ok) {
        throw new Error('profile_save_failed');
      }
      const profile = (await response.json()) as UserProfile;
      setAccountProfile(profile);
      setDisplayNameDraft(profile.display_name);
      if (hasSessionAccount) {
        setAuthSession((current) => ({ ...current, user: profile }));
      }
    } catch {
      setAuthError('Could not save display name.');
    } finally {
      setProfileSaving(false);
    }
  };

  const exportAccountData = async () => {
    if (!activeUserId) return;

    setAccountDataBusy(true);
    setAuthError(null);
    try {
      const response = await fetch('/api/me/export', {
        headers: identityHeaders()
      });
      if (!response.ok) {
        throw new Error('data_export_failed');
      }
      const payload = await response.json();
      if (typeof URL.createObjectURL === 'function') {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ultrawiki-user-data-${activeUserId}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      }
    } catch {
      setAuthError('Could not export account data.');
    } finally {
      setAccountDataBusy(false);
    }
  };

  const deleteAccountData = async () => {
    if (!activeUserId) return;
    if (!deleteDataConfirming) {
      setDeleteDataConfirming(true);
      setAuthError(null);
      return;
    }

    setAccountDataBusy(true);
    setAuthLoading(true);
    setAuthError(null);
    try {
      const response = await fetch('/api/me', {
        method: 'DELETE',
        headers: identityHeaders()
      });
      if (!response.ok) {
        throw new Error('data_delete_failed');
      }
      setAuthSession({ authenticated: false });
      setAccountProfile(null);
      setDisplayNameDraft('');
      setUserId('');
      setLibrary([]);
      setShareLink(null);
      setShareLinks([]);
      setInspectedShareId(null);
      setCopiedShareId(null);
      setLearningProgress(null);
      setLearningSession(null);
      setLearningSessionActive(false);
      setLearningAnalytics(null);
      setLearningReminder(null);
      setStudyGoalDraft('0');
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('ultrawiki_user_id');
      }
      setDeleteDataConfirming(false);
    } catch {
      setAuthError('Could not delete account data.');
    } finally {
      setAuthLoading(false);
      setAccountDataBusy(false);
    }
  };

  const logout = async () => {
    if (!hasSessionAccount) return;

    setAuthLoading(true);
    setAuthError(null);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) {
        throw new Error('logout_failed');
      }
      setAuthSession({ authenticated: false });
      setAccountProfile(null);
      setDisplayNameDraft('');
      setShareLink(null);
      setShareLinks([]);
      setInspectedShareId(null);
      setCopiedShareId(null);
      setLearningAnalytics(null);
    } catch {
      setAuthError('Could not log out.');
    } finally {
      setAuthLoading(false);
    }
  };

  const submitTopic = async (topicOverride?: string) => {
    const requestedTopic = (topicOverride ?? topicInput).trim();
    if (!requestedTopic) return;
    if (topicOverride) {
      setTopicInput(requestedTopic);
    }

    setBusy(true);
    setError(null);
    setStudyPack(null);
    setJob(null);
    setPackId(null);
    setShareLink(null);
    setLearningProgress(null);
    setQuizAttemptHistory([]);
    setActiveTab('overview');

    let response: Response;
    try {
      response = await fetch('/api/study-packs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-session-id': sessionId,
          ...identityHeaders()
        },
        body: JSON.stringify({
          title_or_url: requestedTopic,
          idempotency_key: `idem-${crypto.randomUUID()}`
        })
      });
    } catch {
      setError('Could not start generation. Check the connection and try again.');
      setBusy(false);
      void refreshQueueStatus();
      return;
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string; reason?: string };
      setError(formatRequestError(response.status, payload));
      setBusy(false);
      void refreshQueueStatus();
      return;
    }

    const payload = (await response.json()) as { pack_id: string; job_id: string };
    setPackId(payload.pack_id);
    setJob({
      id: payload.job_id,
      status: 'queued',
      stage: 'ingestion',
      progress: 0
    });
    void refreshQueueStatus();
    void refreshHistory();
    void refreshLibrary();
    void refreshLearningAnalytics();
  };

  const submitBatchTopics = async () => {
    const topics = parseTopicList(batchTopicInput);
    if (topics.length === 0) {
      setBatchError('Add at least one topic to queue a batch.');
      setBatchResult(null);
      return;
    }

    setBatchSubmitting(true);
    setBatchError(null);
    try {
      const response = await fetch('/api/study-packs/batch', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-session-id': sessionId,
          ...identityHeaders()
        },
        body: JSON.stringify({
          topics,
          idempotency_key: `batch-${crypto.randomUUID()}`
        })
      });
      const payload = (await response.json().catch(() => ({}))) as BatchGenerationResult & { error?: string };
      if (!response.ok || !Array.isArray(payload.items)) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'batch_generation_failed');
      }
      setBatchResult(payload);
      const firstQueued = payload.items.find((item) =>
        (item.status === 'accepted' || item.status === 'reused') && item.pack_id && item.job_id
      );
      if (firstQueued?.pack_id && firstQueued.job_id) {
        setPackId(firstQueued.pack_id);
        setJob({
          id: firstQueued.job_id,
          status: 'queued',
          stage: 'ingestion',
          progress: 0
        });
        setActiveTab('overview');
      }
      void refreshQueueStatus();
      void refreshHistory();
      void refreshLibrary();
      void refreshLearningAnalytics();
    } catch {
      setBatchError('Could not start batch generation. Check capacity and try again.');
      setBatchResult(null);
    } finally {
      setBatchSubmitting(false);
    }
  };

  const loadHistoryPack = async (nextPackId: string) => {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/study-packs/${nextPackId}`);
    if (!response.ok) {
      setBusy(false);
      setError('Could not load that study pack.');
      return;
    }
    const pack = (await response.json()) as StudyPack;
    setStudyPack(pack);
    setPackId(pack.id);
    setJob(null);
    setActiveTab('overview');
    setBusy(false);
    void refreshHistory();
    void refreshLibrary();
    void refreshLearningProgress(pack.id);
    void refreshQuizAttempts(pack.id);
    void refreshLearningAnalytics();
  };

  const resumePack = async () => {
    if (!studyPack || !studyPack.readiness.can_resume) return;

    setBusy(true);
    setError(null);
    setJob(null);
    setPackId(studyPack.id);
    setActiveTab('overview');

    const response = await fetch(`/api/study-packs/${studyPack.id}/resume`, {
      method: 'POST',
      headers: {
        'x-session-id': sessionId,
        ...identityHeaders()
      }
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string; reason?: string; job_id?: string };
      if (response.status === 409 && payload.error === 'pack_already_in_progress' && payload.job_id) {
        setJob({
          id: payload.job_id,
          status: 'queued',
          stage: 'ingestion',
          progress: 0
        });
        void refreshQueueStatus();
        return;
      }
      setError(formatRequestError(response.status, payload));
      setBusy(false);
      void refreshQueueStatus();
      return;
    }

    const payload = (await response.json()) as { pack_id: string; job_id: string };
    setPackId(payload.pack_id);
    setJob({
      id: payload.job_id,
      status: 'queued',
      stage: 'ingestion',
      progress: 0
    });
    void refreshQueueStatus();
    void refreshHistory();
    void refreshLibrary();
    void refreshLearningAnalytics();
  };

  const saveCurrentPack = async () => {
    if (!studyPack || !activeUserId) return;

    setLibrarySaving(true);
    setError(null);
    const response = await fetch(`/api/study-packs/${studyPack.id}/save`, {
      method: 'POST',
      headers: identityHeaders()
    });

    if (!response.ok) {
      setError('Could not save this pack to the library.');
      setLibrarySaving(false);
      return;
    }

    await refreshLibrary();
    await refreshLearningAnalytics();
    setLibrarySaving(false);
  };

  const saveCurrentPackOrganization = async () => {
    if (!studyPack || !activeUserId || !currentLibraryItem) {
      setLibraryOrganizationError('Save this pack before organizing it.');
      setLibraryOrganizationStatus(null);
      return;
    }

    setLibraryOrganizationSaving(true);
    setLibraryOrganizationError(null);
    setLibraryOrganizationStatus(null);
    const tags = libraryOrganizationTags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    const collection = libraryOrganizationCollection.trim();
    try {
      const response = await fetch(`/api/library/${studyPack.id}/organization`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          ...identityHeaders()
        },
        body: JSON.stringify({
          tags,
          collection: collection || null
        })
      });

      if (!response.ok) {
        setLibraryOrganizationError(response.status === 404 ? 'Save this pack before organizing it.' : 'Could not save pack organization.');
        return;
      }

      setLibraryOrganizationStatus('Organization saved.');
      await refreshLibrary();
    } catch {
      setLibraryOrganizationError('Could not save pack organization.');
    } finally {
      setLibraryOrganizationSaving(false);
    }
  };

  const submitGenerationFeedback = async () => {
    if (!studyPack || !activeUserId) {
      setFeedbackError('Save or sign in before sending feedback.');
      return;
    }
    const rating = Number.parseInt(feedbackRating, 10);
    const metadata = feedbackPromptMetadata(studyPack, feedbackArtifactType);

    setFeedbackSubmitting(true);
    setFeedbackStatus(null);
    setFeedbackError(null);
    try {
      const response = await fetch(`/api/study-packs/${studyPack.id}/feedback`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...identityHeaders()
        },
        body: JSON.stringify({
          artifact_type: feedbackArtifactType,
          artifact_id: metadata.artifactId,
          rating,
          signal: feedbackSignal,
          comment: feedbackComment.trim() || undefined,
          prompt_version: metadata.promptVersion,
          model: metadata.model
        })
      });

      if (!response.ok) {
        setFeedbackError(response.status === 403 ? 'Save this pack before sending feedback.' : 'Could not send feedback.');
        return;
      }

      setFeedbackComment('');
      setFeedbackStatus('Feedback saved for review.');
      if (activeTab === 'ops') {
        setOpsSnapshots(null);
      }
    } catch {
      setFeedbackError('Could not send feedback.');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const saveStudyGoal = async () => {
    if (!activeUserId) return;
    const target = Number.parseInt(studyGoalDraft, 10);
    if (!Number.isInteger(target) || target < 0 || target > 200) {
      setStudyGoalError('Daily review target must be between 0 and 200.');
      return;
    }

    setStudyGoalSaving(true);
    setStudyGoalError(null);
    const response = await fetch('/api/learning/goal', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...identityHeaders()
      },
      body: JSON.stringify({ daily_target_reviews: target })
    });
    if (!response.ok) {
      setStudyGoalError('Could not save study goal.');
      setStudyGoalSaving(false);
      return;
    }
    await refreshLearningAnalytics();
    setStudyGoalSaving(false);
  };

  const createShareLink = async () => {
    if (!studyPack || !activeUserId) return;

    setShareBusy(true);
    setError(null);
    const response = await fetch(`/api/study-packs/${studyPack.id}/share`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...identityHeaders()
      },
      body: JSON.stringify({ role: 'viewer' })
    });

    if (!response.ok) {
      setError('Could not create a share link.');
      setShareBusy(false);
      return;
    }

    const payload = (await response.json()) as ShareLink;
    setShareLink(payload);
    setShareLinks((current) => [payload, ...current.filter((item) => item.share.share_id !== payload.share.share_id)]);
    setInspectedShareId(payload.share.share_id);
    setShareBusy(false);
  };

  const copyShareLink = async (item: ShareLink) => {
    const shareUrlToCopy = frontendShareUrl(item.share.share_id);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrlToCopy);
    }
    setCopiedShareId(item.share.share_id);
  };

  const revokeShareLink = async (shareId: string) => {
    if (!studyPack || !activeUserId) return;

    setShareRevokingId(shareId);
    setShareManagementError(null);
    const response = await fetch(`/api/study-packs/${studyPack.id}/shares/${shareId}`, {
      method: 'DELETE',
      headers: identityHeaders()
    });

    if (!response.ok) {
      setShareManagementError('Could not revoke that share link.');
      setShareRevokingId(null);
      return;
    }

    setShareLinks((current) => current.filter((item) => item.share.share_id !== shareId));
    setShareLink((current) => (current?.share.share_id === shareId ? null : current));
    setInspectedShareId((current) => (current === shareId ? null : current));
    setCopiedShareId((current) => (current === shareId ? null : current));
    setShareRevokingId(null);
  };

  const startLearningSession = async () => {
    if (!studyPack || !activeUserId) return;

    const baseline = {
      dueCards: learningProgress?.due_cards ?? studyPack.flashcards.length,
      masteryScore: learningProgress?.mastery_score ?? 0
    };
    setLearningSessionBaseline(baseline);
    setLearningSessionActive(true);
    setLearningSessionLoading(true);
    setLearningSessionError(null);
    try {
      const response = await fetch(`/api/study-packs/${studyPack.id}/learning-session`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...identityHeaders()
        },
        body: JSON.stringify({
          baseline_due_cards: baseline.dueCards,
          baseline_mastery_score: baseline.masteryScore
        })
      });
      if (!response.ok) {
        throw new Error('learning_session_start_failed');
      }
      setLearningSession((await response.json()) as LearningSession);
    } catch {
      setLearningSessionError('Could not load learning session.');
    } finally {
      setLearningSessionLoading(false);
    }
  };

  const exitLearningSession = () => {
    setLearningSessionActive(false);
    setLearningSession(null);
    setLearningSessionBaseline(null);
    setLearningSessionLoading(false);
    setLearningSessionError(null);
  };

  const reviewFlashcard = async (cardIndex: number, rating: FlashcardReviewRating) => {
    if (!studyPack || !activeUserId) return;

    setReviewingCardIndex(cardIndex);
    setError(null);
    const response = await fetch(`/api/study-packs/${studyPack.id}/flashcards/${cardIndex}/reviews`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...identityHeaders()
      },
      body: JSON.stringify({ rating })
    });

    if (!response.ok) {
      setError('Could not save flashcard review.');
      setReviewingCardIndex(null);
      return;
    }

    const payload = (await response.json()) as { progress: LearningProgress };
    setLearningProgress(payload.progress);
    void refreshLearningAnalytics();
    if (learningSessionActive && learningSessionBaseline) {
      void refreshLearningSession(studyPack.id, learningSessionBaseline, learningSession?.session_id);
    }
    setReviewingCardIndex(null);
  };

  const quizScore = (() => {
    if (quizAttemptResult) {
      return { correct: quizAttemptResult.correct_answers, total: quizAttemptResult.total_questions };
    }
    if (!studyPack || !showQuizResult) return null;
    const correct = studyPack.quiz_questions.reduce((acc, question, idx) => {
      return acc + (selectedAnswers[idx] === question.correct_index ? 1 : 0);
    }, 0);
    return { correct, total: studyPack.quiz_questions.length };
  })();

  const gradeQuiz = async () => {
    if (!studyPack) return;
    const selectedIndices = studyPack.quiz_questions.map((_, idx) => selectedAnswers[idx]);
    if (selectedIndices.some((value) => typeof value !== 'number')) {
      setQuizError('Answer every question before grading.');
      return;
    }

    setQuizSubmitting(true);
    setQuizError(null);
    setQuizAttemptResult(null);

    const response = await fetch('/api/quiz-attempts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...identityHeaders()
      },
      body: JSON.stringify({
        pack_id: studyPack.id,
        selected_indices: selectedIndices
      })
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string; reason?: string };
      setQuizError(formatQuizAttemptError(response.status, payload));
      setShowQuizResult(false);
      setQuizSubmitting(false);
      return;
    }

    const payload = (await response.json()) as QuizAttemptResult;
    setQuizAttemptResult(payload);
    setQuizAttemptHistory((current) => [payload, ...current.filter((attempt) => attempt.attempt_id !== payload.attempt_id)].slice(0, 5));
    setShowQuizResult(true);
    setQuizSubmitting(false);
    void refreshQuizAttempts(studyPack.id);
    void refreshLearningAnalytics();
  };

  const retakeQuiz = () => {
    setSelectedAnswers({});
    setShowQuizResult(false);
    setQuizAttemptResult(null);
    setQuizError(null);
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isShortcutEditableTarget(event.target)) {
        return;
      }

      if (isPrimaryShortcut(event) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        topicInputRef.current?.focus();
        topicInputRef.current?.select();
        return;
      }

      if (!studyPack) {
        return;
      }

      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        const tabIndex = Number.parseInt(event.key, 10) - 1;
        const nextTab = tabs[tabIndex]?.[0];
        if (nextTab) {
          event.preventDefault();
          setActiveTab(nextTab);
          document.getElementById(tabButtonId(nextTab))?.focus();
          return;
        }
      }

      if (activeTab === 'flashcards' && isControlAltShortcut(event)) {
        const ratingIndex = Number.parseInt(event.key, 10) - 1;
        const rating = flashcardReviewRatings[ratingIndex];
        const currentSessionCard = learningSessionActive && learningSession && learningSession.status !== 'complete'
          ? learningSession.queue[0]
          : null;
        const currentCardIndex = currentSessionCard?.card_index ?? 0;
        if (rating && activeUserId && reviewingCardIndex === null && studyPack.flashcards[currentCardIndex]) {
          event.preventDefault();
          void reviewFlashcard(currentCardIndex, rating);
          return;
        }
      }

      if (activeTab === 'quiz' && isPrimaryShortcut(event) && event.key === 'Enter' && !quizSubmitting) {
        event.preventDefault();
        void gradeQuiz();
      }
    };

    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [
    activeTab,
    activeUserId,
    learningSession,
    learningSessionActive,
    quizSubmitting,
    reviewingCardIndex,
    studyPack,
    gradeQuiz,
    reviewFlashcard
  ]);

  return (
    <main className="uw-root">
      <a className="uw-skip-link" href="#study-workspace">Skip to study workspace</a>
      <TopBar topicInput={topicInput} setTopicInput={setTopicInput} submitTopic={() => void submitTopic()} busy={busy} job={job} inputRef={topicInputRef} />
      {isOffline ? (
        <section className="uw-offline-banner" role="status" aria-live="polite">
          Offline mode. Loaded packs remain visible, but network actions will retry after the connection returns.
        </section>
      ) : null}
      <div className="uw-layout">
        <LeftRail
          pack={studyPack}
          history={history}
          library={library}
          libraryFacets={libraryFacets}
          userId={userId}
          librarySearch={librarySearch}
          libraryReadinessFilter={libraryReadinessFilter}
          libraryProgressFilter={libraryProgressFilter}
          libraryTagFilter={libraryTagFilter}
          libraryCollectionFilter={libraryCollectionFilter}
          librarySort={librarySort}
          libraryOrganizationCollection={libraryOrganizationCollection}
          libraryOrganizationTags={libraryOrganizationTags}
          libraryOrganizationSaving={libraryOrganizationSaving}
          libraryOrganizationStatus={libraryOrganizationStatus}
          libraryOrganizationError={libraryOrganizationError}
          libraryVersionHistory={libraryVersionHistory}
          libraryVersionLoading={libraryVersionLoading}
          libraryVersionError={libraryVersionError}
          historyLoading={historyLoading}
          historyError={historyError}
          libraryLoading={libraryLoading}
          libraryError={libraryError}
          accountSession={authSession}
          activeProfile={activeProfile}
          activeUserId={activeUserId}
          displayNameDraft={displayNameDraft}
          onUserIdChange={updateUserId}
          onLibrarySearchChange={setLibrarySearch}
          onLibraryReadinessFilterChange={setLibraryReadinessFilter}
          onLibraryProgressFilterChange={setLibraryProgressFilter}
          onLibraryTagFilterChange={setLibraryTagFilter}
          onLibraryCollectionFilterChange={setLibraryCollectionFilter}
          onLibrarySortChange={setLibrarySort}
          onLibraryOrganizationCollectionChange={setLibraryOrganizationCollection}
          onLibraryOrganizationTagsChange={setLibraryOrganizationTags}
          onResetLibraryFilters={resetLibraryFilters}
          onDisplayNameChange={setDisplayNameDraft}
          onSaveDisplayName={() => void saveDisplayName()}
          onExportData={() => void exportAccountData()}
          onDeleteData={() => void deleteAccountData()}
          onLogout={() => void logout()}
          onOpenHistory={(id) => void loadHistoryPack(id)}
          onOpenLibrary={(id) => void loadHistoryPack(id)}
          onSaveCurrent={() => void saveCurrentPack()}
          onSaveLibraryOrganization={() => void saveCurrentPackOrganization()}
          onRetryLibraryVersions={() => void refreshLibraryVersions(currentLibraryItem?.id)}
          onRetryHistory={() => void refreshHistory()}
          onRetryLibrary={() => void refreshLibrary()}
          librarySaving={librarySaving}
          profileSaving={profileSaving}
          accountDataBusy={accountDataBusy}
          deleteDataConfirming={deleteDataConfirming}
          authLoading={authLoading}
          authError={authError}
        />
        <section className="uw-main" id="study-workspace" tabIndex={-1} aria-label="Study workspace">
          {studyPack ? <TopicHeader pack={studyPack} /> : <EmptyState setTopicInput={setTopicInput} />}
          {studyPack ? (
            <PartialPackBanner
              pack={studyPack}
              busy={busy}
              onResume={() => void resumePack()}
              onViewAvailable={() => setActiveTab('overview')}
            />
          ) : null}
          <Tabs activeTab={activeTab} setActiveTab={setActiveTab} disabled={!studyPack} />
          {!studyPack && job ? (
            <section className="uw-panel uw-panel-pad">
              <h2 className="uw-section-title">Generating Pack</h2>
              <p className="uw-muted">{jobProgressMessage(job)}</p>
            </section>
          ) : null}
          {studyPack ? (
            <section
              className="uw-tab-panel"
              id={tabPanelId(activeTab)}
              role="tabpanel"
              aria-labelledby={tabButtonId(activeTab)}
              tabIndex={0}
            >
              {activeTab === 'overview' ? (
                <OverviewPanel
                  pack={studyPack}
                  onStartRecommendation={(title) => void submitTopic(title)}
                  busy={busy}
                />
              ) : null}
              {activeTab === 'concepts' ? (
                <ConceptsPanel pack={studyPack} nodeTypeFilter={nodeTypeFilter} setNodeTypeFilter={setNodeTypeFilter} />
              ) : null}
              {activeTab === 'flashcards' ? (
                <FlashcardsPanel
                  pack={studyPack}
                  progress={learningProgress}
                  session={learningSession}
                  sessionActive={learningSessionActive}
                  sessionLoading={learningSessionLoading}
                  sessionError={learningSessionError}
                  reviewingCardIndex={reviewingCardIndex}
                  onStartSession={() => void startLearningSession()}
                  onExitSession={exitLearningSession}
                  onReviewCard={(cardIndex, rating) => void reviewFlashcard(cardIndex, rating)}
                />
              ) : null}
              {activeTab === 'quiz' ? (
                <QuizPanel
                  pack={studyPack}
                  selectedAnswers={selectedAnswers}
                  setSelectedAnswers={setSelectedAnswers}
                  showQuizResult={showQuizResult}
                  gradeQuiz={() => void gradeQuiz()}
                  quizScore={quizScore}
                  quizSubmitting={quizSubmitting}
                  quizError={quizError}
                  quizAttemptResult={quizAttemptResult}
                  quizAttemptHistory={quizAttemptHistory}
                  onRetake={retakeQuiz}
                />
              ) : null}
              {activeTab === 'learning' ? (
                <LearningDashboardPanel
                  analytics={learningAnalytics}
                  reminder={learningReminder}
                  loading={learningAnalyticsLoading}
                  error={learningAnalyticsError}
                  goalDraft={studyGoalDraft}
                  goalSaving={studyGoalSaving}
                  goalError={studyGoalError}
                  onGoalDraftChange={setStudyGoalDraft}
                  onSaveGoal={() => void saveStudyGoal()}
                  onRefresh={() => void refreshLearningAnalytics()}
                />
              ) : null}
              {activeTab === 'ops' ? (
                <OpsPanel
                  snapshots={opsSnapshots}
                  loading={opsLoading}
                  error={opsError}
                  windowHours={opsWindowHours}
                  drilldownFilters={opsDrilldownFilters}
                  drilldownDraft={opsDrilldownDraft}
                  onWindowChange={handleOpsWindowChange}
                  onDrilldownDraftChange={setOpsDrilldownDraft}
                  onDrilldownApply={handleOpsDrilldownApply}
                  onDrilldownReset={handleOpsDrilldownReset}
                  cacheInvalidating={cacheInvalidating}
                  cacheInvalidationResult={cacheInvalidationResult}
                  cacheInvalidationError={cacheInvalidationError}
                  onRepairExpiredCache={handleRepairExpiredCache}
                  onRefresh={() => void refreshOpsSnapshots()}
                />
              ) : null}
            </section>
          ) : null}
        </section>
        <RightRail
          pack={studyPack}
          job={job}
          error={error}
          queueStatus={queueStatus}
          queueStatusLoading={queueStatusLoading}
          queueStatusError={queueStatusError}
          isOffline={isOffline}
          batchTopicInput={batchTopicInput}
          batchSubmitting={batchSubmitting}
          batchResult={batchResult}
          batchError={batchError}
          shareLink={shareLink}
          shareLinks={shareLinks}
          shareBusy={shareBusy}
          shareManagementLoading={shareManagementLoading}
          shareManagementError={shareManagementError}
          shareRevokingId={shareRevokingId}
          inspectedShareId={inspectedShareId}
          copiedShareId={copiedShareId}
          feedbackArtifactType={feedbackArtifactType}
          feedbackSignal={feedbackSignal}
          feedbackRating={feedbackRating}
          feedbackComment={feedbackComment}
          feedbackSubmitting={feedbackSubmitting}
          feedbackStatus={feedbackStatus}
          feedbackError={feedbackError}
          activeUserId={activeUserId}
          onBatchTopicInputChange={setBatchTopicInput}
          onStartBatchGeneration={() => void submitBatchTopics()}
          onCreateShareLink={() => void createShareLink()}
          onRefreshQueueStatus={() => void refreshQueueStatus()}
          onRefreshShareLinks={() => void refreshShareLinks()}
          onCopyShareLink={(share) => void copyShareLink(share)}
          onInspectShareLink={setInspectedShareId}
          onRevokeShareLink={(shareId) => void revokeShareLink(shareId)}
          onFeedbackArtifactTypeChange={setFeedbackArtifactType}
          onFeedbackSignalChange={setFeedbackSignal}
          onFeedbackRatingChange={setFeedbackRating}
          onFeedbackCommentChange={setFeedbackComment}
          onSubmitFeedback={() => void submitGenerationFeedback()}
        />
      </div>
    </main>
  );
}
