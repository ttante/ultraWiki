import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudyPackApp from '../components/study-pack-app';

const queueStatus = {
  queued: 0,
  running: 0,
  max_queue_depth: 100,
  global_concurrency_limit: 2,
  session_inflight: 0,
  session_concurrency_limit: 1,
  capacity_state: 'open'
};

const studyPack = {
  id: 'pack-1',
  input: 'Ada Lovelace',
  source_revision_id: 'rev-ada-123',
  source_attribution: {
    canonical_url: 'https://en.wikipedia.org/wiki/Ada_Lovelace',
    revision_url: 'https://en.wikipedia.org/w/index.php?oldid=123',
    license: 'CC BY-SA 4.0' as const
  },
  grounding_stats: {
    citation_rate: 0.94,
    unsupported_claims: 1
  },
  summaries: [
    {
      level: 'beginner' as const,
      text: 'Ada Lovelace wrote notes about the Analytical Engine and is often discussed in computing history.',
      citations: ['Ada Lovelace citation one', 'Ada Lovelace citation two'],
      prompt_version: 'summary@1.0.0',
      model: 'qwen2.5-14b'
    },
    {
      level: 'intermediate' as const,
      text: 'Her notes connected mathematical procedures with a general-purpose calculating machine.',
      citations: ['Intermediate citation'],
      prompt_version: 'summary@1.0.0',
      model: 'qwen2.5-14b'
    },
    {
      level: 'advanced' as const,
      text: 'The source material frames her contribution through translation, annotation, and algorithmic reasoning.',
      citations: ['Advanced citation'],
      prompt_version: 'summary@1.0.0',
      model: 'qwen2.5-14b'
    }
  ],
  glossary: [
    {
      term: 'Analytical Engine',
      definition: 'A source-grounded term in the pack connected to Lovelace and computing history.',
      citation: 'Glossary citation one',
      prompt_version: 'glossary@1.0.0',
      model: 'qwen2.5-14b'
    }
  ],
  flashcards: [
    {
      question: 'What machine did Ada Lovelace write notes about?',
      answer: 'The Analytical Engine.',
      citation: 'Flashcard citation one',
      prompt_version: 'flashcard@1.0.0',
      model: 'qwen2.5-14b'
    },
    {
      question: 'Why are Lovelace notes important?',
      answer: 'They described procedures for a general-purpose machine.',
      citation: 'Flashcard citation two',
      prompt_version: 'flashcard@1.0.0',
      model: 'qwen2.5-14b'
    }
  ],
  quiz_questions: [
    {
      question: 'Which answer best describes Lovelace in this pack?',
      options: ['Astronomer', 'Computing history figure', 'Botanist', 'Navigator'],
      correct_index: 1,
      misconceptions: [
        'Astronomer is not supported by this pack.',
        'Computing history figure is the cited answer.',
        'Botanist is not supported by this pack.',
        'Navigator is not supported by this pack.'
      ],
      explanation: 'The pack connects Lovelace to computing history and the Analytical Engine.',
      citation: 'Quiz citation one',
      prompt_version: 'quiz@1.0.0',
      model: 'qwen2.5-14b'
    }
  ],
  graph: {
    nodes: [
      { id: 'n1', label: 'Ada Lovelace', type: 'person' as const, citation: 'Node citation person' },
      { id: 'n2', label: 'Analytical Engine', type: 'work' as const, citation: 'Node citation work' },
      { id: 'n3', label: 'Algorithmic reasoning', type: 'concept' as const, citation: 'Node citation concept' }
    ],
    edges: [
      { source: 'n1', target: 'n2', relation: 'related_to' as const, citation: 'Edge citation' }
    ]
  },
  timeline: [
    {
      year: 1833,
      date_label: '1833',
      description: 'Lovelace was introduced to Charles Babbage.',
      citation: 'Timeline citation early',
      source_provenance: {
        source_revision_id: 'rev-ada-123',
        citation: 'Timeline citation early',
        revision_url: 'https://en.wikipedia.org/w/index.php?oldid=123',
        license: 'CC BY-SA 4.0' as const
      }
    },
    {
      year: 1843,
      date_label: '1843',
      description: 'Lovelace notes were published.',
      citation: 'Timeline citation',
      source_provenance: {
        source_revision_id: 'rev-ada-123',
        citation: 'Timeline citation',
        revision_url: 'https://en.wikipedia.org/w/index.php?oldid=123',
        license: 'CC BY-SA 4.0' as const
      }
    },
    {
      year: 1843,
      date_label: '1843 second event',
      description: 'Her notes described an algorithmic procedure.',
      citation: 'Timeline citation algorithm',
      source_provenance: {
        source_revision_id: 'rev-ada-123',
        citation: 'Timeline citation algorithm',
        revision_url: 'https://en.wikipedia.org/w/index.php?oldid=123',
        license: 'CC BY-SA 4.0' as const
      }
    }
  ],
  recommendations: [
    {
      title: 'Analytical Engine',
      url: 'https://en.wikipedia.org/wiki/Analytical_Engine',
      rationale: 'Linked from Overview and overlaps with entities in this pack.',
      score: 0.84,
      source_heading: 'Overview'
    },
    {
      title: 'Charles Babbage',
      url: 'https://en.wikipedia.org/wiki/Charles_Babbage',
      rationale: 'Linked from Overview in the source article.',
      score: 0.71,
      source_heading: 'Overview'
    }
  ],
  cache: {
    source: {
      stage: 'source' as const,
      cache_key: 'wikipedia:en:ada lovelace',
      hit: true,
      source_revision_id: 'rev-ada-123',
      parser_version: 'wikipedia-parser@1.0.0'
    },
    artifacts: [
      {
        stage: 'summaries' as const,
        cache_key: 'summaries:rev-ada-123:summary@1.0.0:1.0.0',
        hit: false,
        source_revision_id: 'rev-ada-123',
        prompt_version: 'summary@1.0.0',
        taxonomy_version: '1.0.0'
      }
    ]
  },
  readiness: {
    status: 'full' as const,
    missing_artifacts: [],
    can_resume: false
  }
};

const partialPack = {
  ...studyPack,
  graph: {
    nodes: [],
    edges: []
  },
  glossary: [],
  timeline: [],
  flashcards: [],
  quiz_questions: [],
  readiness: {
    status: 'partial' as const,
    missing_artifacts: ['graph', 'glossary', 'flashcards', 'quiz'] as const,
    can_resume: true,
    degradation_reason: 'budget_or_time_exceeded_after_summaries'
  }
};

const summaryMissingPack = {
  ...partialPack,
  summaries: [],
  readiness: {
    ...partialPack.readiness,
    missing_artifacts: ['summaries', 'graph', 'glossary', 'flashcards', 'quiz'] as const
  }
};

const learningProgress = {
  user_id: 'user-test',
  pack_id: 'pack-1',
  total_cards: 2,
  reviewed_cards: 0,
  due_cards: 2,
  mastery_score: 0,
  cards: [
    { card_index: 0, reviewed: false, due: true },
    { card_index: 1, reviewed: false, due: true }
  ]
};

const reviewedLearningProgress = {
  ...learningProgress,
  reviewed_cards: 1,
  due_cards: 1,
  mastery_score: 0.75,
  cards: [
    {
      card_index: 0,
      reviewed: true,
      due: false,
      last_rating: 'good',
      reviewed_at: '2026-01-01T00:00:00.000Z',
      next_due_at: '2026-01-04T00:00:00.000Z'
    },
    { card_index: 1, reviewed: false, due: true }
  ]
};

const completedLearningProgress = {
  ...learningProgress,
  reviewed_cards: 2,
  due_cards: 0,
  mastery_score: 0.875,
  cards: [
    {
      card_index: 0,
      reviewed: true,
      due: false,
      last_rating: 'good',
      reviewed_at: '2026-01-01T00:00:00.000Z',
      next_due_at: '2026-01-04T00:00:00.000Z'
    },
    {
      card_index: 1,
      reviewed: true,
      due: false,
      last_rating: 'easy',
      reviewed_at: '2026-01-01T00:01:00.000Z',
      next_due_at: '2026-01-08T00:01:00.000Z'
    }
  ]
};

const learningSessionReady = {
  session_id: 'session-1',
  user_id: 'user-test',
  pack_id: 'pack-1',
  status: 'ready' as const,
  started_at: '2026-01-01T00:00:00.000Z',
  reviewed_count: 0,
  queue: [
    {
      position: 1,
      card_index: 0,
      question: studyPack.flashcards[0].question,
      answer: studyPack.flashcards[0].answer,
      citation: studyPack.flashcards[0].citation,
      prompt_version: studyPack.flashcards[0].prompt_version,
      model: studyPack.flashcards[0].model,
      reviewed: false,
      due: true
    },
    {
      position: 2,
      card_index: 1,
      question: studyPack.flashcards[1].question,
      answer: studyPack.flashcards[1].answer,
      citation: studyPack.flashcards[1].citation,
      prompt_version: studyPack.flashcards[1].prompt_version,
      model: studyPack.flashcards[1].model,
      reviewed: false,
      due: true
    }
  ],
  metrics: {
    total_cards: 2,
    reviewed_cards: 0,
    due_cards: 2,
    session_total: 2,
    completed_cards: 0,
    remaining_cards: 2,
    mastery_score: 0,
    mastery_delta: 0
  }
};

const learningSessionAfterFirst = {
  ...learningSessionReady,
  reviewed_count: 1,
  queue: [
    {
      ...learningSessionReady.queue[1],
      position: 2
    }
  ],
  metrics: {
    ...learningSessionReady.metrics,
    reviewed_cards: 1,
    due_cards: 1,
    completed_cards: 1,
    remaining_cards: 1,
    mastery_score: 0.75,
    mastery_delta: 0.75
  }
};

const learningSessionComplete = {
  ...learningSessionReady,
  status: 'complete' as const,
  completed_at: '2026-01-01T00:02:00.000Z',
  reviewed_count: 2,
  queue: [],
  metrics: {
    ...learningSessionReady.metrics,
    reviewed_cards: 2,
    due_cards: 0,
    completed_cards: 2,
    remaining_cards: 0,
    mastery_score: 0.875,
    mastery_delta: 0.875
  }
};

const learningAnalytics = {
  user_id: 'user-test',
  generated_at: '2026-01-03T12:00:00.000Z',
  total_cards: 2,
  reviewed_cards: 1,
  due_cards: 1,
  due_packs: 1,
  streak: {
    current_days: 2,
    longest_days: 4,
    last_activity_at: '2026-01-02T09:00:00.000Z'
  },
  goal: {
    daily_target_reviews: 2,
    reviews_today: 1,
    remaining_today: 1,
    target_met: false,
    created_at: '2026-01-01T08:00:00.000Z',
    updated_at: '2026-01-01T08:00:00.000Z'
  },
  retention: {
    reviewed_cards: 1,
    retained_cards: 1,
    due_reviewed_cards: 0,
    retention_rate: 1
  },
  mastery: {
    average_score: 0.375,
    average_delta: 0.125,
    trend: [
      {
        source: 'session' as const,
        pack_id: 'pack-1',
        recorded_at: '2026-01-01T00:02:00.000Z',
        mastery_score: 0.75,
        mastery_delta: 0.75
      },
      {
        source: 'quiz' as const,
        pack_id: 'pack-1',
        recorded_at: '2026-01-02T09:00:00.000Z',
        mastery_score: 0.6875,
        mastery_delta: -0.0625
      }
    ]
  },
  accuracy: {
    attempts: 2,
    retakes: 1,
    average_accuracy: 0.75,
    latest_accuracy: 0.5,
    accuracy_delta: -0.5,
    trend: [
      {
        pack_id: 'pack-1',
        attempt_number: 1,
        submitted_at: '2026-01-02T09:00:00.000Z',
        accuracy: 1,
        accuracy_delta: 0,
        mastery_score: 0.875
      },
      {
        pack_id: 'pack-1',
        attempt_number: 2,
        submitted_at: '2026-01-03T09:00:00.000Z',
        accuracy: 0.5,
        accuracy_delta: -0.5,
        mastery_score: 0.6875
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
      next_due_at: '2026-01-04T09:00:00.000Z',
      last_reviewed_at: '2026-01-01T09:00:00.000Z',
      quiz_attempts: 2,
      latest_accuracy: 0.5,
      accuracy_delta: -0.5
    }
  ]
};

const learningReminder = {
  user_id: 'user-test',
  generated_at: '2026-01-03T12:00:00.000Z',
  due_cards: 1,
  due_packs: 1,
  next_due_at: '2026-01-03T12:00:00.000Z',
  poll_after_seconds: 300,
  delivery: 'local_poll' as const,
  external_notifications: false as const,
  packs: [
    {
      pack_id: 'pack-1',
      due_cards: 1,
      next_due_at: '2026-01-03T12:00:00.000Z',
      last_reviewed_at: '2026-01-02T09:00:00.000Z'
    }
  ]
};

const opsCacheAdminSnapshot = {
  generated_at: '2026-01-01T00:00:00.000Z',
  source: {
    total: 2,
    fresh: 1,
    expired: 1
  },
  artifacts: {
    total: 4,
    fresh: 2,
    expired: 2,
    by_kind: [
      { kind: 'summaries', total: 2, expired: 1 },
      { kind: 'active_recall', total: 2, expired: 1 }
    ]
  },
  stale_sources: [
    {
      cache_key: 'wikipedia:en:old topic',
      source_title: 'Old Topic',
      source_revision_id: 'rev-old',
      parser_version: 'wikipedia-parser@1.0.0',
      expires_at: '2025-12-31T00:00:00.000Z'
    }
  ],
  stale_artifacts: [
    {
      cache_key: 'summaries:rev-old:summary@1.0.0:1.0.0',
      kind: 'summaries',
      source_revision_id: 'rev-old',
      prompt_version: 'summary@1.0.0',
      taxonomy_version: '1.0.0',
      expires_at: '2025-12-31T00:00:00.000Z'
    },
    {
      cache_key: 'active_recall:rev-old:active-recall@1.0.0:1.0.0',
      kind: 'active_recall',
      source_revision_id: 'rev-old',
      prompt_version: 'active-recall@1.0.0',
      taxonomy_version: '1.0.0',
      expires_at: '2025-12-31T00:30:00.000Z'
    }
  ],
  repair_candidates: 3
};

const opsSnapshots = {
  cacheAdmin: opsCacheAdminSnapshot,
  outcomes: {
    window_hours: 24,
    jobs: { completed: 4, failed: 1, completion_rate: 0.8 },
    quality: { avg_citation_rate: 0.94 },
    learning: { attempts: 3, retakes: 1, avg_accuracy: 0.67, avg_mastery_score: 0.72, avg_mastery_delta: 0.08 },
    security: {
      suspicious_inputs_total: 2,
      signature_alerts_total: 1,
      security_events_total: 4,
      rate_limit_events_total: 1,
      event_categories: [
        { category: 'auth', count: 2 },
        { category: 'rate_limit', count: 1 },
        { category: 'share', count: 1 }
      ],
      rate_limit_events: [
        { event_type: 'rate_limit.exceeded', count: 1 }
      ],
      events: [
        { event_type: 'auth.authentication_required', count: 2 },
        { event_type: 'share.read_failed', count: 1 },
        { event_type: 'rate_limit.exceeded', count: 1 }
      ]
    }
  },
  costs: {
    window_hours: 24,
    total_estimated_usd: 0.1234,
    avg_estimated_usd_per_pack: 0.0411,
    by_stage: [
      {
        stage: 'summarization',
        events: 2,
        avg_tokens: 1400,
        avg_latency_ms: 1800,
        total_estimated_usd: 0.052,
        avg_estimated_usd: 0.026
      }
    ],
    by_pack: [
      {
        pack_id: 'pack-1',
        events: 4,
        estimated_tokens: 3600,
        total_estimated_usd: 0.082,
        avg_estimated_usd: 0.0205
      }
    ],
    by_prompt_model: [
      {
        prompt_version: 'summary-by-level@1.0.0',
        model: 'local-rule-based',
        events: 2,
        avg_latency_ms: 1800,
        estimated_tokens: 2800,
        total_estimated_usd: 0.052
      }
    ],
    llm_ops: {
      calls: {
        attempted: 2,
        succeeded: 1,
        fallback: 1,
        invalid_responses: 1,
        timeouts: 0,
        timeout_rate: 0
      },
      by_stage_model: [
        {
          provider: 'openai_compatible',
          model: 'qwen2.5',
          stage: 'summaries',
          attempted: 2,
          succeeded: 1,
          fallback: 1,
          avg_latency_ms: 1800,
          p95_latency_ms: 2400
        }
      ],
      fallbacks_by_reason: [
        {
          provider: 'openai_compatible',
          model: 'qwen2.5',
          stage: 'summaries',
          reason: 'invalid_response',
          events: 1
        }
      ],
      errors_by_type: [
        {
          provider: 'openai_compatible',
          model: 'qwen2.5',
          stage: 'summaries',
          error_type: 'invalid_response',
          events: 1
        }
      ]
    }
  },
  drilldown: {
    window_hours: 24,
    limit: 25,
    filters: {
      pack_id: null,
      prompt_version: null,
      model: null,
      stage: null
    },
    totals: {
      events: 4,
      estimated_tokens: 3600,
      total_estimated_usd: 0.082,
      avg_estimated_usd: 0.0205,
      avg_latency_ms: 1800,
      distinct_packs: 1
    },
    rows: [
      {
        pack_id: 'pack-1',
        prompt_version: 'summary-by-level@1.0.0',
        model: 'local-rule-based',
        stage: 'summarization',
        events: 2,
        estimated_tokens: 2800,
        avg_tokens: 1400,
        avg_latency_ms: 1800,
        total_estimated_usd: 0.052,
        avg_estimated_usd: 0.026,
        first_recorded_at: '2026-01-01T00:00:00.000Z',
        last_recorded_at: '2026-01-01T00:01:00.000Z'
      }
    ]
  },
  slo: {
    window_hours: 24,
    targets: [
      { id: 'job_success_rate', name: 'Job success rate', target: 0.99, comparator: '>=' as const }
    ],
    current: {
      p95_time_to_first_artifact_ms: 1200,
      p95_full_pack_completion_ms: 5200,
      job_success_rate: 0.8,
      citation_coverage_rate: 0.94
    },
    statuses: [
      {
        id: 'job_success_rate',
        name: 'Job success rate',
        current_value: 0.8,
        target: 0.99,
        comparator: '>=' as const,
        passed: false,
        error_budget_burn: 19
      },
      {
        id: 'citation_coverage_rate',
        name: 'Citation coverage rate',
        current_value: 0.94,
        target: 0.85,
        comparator: '>=' as const,
        passed: true,
        error_budget_burn: 0
      }
    ]
  },
  runtimeHealth: {
    generated_at: '2026-01-01T00:00:00.000Z',
    provider: 'openai_compatible' as const,
    model: 'qwen2.5-14b-instruct-q4_k_m',
    base_url: 'http://localhost:8080/v1',
    runtime_preset: 'rtx4080_qwen14b_safe',
    quantization: 'q4_k_m',
    context_window: 4096,
    chunk_size: 1000,
    concurrency: 1,
    timeout_ms: 120000,
    status: 'degraded' as const,
    fallback_mode: true,
    timeout_status: 'timeouts_recorded' as const,
    calls: {
      attempted: 2,
      succeeded: 1,
      fallback: 1,
      timeouts: 1,
      timeout_rate: 0.5
    },
    latency: {
      avg_ms: 1800,
      p95_ms: 2400
    },
    stages: [
      {
        provider: 'openai_compatible',
        model: 'qwen2.5-14b-instruct-q4_k_m',
        stage: 'summaries',
        attempted: 2,
        succeeded: 1,
        fallback: 1,
        avg_latency_ms: 1800,
        p95_latency_ms: 2400
      }
    ]
  },
  runtimePresets: {
    generated_at: '2026-01-01T00:00:00.000Z',
    provider: 'openai_compatible' as const,
    model: 'qwen2.5-14b-instruct-q4_k_m',
    default_preset_id: 'rtx4080_qwen14b_safe',
    current_preset_id: 'rtx4080_qwen14b_safe',
    fallback_mode: 'openai_with_rule_based_fallback' as const,
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
        model: 'qwen2.5-14b' as const,
        hardware: 'rtx4080_12gb' as const,
        quantization: 'q4_k_m' as const,
        context_window: 4096,
        chunk_size: 1000,
        concurrency: 1,
        validated: true,
        selected: true,
        default: true
      },
      {
        id: 'rtx4080_qwen14b_balanced',
        model: 'qwen2.5-14b' as const,
        hardware: 'rtx4080_12gb' as const,
        quantization: 'q4_k_m' as const,
        context_window: 6144,
        chunk_size: 1300,
        concurrency: 2,
        validated: true,
        selected: false,
        default: false
      }
    ]
  },
  promptEvaluation: {
    generated_at: '2026-01-01T00:00:00.000Z',
    prompt_registry_version: '1.1.0',
    dataset: {
      version: '2026-05-22',
      checksum_sha256: 'checksum',
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
          metrics: {
            summary_quality: 0.86,
            citation_coverage: 1,
            quiz_validity: 1,
            graph_coherence: 0.9
          },
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
        status: 'active' as const,
        changelog: 'Initial grounded summary prompt.'
      },
      candidate: {
        prompt_version: 'summary-by-level@1.1.0',
        version: '1.1.0',
        status: 'draft' as const,
        changelog: 'Tighten grounding language.'
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
          baseline: {
            summary_quality: 0.86,
            citation_coverage: 1,
            quiz_validity: 1,
            graph_coherence: 0.9
          },
          candidate: {
            summary_quality: 0.86,
            citation_coverage: 1,
            quiz_validity: 1,
            graph_coherence: 0.9
          },
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
      dataset: 'user_feedback' as const,
      trusted_artifact: false as const,
      contaminates_golden_set: false as const,
      requires_human_review: true as const,
      total_feedback: 1,
      negative_feedback: 1,
      average_rating: 2,
      latest_feedback_at: '2026-01-09T00:00:00.000Z',
      by_artifact: [
        {
          artifact_type: 'quiz' as const,
          total_feedback: 1,
          negative_feedback: 1,
          average_rating: 2,
          latest_feedback_at: '2026-01-09T00:00:00.000Z',
          signals: [{ signal: 'incorrect' as const, count: 1 }]
        }
      ]
    }
  }
};

const sessionProfile = {
  user_id: 'oidc:local-oidc:sub-1',
  display_name: 'Grace',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z'
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

const managedShareLink = {
  share: {
    share_id: 'share-2',
    pack_id: 'pack-1',
    owner_user_id: 'user-test',
    role: 'viewer' as const,
    created_at: '2026-01-02T00:00:00.000Z'
  },
  share_path: '/api/shared/share-2'
};

function mockSuccessfulGeneration(
  quizAttemptResponse: { body: unknown; status?: number } = {
    body: {
      attempt_id: 'attempt-1',
      user_id: 'user-test',
      pack_id: 'pack-1',
      attempt_number: 1,
      selected_indices: [1],
      total_questions: 1,
      correct_answers: 1,
      accuracy: 1,
      accuracy_delta: 0,
      card_mastery_score: 0.75,
      mastery_score: 0.875,
      mastery_delta: 0.125,
      submitted_at: '2026-01-01T00:00:00.000Z'
    }
  }
) {
  let reviewedCards = 0;
  const quizAttempts: unknown[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url === '/api/queue/status') {
      return jsonResponse(queueStatus);
    }

    if (url === '/api/auth/session') {
      return jsonResponse({ authenticated: false });
    }

    if (url === '/api/study-packs?limit=8') {
      return jsonResponse({ items: [{ id: 'pack-1', input: 'Ada Lovelace', source_revision_id: 'rev-ada-123', created_at: '2026-01-01T00:00:00.000Z', latest_job: null, readiness: studyPack.readiness }] });
    }

    if (url === '/api/library?limit=8') {
      return jsonResponse({ items: [{ id: 'pack-1', input: 'Ada Lovelace', source_revision_id: 'rev-ada-123', created_at: '2026-01-01T00:00:00.000Z', latest_job: null, readiness: studyPack.readiness }] });
    }

    if (url === '/api/study-packs') {
      return jsonResponse({ pack_id: 'pack-1', job_id: 'job-1' });
    }

    if (url === '/api/jobs/job-1') {
      return jsonResponse({ id: 'job-1', status: 'completed', stage: 'done', progress: 100 });
    }

    if (url === '/api/study-packs/pack-1') {
      return jsonResponse(studyPack);
    }

    if (url === '/api/study-packs/pack-1/progress') {
      return jsonResponse(reviewedCards === 0 ? learningProgress : reviewedCards === 1 ? reviewedLearningProgress : completedLearningProgress);
    }

    if (url === '/api/study-packs/pack-1/save') {
      return jsonResponse({ pack_id: 'pack-1', saved: true, saved_at: '2026-01-01T00:00:00.000Z' });
    }

    if (url.startsWith('/api/study-packs/pack-1/learning-session')) {
      if (reviewedCards === 0) {
        return jsonResponse(learningSessionReady, init?.method === 'POST' ? 201 : 200);
      }
      if (reviewedCards === 1) {
        return jsonResponse(learningSessionAfterFirst);
      }
      return jsonResponse(learningSessionComplete);
    }

    if (url === '/api/study-packs/pack-1/quiz-attempts?limit=5') {
      return jsonResponse({ items: quizAttempts });
    }

    if (url === '/api/learning/analytics') {
      return jsonResponse(learningAnalytics);
    }

    if (url === '/api/learning/reminders') {
      return jsonResponse(learningReminder);
    }

    if (url === '/api/learning/goal' && init?.method === 'PUT') {
      return jsonResponse({
        user_id: 'user-test',
        daily_target_reviews: JSON.parse(String(init.body)).daily_target_reviews,
        reviews_today: 1,
        remaining_today: 3,
        target_met: false,
        created_at: '2026-01-01T08:00:00.000Z',
        updated_at: '2026-01-03T09:00:00.000Z'
      });
    }

    if (url === '/api/study-packs/pack-1/share') {
      return jsonResponse({
        share: {
          share_id: 'share-1',
          pack_id: 'pack-1',
          owner_user_id: 'user-test',
          role: 'viewer',
          created_at: '2026-01-01T00:00:00.000Z'
        },
        share_path: '/api/shared/share-1'
      }, 201);
    }

    if (url === '/api/study-packs/pack-1/shares?limit=10') {
      return jsonResponse({ items: [managedShareLink] });
    }

    if (url === '/api/study-packs/pack-1/shares/share-2' && init?.method === 'DELETE') {
      return jsonResponse({ share_id: 'share-2', revoked: true });
    }

    if (url === '/api/study-packs/pack-1/feedback') {
      return jsonResponse(
        {
          feedback_id: 'feedback-1',
          user_id: 'user-test',
          pack_id: 'pack-1',
          artifact_type: 'quiz',
          artifact_id: 'question-0',
          rating: 2,
          signal: 'incorrect',
          comment: 'Answer key looked wrong.',
          prompt_version: 'active-recall@1.0.0',
          model: 'local-rule-based',
          created_at: '2026-01-09T00:00:00.000Z',
          governance: {
            dataset: 'user_feedback',
            trusted_artifact: false,
            eval_candidate: true,
            contaminates_golden_set: false,
            requires_human_review: true
          }
        },
        201
      );
    }

    if (url === '/api/study-packs/pack-1/flashcards/0/reviews') {
      reviewedCards = Math.max(reviewedCards, 1);
      return jsonResponse({
        review: {
          review_id: 'review-1',
          user_id: 'user-test',
          pack_id: 'pack-1',
          card_index: 0,
          rating: 'good',
          reviewed_at: '2026-01-01T00:00:00.000Z',
          next_due_at: '2026-01-04T00:00:00.000Z'
        },
        progress: reviewedLearningProgress
      });
    }

    if (url === '/api/study-packs/pack-1/flashcards/1/reviews') {
      reviewedCards = 2;
      return jsonResponse({
        review: {
          review_id: 'review-2',
          user_id: 'user-test',
          pack_id: 'pack-1',
          card_index: 1,
          rating: 'easy',
          reviewed_at: '2026-01-01T00:01:00.000Z',
          next_due_at: '2026-01-08T00:01:00.000Z'
        },
        progress: completedLearningProgress
      });
    }

    if (url === '/api/quiz-attempts') {
      if ((quizAttemptResponse.status ?? 200) < 400) {
        quizAttempts.unshift(quizAttemptResponse.body);
      }
      return jsonResponse(quizAttemptResponse.body, quizAttemptResponse.status ?? 200);
    }

    if (url.startsWith('/api/analytics/outcomes?window_hours=')) {
      const windowHours = Number(url.split('=').pop());
      return jsonResponse({ ...opsSnapshots.outcomes, window_hours: windowHours });
    }

    if (url.startsWith('/api/analytics/costs?window_hours=')) {
      const windowHours = Number(url.split('=').pop());
      return jsonResponse({ ...opsSnapshots.costs, window_hours: windowHours });
    }

    if (url.startsWith('/api/analytics/costs/drilldown?')) {
      const parsed = new URL(url, 'http://web.test');
      const windowHours = Number(parsed.searchParams.get('window_hours') ?? 24);
      return jsonResponse({
        ...opsSnapshots.drilldown,
        window_hours: windowHours,
        limit: Number(parsed.searchParams.get('limit') ?? opsSnapshots.drilldown.limit),
        filters: {
          pack_id: parsed.searchParams.get('pack_id'),
          prompt_version: parsed.searchParams.get('prompt_version'),
          model: parsed.searchParams.get('model'),
          stage: parsed.searchParams.get('stage') as 'summarization' | null
        }
      });
    }

    if (url.startsWith('/api/analytics/slo?window_hours=')) {
      const windowHours = Number(url.split('=').pop());
      return jsonResponse({ ...opsSnapshots.slo, window_hours: windowHours });
    }

    if (url === '/api/runtime/llm/health') {
      return jsonResponse(opsSnapshots.runtimeHealth);
    }

    if (url === '/api/runtime/llm/presets') {
      return jsonResponse(opsSnapshots.runtimePresets);
    }

    if (url === '/api/evaluation/prompts') {
      return jsonResponse(opsSnapshots.promptEvaluation);
    }

    if (url === '/api/admin/cache') {
      return jsonResponse(opsSnapshots.cacheAdmin);
    }

    if (url === '/api/admin/cache/invalidate' && init?.method === 'POST') {
      return jsonResponse({
        target: 'expired',
        dry_run: false,
        reason: JSON.parse(String(init.body)).reason,
        requested_at: '2026-01-01T00:01:00.000Z',
        matched: { source: 1, artifacts: 2, total: 3 },
        deleted: { source: 1, artifacts: 2, total: 3 }
      });
    }

    return jsonResponse({ error: 'unexpected request' }, 404);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function generateLoadedPack(quizAttemptResponse?: { body: unknown; status?: number }) {
  const fetchMock = mockSuccessfulGeneration(quizAttemptResponse);

  render(React.createElement(StudyPackApp));
  const input = screen.getByLabelText('Wikipedia topic or URL');
  fireEvent.change(input, { target: { value: 'Ada Lovelace' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

  await screen.findByText('Generating');

  await screen.findByRole('heading', { name: 'Ada Lovelace' });
  return fetchMock;
}

const normalizeSmokeText = (value: string | null): string => (value ?? '').replace(/\s+/g, ' ').trim();

const collectHeadings = (selector: string): string[] => {
  const container = document.querySelector(selector);
  if (!container) return [];
  return Array.from(container.querySelectorAll('h1, h2, h3'))
    .map((heading) => normalizeSmokeText(heading.textContent))
    .filter(Boolean);
};

const hasBodyText = (value: string): boolean => document.body.textContent?.includes(value) ?? false;

const captureVisualSmokeState = (name: string) => ({
  name,
  layoutClasses: Array.from(document.querySelectorAll('.uw-layout > *')).map((element) => (element as HTMLElement).className),
  activeTab: normalizeSmokeText(
    Array.from(document.querySelectorAll('[role="tab"]'))
      .find((element) => element.getAttribute('aria-selected') === 'true')
      ?.textContent ?? 'none'
  ),
  mainHeadings: collectHeadings('.uw-main'),
  rightRailHeadings: collectHeadings('.uw-right-rail'),
  signals: [
    document.querySelector('.uw-hero') ? 'hero' : null,
    document.querySelector('.uw-topic-head') ? 'topic-head' : null,
    document.querySelector('.uw-graph-shell') ? 'graph-shell' : null,
    document.querySelector('.uw-deck') ? 'flashcard-deck' : null,
    document.querySelector('.uw-grade') ? 'quiz-grade' : null,
    hasBodyText('Learning Dashboard') ? 'learning-dashboard' : null,
    hasBodyText('SLO Targets') ? 'ops-slo' : null,
    hasBodyText('No concept nodes match the current graph filters.') ? 'graph-empty' : null,
    hasBodyText('Citation Stream') ? 'citation-stream' : null
  ].filter((signal): signal is string => Boolean(signal))
});

describe('StudyPackApp', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/queue/status') {
          return jsonResponse(queueStatus);
        }
        if (url === '/api/auth/session') {
          return jsonResponse({ authenticated: false });
        }
        if (url === '/api/study-packs?limit=8') {
          return jsonResponse({ items: [] });
        }
        if (url === '/api/library?limit=8') {
          return jsonResponse({ items: [] });
        }
        if (url === '/api/learning/analytics') {
          return jsonResponse({ ...learningAnalytics, packs: [], total_cards: 0, reviewed_cards: 0, due_cards: 0, due_packs: 0 });
        }
        if (url === '/api/learning/reminders') {
          return jsonResponse({ ...learningReminder, due_cards: 0, due_packs: 0, packs: [] });
        }
        return jsonResponse({ error: 'unexpected request' }, 404);
      })
    );
  });

  it('renders the redesigned empty workspace and supports example topic selection', () => {
    render(React.createElement(StudyPackApp));

    expect(screen.getByText('UltraWiki')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Turn source material into a navigable learning system.' })).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('Citation Stream')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ada Lovelace' }));

    expect(screen.getByLabelText('Wikipedia topic or URL')).toHaveValue('Ada Lovelace');
  });

  it('surfaces offline state without hiding the empty workspace', () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });

    render(React.createElement(StudyPackApp));

    expect(screen.getByText(/Offline mode/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Turn source material into a navigable learning system.' })).toBeInTheDocument();
  });

  it('exposes skip navigation, live status, and accessible tab semantics', async () => {
    await generateLoadedPack();

    expect(screen.getByRole('link', { name: 'Skip to study workspace' })).toHaveAttribute('href', '#study-workspace');
    expect(screen.getByLabelText('Study workspace')).toHaveAttribute('id', 'study-workspace');
    expect(screen.getAllByRole('status').some((status) => status.textContent === 'Completed')).toBe(true);

    const tablist = screen.getByRole('tablist', { name: 'Study pack sections' });
    const overviewTab = within(tablist).getByRole('tab', { name: 'Overview' });
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    expect(overviewTab).toHaveAttribute('aria-controls', 'uw-tabpanel-overview');
    expect(screen.getByRole('tabpanel', { name: 'Overview' })).toHaveAttribute('id', 'uw-tabpanel-overview');

    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' });

    const conceptsTab = within(tablist).getByRole('tab', { name: 'Concepts' });
    expect(conceptsTab).toHaveAttribute('aria-selected', 'true');
    expect(conceptsTab).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'Concepts' })).toHaveAttribute('id', 'uw-tabpanel-concepts');
  });

  it('supports keyboard shortcuts for search, tabs, graph controls, flashcard review, and quiz grading', async () => {
    window.localStorage.setItem('ultrawiki_user_id', 'user-test');
    const fetchMock = await generateLoadedPack();

    const topicInput = screen.getByLabelText('Wikipedia topic or URL');
    topicInput.blur();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(topicInput).toHaveFocus();

    topicInput.blur();
    fireEvent.keyDown(document, { key: '2', altKey: true });
    const conceptsTab = screen.getByRole('tab', { name: 'Concepts' });
    await waitFor(() => expect(conceptsTab).toHaveAttribute('aria-selected', 'true'));
    expect(conceptsTab).toHaveFocus();

    fireEvent.keyDown(document, { key: 'f', ctrlKey: true, altKey: true });
    const graphSearch = screen.getByLabelText('Search graph nodes and relationships');
    expect(graphSearch).toHaveFocus();
    fireEvent.change(graphSearch, { target: { value: 'engine' } });
    graphSearch.blur();
    fireEvent.keyDown(document, { key: '=', ctrlKey: true, altKey: true });
    expect(screen.getByText('Zoom 125%')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: '0', ctrlKey: true, altKey: true });
    await waitFor(() => expect(screen.getByText('Zoom 100%')).toBeInTheDocument());
    expect(graphSearch).toHaveValue('');
    const graphStage = screen.getByLabelText('Interactive concept graph').querySelector('.uw-graph-stage') as HTMLElement;
    fireEvent.keyDown(document, { key: ']', ctrlKey: true, altKey: true });
    await waitFor(() => expect(graphStage.style.transform).toContain('translate(24px, 0px) scale(1)'));
    fireEvent.keyDown(document, { key: '[', ctrlKey: true, altKey: true });
    await waitFor(() => expect(graphStage.style.transform).toContain('translate(0px, 0px) scale(1)'));

    fireEvent.keyDown(document, { key: '3', altKey: true });
    const flashcardsTab = screen.getByRole('tab', { name: 'Flashcards' });
    await waitFor(() => expect(flashcardsTab).toHaveAttribute('aria-selected', 'true'));
    fireEvent.keyDown(document, { key: '3', ctrlKey: true, altKey: true });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/study-packs/pack-1/flashcards/0/reviews',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ rating: 'good' })
        })
      );
    });

    fireEvent.keyDown(document, { key: '4', altKey: true });
    const quizRegion = await screen.findByRole('tabpanel', { name: 'Quiz' });
    const correctAnswer = within(quizRegion).getByLabelText('Computing history figure');
    fireEvent.click(correctAnswer);
    correctAnswer.focus();
    expect(correctAnswer).toBeChecked();
    expect(correctAnswer).toHaveFocus();
    fireEvent.keyDown(correctAnswer, { key: 'Enter', ctrlKey: true });
    expect(await screen.findByText('Score: 1/1')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/quiz-attempts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ pack_id: 'pack-1', selected_indices: [1] })
      })
    );
  });

  it('keeps focus and reduced-motion accessibility CSS checked in', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

    expect(css).toContain('.uw-skip-link');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('keeps mobile responsive layout guardrails checked in', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    const mobileCss = css.slice(css.indexOf('@media (max-width: 820px)'));

    expect(mobileCss).toContain('.uw-layout');
    expect(mobileCss).toContain('padding: 14px;');
    expect(mobileCss).toContain('.uw-graph-canvas');
    expect(mobileCss).toContain('min-height: min(76vh, 360px);');
    expect(mobileCss).toContain('.uw-node');
    expect(mobileCss).toContain('max-width: min(62vw, 220px);');
    expect(mobileCss).toContain('.uw-card-stack');
    expect(mobileCss).toContain('overflow: visible;');
    expect(mobileCss).toContain('.uw-grade');
    expect(mobileCss).toContain('position: static;');
    expect(mobileCss).toContain('.uw-ops-row');
    expect(mobileCss).toContain('.uw-ops-drilldown-row');
    expect(mobileCss).toContain('.uw-history-item span');
    expect(mobileCss).toContain('white-space: normal;');
  });

  it('keeps critical UI visual smoke landmarks covered', async () => {
    const states = [];
    const fetchMock = mockSuccessfulGeneration();

    render(React.createElement(StudyPackApp));
    await screen.findByRole('heading', { name: 'Turn source material into a navigable learning system.' });
    states.push(captureVisualSmokeState('empty'));

    fireEvent.change(screen.getByLabelText('Wikipedia topic or URL'), { target: { value: 'Ada Lovelace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    states.push(captureVisualSmokeState('overview'));
    expect(fetchMock).toHaveBeenCalledWith('/api/study-packs', expect.objectContaining({ method: 'POST' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Concepts' }));
    await screen.findByRole('heading', { level: 2, name: 'Concept Graph' });
    states.push(captureVisualSmokeState('concepts'));
    fireEvent.change(screen.getByLabelText('Search graph nodes and relationships'), {
      target: { value: 'no matching graph term' }
    });
    states.push(captureVisualSmokeState('concepts-empty'));

    fireEvent.click(screen.getByRole('tab', { name: 'Flashcards' }));
    await screen.findByRole('heading', { name: 'Learning Session' });
    states.push(captureVisualSmokeState('flashcards'));

    fireEvent.click(screen.getByRole('tab', { name: 'Quiz' }));
    await screen.findByRole('button', { name: 'Grade Quiz' });
    states.push(captureVisualSmokeState('quiz'));

    fireEvent.click(screen.getByRole('tab', { name: 'Learning' }));
    await screen.findByRole('heading', { name: 'Learning Dashboard' });
    states.push(captureVisualSmokeState('learning'));

    fireEvent.click(screen.getByRole('tab', { name: 'Ops' }));
    await screen.findByRole('heading', { name: 'SLO Targets' });
    states.push(captureVisualSmokeState('ops'));

    expect(states[0]).toEqual({
      name: 'empty',
      layoutClasses: ['uw-sidebar', 'uw-main', 'uw-right-rail'],
      activeTab: 'Overview',
      mainHeadings: ['Turn source material into a navigable learning system.'],
      rightRailHeadings: ['Generation', 'Export', 'Quality Feedback', 'Managed Share Links', 'Capacity', 'Batch Generation', 'Citation Stream', 'AI Ops', 'Cache'],
      signals: ['hero', 'citation-stream']
    });
    expect(states[1]).toMatchObject({
      name: 'overview',
      layoutClasses: ['uw-sidebar', 'uw-main', 'uw-right-rail'],
      activeTab: 'Overview',
      mainHeadings: expect.arrayContaining(['Ada Lovelace', 'beginner', 'Glossary', 'Learn Next']),
      rightRailHeadings: expect.arrayContaining(['Generation', 'Export', 'Citation Stream', 'AI Ops', 'Cache']),
      signals: expect.arrayContaining(['topic-head', 'citation-stream'])
    });
    expect(states[2]).toMatchObject({
      name: 'concepts',
      activeTab: 'Concepts',
      mainHeadings: expect.arrayContaining(['Ada Lovelace', 'Concept Graph', 'Evidence', 'Path Inspector', 'Relationships', 'Timeline Navigator']),
      signals: expect.arrayContaining(['topic-head', 'graph-shell', 'citation-stream'])
    });
    expect(states[3]).toMatchObject({
      name: 'concepts-empty',
      activeTab: 'Concepts',
      signals: expect.arrayContaining(['graph-shell', 'graph-empty', 'citation-stream'])
    });
    expect(states[4]).toMatchObject({
      name: 'flashcards',
      activeTab: 'Flashcards',
      mainHeadings: expect.arrayContaining(['Ada Lovelace', 'Learning Session', 'What machine did Ada Lovelace write notes about?']),
      signals: expect.arrayContaining(['topic-head', 'flashcard-deck', 'citation-stream'])
    });
    expect(states[5]).toMatchObject({
      name: 'quiz',
      activeTab: 'Quiz',
      mainHeadings: expect.arrayContaining(['Ada Lovelace', 'Which answer best describes Lovelace in this pack?']),
      signals: expect.arrayContaining(['topic-head', 'quiz-grade', 'citation-stream'])
    });
    expect(states[6]).toMatchObject({
      name: 'learning',
      activeTab: 'Learning',
      mainHeadings: expect.arrayContaining(['Ada Lovelace', 'Learning Dashboard', 'Study Goal', 'Due Reminder', 'Trend Chart', 'Review History', 'Weak Areas']),
      signals: expect.arrayContaining(['topic-head', 'learning-dashboard', 'citation-stream'])
    });
    expect(states[7]).toMatchObject({
      name: 'ops',
      activeTab: 'Ops',
      mainHeadings: expect.arrayContaining(['Ada Lovelace', 'Ops Dashboard', 'Local LLM Runtime', 'Prompt Evaluation', 'SLO Targets', 'Cost Drilldowns', 'Fallback And Errors', 'Security And Rate Limits', 'Reliability Inputs']),
      signals: expect.arrayContaining(['topic-head', 'ops-slo', 'citation-stream'])
    });
  });

  it('clears generation loading and shows an error when the network blocks generation', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/queue/status') {
        return jsonResponse(queueStatus);
      }
      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: false });
      }
      if (url === '/api/study-packs?limit=8') {
        return jsonResponse({ items: [] });
      }
      if (url === '/api/library?limit=8') {
        return jsonResponse({ items: [] });
      }
      if (url === '/api/learning/analytics') {
        return jsonResponse({ ...learningAnalytics, packs: [], total_cards: 0, reviewed_cards: 0, due_cards: 0, due_packs: 0 });
      }
      if (url === '/api/learning/reminders') {
        return jsonResponse({ ...learningReminder, due_cards: 0, due_packs: 0, packs: [] });
      }
      if (url === '/api/study-packs' && init?.method === 'POST') {
        throw new Error('network_unavailable');
      }
      return jsonResponse({ error: 'unexpected request' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(StudyPackApp));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByText('Could not start generation. Check the connection and try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate' })).not.toBeDisabled();
  });

  it('shows retryable rail errors when history, library, or capacity fetches fail', async () => {
    window.localStorage.setItem('ultrawiki_user_id', 'user-test');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: false });
      }
      if (url === '/api/learning/analytics') {
        return jsonResponse({ ...learningAnalytics, packs: [], total_cards: 0, reviewed_cards: 0, due_cards: 0, due_packs: 0 });
      }
      if (url === '/api/learning/reminders') {
        return jsonResponse({ ...learningReminder, due_cards: 0, due_packs: 0, packs: [] });
      }
      if (url === '/api/queue/status' || url === '/api/study-packs?limit=8' || url === '/api/library?limit=8') {
        return jsonResponse({ error: 'temporary_unavailable' }, 503);
      }
      return jsonResponse({ error: 'unexpected request' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(StudyPackApp));

    expect(await screen.findByText('Could not load recent packs.')).toBeInTheDocument();
    expect(screen.getByText('Could not load saved library.')).toBeInTheDocument();
    expect(screen.getByText('Could not load capacity status.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry recent packs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry saved library' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/library?limit=8',
      expect.objectContaining({ headers: { 'x-user-id': 'user-test' } })
    );
  });

  it('shows session account state and supports display-name save and logout', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/queue/status') {
        return jsonResponse(queueStatus);
      }
      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: true, source: 'session', user: sessionProfile });
      }
      if (url === '/api/study-packs?limit=8') {
        return jsonResponse({ items: [] });
      }
      if (url === '/api/library?limit=8') {
        return jsonResponse({ items: [] });
      }
      if (url === '/api/me' && init?.method === 'POST') {
        return jsonResponse({
          ...sessionProfile,
          display_name: 'Grace Hopper',
          updated_at: '2026-01-02T00:00:00.000Z'
        });
      }
      if (url === '/api/auth/logout' && init?.method === 'POST') {
        return jsonResponse({ authenticated: false });
      }
      return jsonResponse({ error: 'unexpected request' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(StudyPackApp));

    const account = (await screen.findByRole('heading', { name: 'Account' })).closest('section') as HTMLElement;
    await waitFor(() => expect(within(account).getByText('Session')).toBeInTheDocument());
    expect(within(account).getByText('Grace')).toBeInTheDocument();
    expect(within(account).getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/api/auth/login?redirect_path=/');

    fireEvent.change(within(account).getByLabelText('Display name'), { target: { value: 'Grace Hopper' } });
    fireEvent.click(within(account).getByRole('button', { name: 'Save display name' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/me',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ display_name: 'Grace Hopper' })
        })
      );
    });
    const profileSaveCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/me');
    expect((profileSaveCall?.[1] as RequestInit).headers).toEqual({ 'content-type': 'application/json' });
    expect(await within(account).findByDisplayValue('Grace Hopper')).toBeInTheDocument();

    fireEvent.click(within(account).getByRole('button', { name: 'Logout' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    });
    expect(await within(account).findByText('Library key')).toBeInTheDocument();
  });

  it('supports account data export and confirmed data deletion', async () => {
    const createObjectURL = vi.fn(() => 'blob:ultrawiki-user-data');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/queue/status') {
        return jsonResponse(queueStatus);
      }
      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: true, source: 'session', user: sessionProfile });
      }
      if (url === '/api/study-packs?limit=8') {
        return jsonResponse({ items: [] });
      }
      if (url === '/api/library?limit=8') {
        return jsonResponse({ items: [] });
      }
      if (url === '/api/learning/analytics') {
        return jsonResponse({ ...learningAnalytics, packs: [], total_cards: 0, reviewed_cards: 0, due_cards: 0, due_packs: 0 });
      }
      if (url === '/api/learning/reminders') {
        return jsonResponse({ ...learningReminder, due_cards: 0, due_packs: 0, packs: [] });
      }
      if (url === '/api/me/export') {
        return jsonResponse({
          user_id: sessionProfile.user_id,
          exported_at: '2026-01-02T00:00:00.000Z',
          profile: sessionProfile,
          library: [],
          shares: [],
          flashcard_reviews: [],
          learning_sessions: [],
          quiz_attempts: []
        });
      }
      if (url === '/api/me' && init?.method === 'DELETE') {
        return jsonResponse({
          user_id: sessionProfile.user_id,
          deleted_at: '2026-01-02T00:00:00.000Z',
          deleted: {
            profile: true,
            library: 0,
            shares: 0,
            flashcard_reviews: 0,
            learning_sessions: 0,
            quiz_attempts: 0,
            study_goals: 0
          }
        });
      }
      return jsonResponse({ error: 'unexpected request' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(StudyPackApp));

    const account = (await screen.findByRole('heading', { name: 'Account' })).closest('section') as HTMLElement;
    await waitFor(() => expect(within(account).getByText('Session')).toBeInTheDocument());

    fireEvent.click(within(account).getByRole('button', { name: 'Export data' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/me/export', { headers: {} });
    });
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:ultrawiki-user-data');

    fireEvent.click(within(account).getByRole('button', { name: 'Delete data' }));
    expect(within(account).getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument();
    fireEvent.click(within(account).getByRole('button', { name: 'Confirm delete' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/me', { method: 'DELETE', headers: {} });
    });
    expect(await within(account).findByText('None')).toBeInTheDocument();
  });

  it('generates a pack through mocked APIs and renders source, summaries, citations, and AI ops metadata', async () => {
    const fetchMock = await generateLoadedPack();

    expect(fetchMock).toHaveBeenCalledWith('/api/study-packs', expect.objectContaining({ method: 'POST' }));
    expect(screen.getByText('rev-ada-123')).toBeInTheDocument();
    expect(screen.getAllByText('94%')).toHaveLength(2);
    expect(screen.getAllByText('Ada Lovelace citation one')).not.toHaveLength(0);
    expect(screen.getAllByText('summary@1.0.0 / qwen2.5-14b')).not.toHaveLength(0);
    expect(screen.getByRole('heading', { level: 2, name: 'Glossary' })).toBeInTheDocument();
    expect(screen.getAllByText('Glossary citation one')).not.toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Learn Next' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Analytical Engine' })).toBeInTheDocument();
    expect(screen.getByText('hit / rev rev-ada-123')).toBeInTheDocument();
    expect(screen.getByText('Capacity')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent Packs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Markdown' })).toHaveAttribute('href', '/api/study-packs/pack-1/export?format=markdown');
    expect(screen.getByRole('link', { name: 'Anki CSV' })).toHaveAttribute('href', '/api/study-packs/pack-1/export?format=anki_csv');
  });

  it('filters and groups the citation stream by artifact type and search text', async () => {
    await generateLoadedPack();

    const stream = screen.getByLabelText('Citation stream');
    expect(within(stream).getByRole('heading', { name: 'Summaries' })).toBeInTheDocument();
    expect(within(stream).getByRole('heading', { name: 'Concept Graph' })).toBeInTheDocument();
    expect(within(stream).getByText('Edge citation')).toBeInTheDocument();
    expect(within(stream).getByText('15/15')).toBeInTheDocument();

    fireEvent.click(within(stream).getByRole('button', { name: 'Flashcards 2' }));
    expect(within(stream).getByText('2/15')).toBeInTheDocument();
    expect(within(stream).getByRole('heading', { name: 'Flashcards' })).toBeInTheDocument();
    expect(within(stream).getByText('Flashcard citation one')).toBeInTheDocument();
    expect(within(stream).queryByText('Quiz citation one')).not.toBeInTheDocument();

    fireEvent.change(within(stream).getByLabelText('Search citation stream'), { target: { value: 'two' } });
    expect(within(stream).getByText('1/15')).toBeInTheDocument();
    expect(within(stream).getByText('Flashcard citation two')).toBeInTheDocument();
    expect(within(stream).queryByText('Flashcard citation one')).not.toBeInTheDocument();

    fireEvent.click(within(stream).getByRole('button', { name: 'Quiz 1' }));
    expect(within(stream).getByText('No citations match the current filters.')).toBeInTheDocument();

    fireEvent.change(within(stream).getByLabelText('Search citation stream'), { target: { value: '' } });
    expect(within(stream).getByText('1/15')).toBeInTheDocument();
    expect(within(stream).getByText('Quiz citation one')).toBeInTheDocument();
  });

  it('shows partial pack actions and resumes missing artifacts', async () => {
    let resumeRequested = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/queue/status') {
        return jsonResponse(queueStatus);
      }

      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: false });
      }

      if (url === '/api/study-packs?limit=8') {
        return jsonResponse({ items: [] });
      }

      if (url === '/api/study-packs') {
        return jsonResponse({ pack_id: 'pack-1', job_id: 'job-1' });
      }

      if (url === '/api/jobs/job-1') {
        return jsonResponse({
          id: 'job-1',
          status: 'completed',
          stage: 'done',
          progress: 100,
          degradation_state: 'partial',
          degradation_reason: 'budget_or_time_exceeded_after_summaries'
        });
      }

      if (url === '/api/study-packs/pack-1/resume') {
        resumeRequested = true;
        return jsonResponse({ pack_id: 'pack-1', job_id: 'job-2' });
      }

      if (url === '/api/jobs/job-2') {
        return jsonResponse({ id: 'job-2', status: 'completed', stage: 'done', progress: 100 });
      }

      if (url === '/api/study-packs/pack-1') {
        return jsonResponse(resumeRequested ? studyPack : partialPack);
      }
      if (url === '/api/study-packs/pack-1/shares?limit=10') {
        return jsonResponse({ items: [] });
      }

      return jsonResponse({ error: 'unexpected request' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(StudyPackApp));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByLabelText('Partial pack actions')).toBeInTheDocument();
    expect(screen.getByText(/Missing: Graph, Glossary, Flashcards, Quiz/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resume missing artifacts' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/study-packs/pack-1/resume',
        expect.objectContaining({ method: 'POST' })
      );
    });
    await waitFor(() => expect(screen.queryByLabelText('Partial pack actions')).not.toBeInTheDocument());
  });

  it('shows an overview empty state when summaries are missing from a partial pack', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/queue/status') {
          return jsonResponse(queueStatus);
        }
        if (url === '/api/auth/session') {
          return jsonResponse({ authenticated: false });
        }
        if (url === '/api/study-packs?limit=8') {
          return jsonResponse({ items: [] });
        }
        if (url === '/api/library?limit=8') {
          return jsonResponse({ items: [] });
        }
        if (url === '/api/learning/analytics') {
          return jsonResponse({ ...learningAnalytics, packs: [], total_cards: 0, reviewed_cards: 0, due_cards: 0, due_packs: 0 });
        }
        if (url === '/api/learning/reminders') {
          return jsonResponse({ ...learningReminder, due_cards: 0, due_packs: 0, packs: [] });
        }
        if (url === '/api/study-packs') {
          return jsonResponse({ pack_id: 'pack-1', job_id: 'job-1' });
        }
        if (url === '/api/jobs/job-1') {
          return jsonResponse({ id: 'job-1', status: 'completed', stage: 'done', progress: 100 });
        }
        if (url === '/api/study-packs/pack-1') {
          return jsonResponse(summaryMissingPack);
        }
        if (url === '/api/study-packs/pack-1/shares?limit=10') {
          return jsonResponse({ items: [] });
        }
        return jsonResponse({ error: 'unexpected request' }, 404);
      })
    );

    render(React.createElement(StudyPackApp));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByText('No summaries are available for this pack yet. Resume missing artifacts when the source is ready.')).toBeInTheDocument();
    expect(screen.getByText('Summary artifact is not available yet.')).toBeInTheDocument();
  });

  it('starts a new pack from a learn-next recommendation', async () => {
    const fetchMock = await generateLoadedPack();

    fireEvent.click(screen.getByRole('button', { name: 'Study Analytical Engine next' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/study-packs',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"title_or_url":"Analytical Engine"')
        })
      );
    });
    expect(screen.getByLabelText('Wikipedia topic or URL')).toHaveValue('Analytical Engine');
  });

  it('loads a recent pack from session history', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/queue/status') {
        return jsonResponse(queueStatus);
      }
      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: false });
      }
      if (url === '/api/study-packs?limit=8') {
        return jsonResponse({
          items: [
            {
              id: 'pack-1',
              input: 'Ada Lovelace',
              source_revision_id: 'rev-ada-123',
              created_at: '2026-01-01T00:00:00.000Z',
              latest_job: null,
              readiness: studyPack.readiness
            }
          ]
        });
      }
      if (url === '/api/study-packs/pack-1') {
        return jsonResponse(studyPack);
      }
      if (url === '/api/study-packs/pack-1/shares?limit=10') {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({ error: 'unexpected request' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(StudyPackApp));
    const recent = (await screen.findByRole('heading', { name: 'Recent Packs' })).closest('section') as HTMLElement;
    fireEvent.click(within(recent).getByRole('button', { name: /Ada Lovelace/ }));

    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/study-packs/pack-1');
  });

  it('loads and saves packs through the cross-device saved library', async () => {
    window.localStorage.setItem('ultrawiki_user_id', 'user-shared');
    let organization = { tags: ['history'], collection: 'Computing' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/queue/status') {
        return jsonResponse(queueStatus);
      }
      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: false });
      }
      if (url === '/api/study-packs?limit=8') {
        return jsonResponse({ items: [] });
      }
      if (url === '/api/library?limit=8') {
        return jsonResponse({
          items: [
            {
              id: 'pack-1',
              input: 'Ada Lovelace',
              source_revision_id: 'rev-ada-123',
              created_at: '2026-01-01T00:00:00.000Z',
              latest_job: null,
              readiness: studyPack.readiness,
              organization
            }
          ]
        });
      }
      if (url === '/api/study-packs/pack-1') {
        return jsonResponse(studyPack);
      }
      if (url === '/api/study-packs/pack-1/save') {
        return jsonResponse({ pack_id: 'pack-1', saved: true, saved_at: '2026-01-01T00:00:00.000Z' });
      }
      if (url === '/api/library/pack-1/organization') {
        organization = { tags: ['math', 'history'], collection: 'STEM' };
        return jsonResponse({ pack_id: 'pack-1', organization });
      }
      if (url === '/api/library/pack-1/versions?limit=8') {
        return jsonResponse({
          current: {
            id: 'pack-1',
            input: 'Ada Lovelace',
            source_revision_id: 'rev-ada-123',
            created_at: '2026-01-01T00:00:00.000Z',
            saved_at: '2026-01-02T00:00:00.000Z',
            latest_job: null,
            readiness: studyPack.readiness,
            organization,
            current: true,
            source_revision_changed: false,
            artifact_counts: {
              summaries: 3,
              glossary: 1,
              flashcards: 2,
              quiz_questions: 1,
              graph_nodes: 3,
              graph_edges: 1,
              timeline_events: 2
            }
          },
          versions: [
            {
              id: 'pack-1',
              input: 'Ada Lovelace',
              source_revision_id: 'rev-ada-123',
              created_at: '2026-01-01T00:00:00.000Z',
              saved_at: '2026-01-02T00:00:00.000Z',
              latest_job: null,
              readiness: studyPack.readiness,
              organization,
              current: true,
              source_revision_changed: false,
              artifact_counts: {
                summaries: 3,
                glossary: 1,
                flashcards: 2,
                quiz_questions: 1,
                graph_nodes: 3,
                graph_edges: 1,
                timeline_events: 2
              }
            },
            {
              id: 'pack-0',
              input: 'Ada Lovelace',
              source_revision_id: 'rev-ada-001',
              created_at: '2025-12-31T00:00:00.000Z',
              saved_at: '2026-01-01T00:00:00.000Z',
              latest_job: null,
              readiness: studyPack.readiness,
              current: false,
              source_revision_changed: true,
              artifact_counts: {
                summaries: 3,
                glossary: 1,
                flashcards: 1,
                quiz_questions: 1,
                graph_nodes: 3,
                graph_edges: 1,
                timeline_events: 2
              }
            }
          ],
          compare: {
            baseline_pack_id: 'pack-0',
            baseline_source_revision_id: 'rev-ada-001',
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
      }
      if (url === '/api/study-packs/pack-1/shares?limit=10') {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({ error: 'unexpected request' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(StudyPackApp));
    const library = (await screen.findByRole('heading', { name: 'Saved Library' })).closest('section') as HTMLElement;
    expect(within(library).getByLabelText('Library key')).toHaveValue('user-shared');
    fireEvent.click(within(library).getByRole('button', { name: /Ada Lovelace/ }));

    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    const loadedLibrary = screen.getByRole('heading', { name: 'Saved Library' }).closest('section') as HTMLElement;
    const versionHistory = within(loadedLibrary).getByLabelText('Pack version history');
    await waitFor(() => expect(within(versionHistory).getByText('2 versions')).toBeInTheDocument());
    expect(within(versionHistory).getByText('Source changed')).toBeInTheDocument();
    expect(within(versionHistory).getByText('+1 cards')).toBeInTheDocument();
    fireEvent.change(within(loadedLibrary).getByLabelText('Current pack collection'), { target: { value: 'STEM' } });
    fireEvent.change(within(loadedLibrary).getByLabelText('Current pack tags'), { target: { value: 'Math, history, math' } });
    fireEvent.click(within(loadedLibrary).getByRole('button', { name: 'Save pack organization' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/library/pack-1/organization',
        expect.objectContaining({
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            'x-user-id': 'user-shared'
          },
          body: JSON.stringify({ tags: ['Math', 'history', 'math'], collection: 'STEM' })
        })
      );
    });
    expect(await within(loadedLibrary).findByText('Organization saved.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save current pack' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/study-packs/pack-1/save',
        expect.objectContaining({
          method: 'POST',
          headers: { 'x-user-id': 'user-shared' }
        })
      );
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/library?limit=8',
      expect.objectContaining({ headers: { 'x-user-id': 'user-shared' } })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/library/pack-1/versions?limit=8',
      expect.objectContaining({ headers: { 'x-user-id': 'user-shared' } })
    );
  });

  it('recovers when saving saved-pack organization fails', async () => {
    window.localStorage.setItem('ultrawiki_user_id', 'user-shared');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/queue/status') {
        return jsonResponse(queueStatus);
      }
      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: false });
      }
      if (url === '/api/study-packs?limit=8') {
        return jsonResponse({ items: [] });
      }
      if (url === '/api/library?limit=8') {
        return jsonResponse({
          items: [
            {
              id: 'pack-1',
              input: 'Ada Lovelace',
              source_revision_id: 'rev-ada-123',
              created_at: '2026-01-01T00:00:00.000Z',
              latest_job: null,
              readiness: studyPack.readiness,
              organization: { tags: ['history'], collection: 'Computing' }
            }
          ]
        });
      }
      if (url === '/api/study-packs/pack-1') {
        return jsonResponse(studyPack);
      }
      if (url === '/api/library/pack-1/organization') {
        throw new Error('organization save failed');
      }
      if (url === '/api/study-packs/pack-1/shares?limit=10') {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({ error: 'unexpected request' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(StudyPackApp));
    const library = (await screen.findByRole('heading', { name: 'Saved Library' })).closest('section') as HTMLElement;
    fireEvent.click(within(library).getByRole('button', { name: /Ada Lovelace/ }));

    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    const loadedLibrary = screen.getByRole('heading', { name: 'Saved Library' }).closest('section') as HTMLElement;
    fireEvent.change(within(loadedLibrary).getByLabelText('Current pack collection'), { target: { value: 'STEM' } });
    fireEvent.click(within(loadedLibrary).getByRole('button', { name: 'Save pack organization' }));

    expect(await within(loadedLibrary).findByText('Could not save pack organization.')).toBeInTheDocument();
    expect(within(loadedLibrary).getByRole('button', { name: 'Save pack organization' })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/library/pack-1/organization',
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('searches and filters the saved library with progress facets', async () => {
    window.localStorage.setItem('ultrawiki_user_id', 'user-shared');
    const emptyLearning = { ...learningAnalytics, packs: [], total_cards: 0, reviewed_cards: 0, due_cards: 0, due_packs: 0 };
    const defaultLibrary = {
      items: [
        {
          id: 'pack-1',
          input: 'Ada Complete',
          source_revision_id: 'rev-ada-123',
          created_at: '2026-01-01T00:00:00.000Z',
          latest_job: null,
          readiness: studyPack.readiness,
          organization: { tags: ['math', 'history'], collection: 'STEM' },
          progress: { total_cards: 2, reviewed_cards: 1, due_cards: 1, mastery_score: 0.375 }
        },
        {
          id: 'pack-2',
          input: 'Grace Reviewed',
          source_revision_id: 'rev-grace-123',
          created_at: '2026-01-02T00:00:00.000Z',
          latest_job: null,
          readiness: studyPack.readiness,
          organization: { tags: ['history'], collection: 'Computing' },
          progress: { total_cards: 1, reviewed_cards: 1, due_cards: 0, mastery_score: 1 }
        }
      ],
      facets: {
        total: 2,
        readiness: { full: 2, partial: 0 },
        progress: { due: 1, reviewed: 2, not_started: 0 },
        tags: [
          { tag: 'history', count: 2 },
          { tag: 'math', count: 1 }
        ],
        collections: [
          { collection: 'Computing', count: 1 },
          { collection: 'STEM', count: 1 }
        ]
      }
    };
    const filteredLibrary = {
      items: [defaultLibrary.items[0]],
      facets: {
        total: 1,
        readiness: { full: 1, partial: 0 },
        progress: { due: 1, reviewed: 1, not_started: 0 },
        tags: [
          { tag: 'history', count: 1 },
          { tag: 'math', count: 1 }
        ],
        collections: [{ collection: 'STEM', count: 1 }]
      }
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/queue/status') {
        return jsonResponse(queueStatus);
      }
      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: false });
      }
      if (url === '/api/study-packs?limit=8') {
        return jsonResponse({ items: [] });
      }
      if (url === '/api/learning/analytics') {
        return jsonResponse(emptyLearning);
      }
      if (url === '/api/learning/reminders') {
        return jsonResponse({ ...learningReminder, due_cards: 0, due_packs: 0, packs: [] });
      }
      if (url === '/api/library?limit=8') {
        return jsonResponse(defaultLibrary);
      }
      if (url.startsWith('/api/library?limit=8&')) {
        return jsonResponse(filteredLibrary);
      }
      return jsonResponse({ error: 'unexpected request' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(StudyPackApp));

    const library = (await screen.findByRole('heading', { name: 'Saved Library' })).closest('section') as HTMLElement;
    await waitFor(() => expect(within(library).getByText('Grace Reviewed')).toBeInTheDocument());
    expect(within(library).getByLabelText('Library facets')).toHaveTextContent('2 total');

    fireEvent.change(within(library).getByLabelText('Search saved library'), { target: { value: 'ada' } });
    fireEvent.change(within(library).getByLabelText('Library readiness filter'), { target: { value: 'full' } });
    fireEvent.change(within(library).getByLabelText('Library progress filter'), { target: { value: 'due' } });
    fireEvent.change(within(library).getByLabelText('Library tag filter'), { target: { value: 'math' } });
    fireEvent.change(within(library).getByLabelText('Library collection filter'), { target: { value: 'STEM' } });
    fireEvent.change(within(library).getByLabelText('Library sort'), { target: { value: 'title_asc' } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/library?limit=8&q=ada&readiness=full&progress=due&tag=math&collection=STEM&sort=title_asc',
        expect.objectContaining({ headers: { 'x-user-id': 'user-shared' } })
      );
    });
    expect(within(library).getByText('Ada Complete')).toBeInTheDocument();
    expect(within(library).queryByText('Grace Reviewed')).not.toBeInTheDocument();
    expect(within(library).getByText('1/2 reviewed, 1 due, 38% mastery')).toBeInTheDocument();
    expect(within(library).getByText('Collection: STEM')).toBeInTheDocument();
    expect(within(library).getByText('Tags: math, history')).toBeInTheDocument();
    expect(within(library).getByLabelText('Library facets')).toHaveTextContent('1 due');

    fireEvent.click(within(library).getByRole('button', { name: 'Reset library filters' }));

    await waitFor(() => {
      expect(within(library).getByLabelText('Search saved library')).toHaveValue('');
      expect(within(library).getByLabelText('Library readiness filter')).toHaveValue('all');
      expect(within(library).getByLabelText('Library progress filter')).toHaveValue('all');
      expect(within(library).getByLabelText('Library tag filter')).toHaveValue('all');
      expect(within(library).getByLabelText('Library collection filter')).toHaveValue('all');
      expect(within(library).getByLabelText('Library sort')).toHaveValue('saved_desc');
    });
  });

  it('creates a viewer share link for the loaded pack', async () => {
    window.localStorage.setItem('ultrawiki_user_id', 'user-test');
    const fetchMock = await generateLoadedPack();

    fireEvent.click(screen.getByRole('button', { name: 'Create share link' }));

    expect(await screen.findAllByText(/\/shared\/share-1/)).not.toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/study-packs/pack-1/share',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': 'user-test'
        },
        body: JSON.stringify({ role: 'viewer' })
      })
    );
  });

  it('lists, copies, inspects, and revokes owner share links', async () => {
    window.localStorage.setItem('ultrawiki_user_id', 'user-test');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    const fetchMock = await generateLoadedPack();

    expect(await screen.findByRole('heading', { name: 'Managed Share Links' })).toBeInTheDocument();
    expect(await screen.findByText('share-2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy share link share-2' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/shared\/share-2$/)));
    expect(screen.getByRole('button', { name: 'Copy share link share-2' })).toHaveTextContent('Copied');

    fireEvent.click(screen.getByRole('button', { name: 'Inspect share link share-2' }));
    const inspector = screen.getByLabelText('Selected share details');
    expect(within(inspector).getByText('user-test')).toBeInTheDocument();
    expect(within(inspector).getByText('/api/shared/share-2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke share link share-2' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/study-packs/pack-1/shares/share-2',
        expect.objectContaining({
          method: 'DELETE',
          headers: { 'x-user-id': 'user-test' }
        })
      );
    });
    await waitFor(() => expect(screen.queryByText('share-2')).not.toBeInTheDocument());
  });

  it('submits generation quality feedback as untrusted eval-candidate data', async () => {
    window.localStorage.setItem('ultrawiki_user_id', 'user-test');
    const fetchMock = await generateLoadedPack();

    expect(screen.getByRole('heading', { name: 'Quality Feedback' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Feedback artifact'), { target: { value: 'quiz' } });
    fireEvent.change(screen.getByLabelText('Feedback signal'), { target: { value: 'incorrect' } });
    fireEvent.change(screen.getByLabelText('Feedback rating'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Feedback comment'), { target: { value: 'Answer key looked wrong.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    expect(await screen.findByText('Feedback saved for review.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/study-packs/pack-1/feedback',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-user-id': 'user-test'
        }),
        body: JSON.stringify({
          artifact_type: 'quiz',
          artifact_id: 'question-0',
          rating: 2,
          signal: 'incorrect',
          comment: 'Answer key looked wrong.',
          prompt_version: 'quiz@1.0.0',
          model: 'qwen2.5-14b'
        })
      })
    );
  });

  it('filters concept nodes by taxonomy type', async () => {
    await generateLoadedPack();

    fireEvent.click(screen.getByRole('tab', { name: 'Concepts' }));
    expect(screen.getByText('3 visible nodes, 1 relationships.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'person' }));

    expect(screen.getByText('1 visible nodes, 1 relationships.')).toBeInTheDocument();
    expect(screen.getAllByText('Ada Lovelace')).not.toHaveLength(0);
  });

  it('supports concept graph evidence selection and view controls', async () => {
    await generateLoadedPack();

    fireEvent.click(screen.getByRole('tab', { name: 'Concepts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));

    expect(screen.getByText('Zoom 125%')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Timeline Navigator' })).toBeInTheDocument();
    expect(screen.getByLabelText('Timeline year scrubber')).toBeInTheDocument();
    expect(screen.getByLabelText('Timeline year clusters')).toBeInTheDocument();
    expect(screen.getByLabelText('Selected timeline event')).toHaveTextContent('1833');

    fireEvent.click(screen.getByRole('button', { name: 'Inspect relationship Ada Lovelace Related To Analytical Engine' }));
    const evidence = screen.getByLabelText('Selected evidence');

    expect(within(evidence).getByText('Relationship')).toBeInTheDocument();
    expect(within(evidence).getByText('Ada Lovelace -> Analytical Engine')).toBeInTheDocument();
    expect(within(evidence).getByText('Edge citation')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Inspect timeline event 1843' }));
    expect(within(evidence).getByText('Timeline')).toBeInTheDocument();
    expect(within(evidence).getByText('Timeline citation')).toBeInTheDocument();
    expect(screen.getByLabelText('Selected timeline event')).toHaveTextContent('Lovelace notes were published.');
  });

  it('searches concept graph relations and shows the path inspector', async () => {
    await generateLoadedPack();

    fireEvent.click(screen.getByRole('tab', { name: 'Concepts' }));
    fireEvent.change(screen.getByLabelText('Search graph nodes and relationships'), {
      target: { value: 'Analytical' }
    });

    expect(screen.getByText('2 visible nodes, 1 relationships.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Path Inspector' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Related To' }));
    expect(screen.getByText('2 visible nodes, 1 relationships.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search graph nodes and relationships'), {
      target: { value: 'no matching graph term' }
    });

    expect(screen.getByText('0 visible nodes, 0 relationships.')).toBeInTheDocument();
    expect(screen.getByText('No concept nodes match the current graph filters.')).toBeInTheDocument();
    expect(screen.getByText('No relationships match the current graph filters.')).toBeInTheDocument();
  });

  it('supports flashcard review and persisted quiz attempt scoring', async () => {
    const fetchMock = await generateLoadedPack();

    fireEvent.click(screen.getByRole('tab', { name: 'Flashcards' }));
    expect(screen.getByRole('heading', { name: 'What machine did Ada Lovelace write notes about?' })).toBeInTheDocument();
    expect(screen.getByText('They described procedures for a general-purpose machine.')).toBeInTheDocument();
    expect(screen.getAllByText('0/2').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Mark card 1 good' }));

    await waitFor(() => expect(screen.getAllByText('1/2').length).toBeGreaterThan(0));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/study-packs/pack-1/flashcards/0/reviews',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ rating: 'good' })
      })
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Quiz' }));
    const quizRegion = screen.getByRole('tabpanel', { name: 'Quiz' });
    fireEvent.click(within(quizRegion).getByLabelText('Computing history figure'));
    fireEvent.click(screen.getByRole('button', { name: 'Grade Quiz' }));

    expect(await screen.findByText('Score: 1/1')).toBeInTheDocument();
    expect(screen.getByText('Saved attempt 1')).toBeInTheDocument();
    expect(screen.getByText('Accuracy trend 0%')).toBeInTheDocument();
    expect(screen.getByText('Mastery trend +13%')).toBeInTheDocument();
    expect(screen.getByLabelText('Quiz attempt history')).toHaveTextContent('Attempt 1');
    expect(screen.getByText(/Correct\./)).toBeInTheDocument();
    expect(screen.getByText('Misconception checks')).toBeInTheDocument();
    expect(screen.getByText(/Computing history figure is the cited answer/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/quiz-attempts',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-user-id': expect.stringMatching(/^user-/) }),
        body: JSON.stringify({ pack_id: 'pack-1', selected_indices: [1] })
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retake Quiz' }));
    expect(screen.getByText('Select answers, then save the attempt.')).toBeInTheDocument();
  });

  it('runs an ordered due-card learning session to completion', async () => {
    window.localStorage.setItem('ultrawiki_user_id', 'user-test');
    const fetchMock = await generateLoadedPack();

    fireEvent.click(screen.getByRole('tab', { name: 'Flashcards' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start due-card session' }));

    expect(await screen.findByText('Card 1 of 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Learning session')).toHaveTextContent('Remaining');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/study-packs/pack-1/learning-session',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-user-id': 'user-test' }),
        body: JSON.stringify({ baseline_due_cards: 2, baseline_mastery_score: 0 })
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mark card 1 good' }));

    expect(await screen.findByText('Card 2 of 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Learning session')).toHaveTextContent('1/2');
    expect(screen.getByLabelText('Learning session')).toHaveTextContent('+75%');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/study-packs/pack-1/learning-session?session_id=session-1',
      expect.objectContaining({ headers: { 'x-user-id': 'user-test' } })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mark card 2 easy' }));

    expect(await screen.findByText('No due cards remain.')).toBeInTheDocument();
    expect(screen.getByLabelText('Learning session')).toHaveTextContent('2/2');
    expect(screen.getByLabelText('Learning session')).toHaveTextContent('+88%');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/study-packs/pack-1/flashcards/1/reviews',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ rating: 'easy' })
      })
    );
  });

  it('shows a learning-session error and clears loading when the session request fails', async () => {
    window.localStorage.setItem('ultrawiki_user_id', 'user-test');
    const fetchMock = await generateLoadedPack();
    const originalFetch = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/study-packs/pack-1/learning-session' && init?.method === 'POST') {
        throw new Error('network_unavailable');
      }
      return originalFetch ? originalFetch(input, init) : jsonResponse({ error: 'unexpected request' }, 404);
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Flashcards' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start due-card session' }));

    expect(await screen.findByText('Could not load learning session.')).toBeInTheDocument();
    expect(screen.queryByText('Loading session...')).not.toBeInTheDocument();
  });

  it('shows a learning-session error when the post-review session refresh fails', async () => {
    window.localStorage.setItem('ultrawiki_user_id', 'user-test');
    const fetchMock = await generateLoadedPack();

    fireEvent.click(screen.getByRole('tab', { name: 'Flashcards' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start due-card session' }));
    expect(await screen.findByText('Card 1 of 2')).toBeInTheDocument();

    const originalFetch = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/study-packs/pack-1/learning-session?session_id=session-1') {
        throw new Error('network_unavailable');
      }
      return originalFetch ? originalFetch(input, init) : jsonResponse({ error: 'unexpected request' }, 404);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Mark card 1 good' }));

    expect(await screen.findByText('Could not load learning session.')).toBeInTheDocument();
    expect(screen.queryByText('Loading session...')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/study-packs/pack-1/learning-session?session_id=session-1',
      expect.objectContaining({ headers: { 'x-user-id': 'user-test' } })
    );
  });

  it('shows server-side invalid quiz attempt payload errors', async () => {
    await generateLoadedPack({
      status: 400,
      body: { error: 'invalid_attempt_payload', reason: 'expected 1 answers' }
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Quiz' }));
    const quizRegion = screen.getByRole('tabpanel', { name: 'Quiz' });
    fireEvent.click(within(quizRegion).getByLabelText('Computing history figure'));
    fireEvent.click(screen.getByRole('button', { name: 'Grade Quiz' }));

    expect(await screen.findByText('Quiz submission was rejected: expected 1 answers.')).toBeInTheDocument();
    expect(screen.queryByText(/Correct\./)).not.toBeInTheDocument();
  });

  it('shows quiz-not-ready persistence errors', async () => {
    await generateLoadedPack({
      status: 409,
      body: { error: 'quiz_not_ready' }
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Quiz' }));
    const quizRegion = screen.getByRole('tabpanel', { name: 'Quiz' });
    fireEvent.click(within(quizRegion).getByLabelText('Computing history figure'));
    fireEvent.click(screen.getByRole('button', { name: 'Grade Quiz' }));

    expect(await screen.findByText('Quiz is not ready yet. Generate or reload the study pack before submitting an attempt.')).toBeInTheDocument();
  });

  it('loads the learning dashboard with due cards, trends, review history, and weak areas', async () => {
    window.localStorage.setItem('ultrawiki_user_id', 'user-test');
    const fetchMock = await generateLoadedPack();

    fireEvent.click(screen.getByRole('tab', { name: 'Learning' }));

    expect(await screen.findByRole('heading', { name: 'Learning Dashboard' })).toBeInTheDocument();
    const dashboard = screen.getByLabelText('Learning dashboard');
    expect(within(dashboard).getByText('Due cards')).toBeInTheDocument();
    expect(within(dashboard).getByText('1 packs due')).toBeInTheDocument();
    expect(within(dashboard).getByText('Study Goal')).toBeInTheDocument();
    expect(within(dashboard).getByLabelText('Study goal')).toHaveTextContent('1 of 2 reviews today.');
    expect(within(dashboard).getByText('Due Reminder')).toBeInTheDocument();
    expect(within(dashboard).getByLabelText('Due reminder')).toHaveTextContent('1 cards / 1 packs');
    expect(within(dashboard).getByLabelText('Due reminder')).toHaveTextContent('External notifications');
    expect(within(dashboard).getByLabelText('Due reminder')).toHaveTextContent('Off');
    fireEvent.change(within(dashboard).getByLabelText('Daily review target'), { target: { value: '4' } });
    fireEvent.click(within(dashboard).getByRole('button', { name: 'Save goal' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/learning/goal',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({ 'content-type': 'application/json', 'x-user-id': 'user-test' }),
          body: JSON.stringify({ daily_target_reviews: 4 })
        })
      );
    });
    expect(within(dashboard).getByText('Trend Chart')).toBeInTheDocument();
    expect(within(dashboard).getByText('Accuracy Trend')).toBeInTheDocument();
    expect(within(dashboard).getByText('Attempt 2')).toBeInTheDocument();
    expect(within(dashboard).getByText('Mastery Trend')).toBeInTheDocument();
    expect(within(dashboard).getByText('Review History')).toBeInTheDocument();
    expect(within(dashboard).getByLabelText('Review history')).toHaveTextContent('pack-1');
    expect(within(dashboard).getByText('Weak Areas')).toBeInTheDocument();
    expect(within(dashboard).getByLabelText('Weak areas')).toHaveTextContent('1 due / 38% mastery');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/learning/analytics',
      expect.objectContaining({ headers: { 'x-user-id': 'user-test' } })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/learning/reminders',
      expect.objectContaining({ headers: { 'x-user-id': 'user-test' } })
    );
  });

  it('loads the frontend ops dashboard on demand', async () => {
    const fetchMock = await generateLoadedPack();

    fireEvent.click(screen.getByRole('tab', { name: 'Ops' }));

    expect(await screen.findByRole('heading', { name: 'Ops Dashboard' })).toBeInTheDocument();
    expect(screen.getAllByText('80%').length).toBeGreaterThan(0);
    expect(screen.getByText('$0.1234')).toBeInTheDocument();
    expect(screen.getByText('SLO Targets')).toBeInTheDocument();
    expect(screen.getByLabelText('SLO status')).toHaveTextContent('Fail');
    expect(screen.getByLabelText('Job success rate target')).toHaveTextContent('Target >= 99%');
    expect(screen.getByLabelText('Job success rate error budget burn')).toHaveTextContent('19.00x budget burn');
    expect(screen.getByLabelText('Citation coverage rate status')).toHaveTextContent('Pass');
    expect(screen.getByText('Cost Drilldowns')).toBeInTheDocument();
    expect(screen.getByLabelText('Cost drilldowns')).toHaveTextContent('summary-by-level@1.0.0');
    expect(screen.getByRole('link', { name: 'Export cost summary CSV' })).toHaveAttribute('href', '/api/analytics/costs?window_hours=24&format=csv');
    expect(screen.getByRole('link', { name: 'Export cost drilldown CSV' })).toHaveAttribute('href', '/api/analytics/costs/drilldown?window_hours=24&limit=25&format=csv');
    expect(screen.getByLabelText('Cost drilldown filters')).toBeInTheDocument();
    expect(screen.getByLabelText('Filtered cost totals')).toHaveTextContent('4');
    expect(screen.getByLabelText('Filtered cost drilldown rows')).toHaveTextContent('local-rule-based');
    expect(screen.getByLabelText('Local LLM runtime health')).toHaveTextContent('Openai Compatible');
    expect(screen.getByLabelText('Local LLM runtime health')).toHaveTextContent('qwen2.5-14b-instruct-q4_k_m');
    expect(screen.getByLabelText('Local LLM runtime health')).toHaveTextContent('Degraded');
    expect(screen.getByLabelText('Local LLM runtime health')).toHaveTextContent('Timeouts recorded');
    expect(screen.getByLabelText('Local LLM runtime health')).toHaveTextContent('OpenAI with rule-based fallback');
    expect(screen.getByLabelText('Runtime preset selection')).toHaveValue('rtx4080_qwen14b_safe');
    expect(screen.getByLabelText('Runtime preset selection')).toBeDisabled();
    expect(screen.getByLabelText('Runtime preset matrix')).toHaveTextContent('rtx4080_qwen14b_safe');
    expect(screen.getByLabelText('Runtime preset matrix')).toHaveTextContent('rtx4080_qwen14b_balanced');
    expect(screen.getByLabelText('Runtime preset matrix')).toHaveTextContent('Selected');
    expect(screen.getByLabelText('Local LLM runtime stage health')).toHaveTextContent('Summaries');
    expect(screen.getByLabelText('Local LLM runtime stage health')).toHaveTextContent('2,400 ms p95');
    expect(screen.getByLabelText('Prompt evaluation results')).toHaveTextContent('Prompt Evaluation');
    expect(screen.getByLabelText('Prompt evaluation results')).toHaveTextContent('6/6 passed');
    expect(screen.getByLabelText('Prompt evaluation results')).toHaveTextContent('summary-by-level@1.0.0');
    expect(screen.getByLabelText('Prompt evaluation results')).toHaveTextContent('summary-by-level@1.1.0');
    expect(screen.getByLabelText('Prompt evaluation results')).toHaveTextContent('User feedback');
    expect(screen.getByLabelText('Prompt regression topic results')).toHaveTextContent('Alan Turing');
    expect(screen.getByLabelText('Golden-set topic failures')).toHaveTextContent('No golden-set topic failures.');
    expect(screen.getByLabelText('User feedback eval candidates')).toHaveTextContent('Quiz');
    expect(screen.getByLabelText('User feedback eval candidates')).toHaveTextContent('1 feedback');
    expect(screen.getByLabelText('User feedback eval candidates')).toHaveTextContent('Incorrect 1');
    expect(screen.getByText('Fallback And Errors')).toBeInTheDocument();
    expect(screen.getByLabelText('Fallback and error tables')).toHaveTextContent('Invalid Response');
    expect(screen.getByLabelText('Security and rate-limit metrics')).toHaveTextContent('1');
    expect(screen.getByLabelText('Security event categories')).toHaveTextContent('Rate Limit');
    expect(screen.getByLabelText('Rate-limit event sources')).toHaveTextContent('rate_limit.exceeded');
    expect(screen.getByLabelText('Security event types')).toHaveTextContent('share.read_failed');
    expect(screen.getByLabelText('Cache invalidation controls')).toHaveTextContent('Source cache');
    expect(screen.getByLabelText('Cache invalidation controls')).toHaveTextContent('Repair candidates');
    expect(screen.getByLabelText('Cache invalidation controls')).toHaveTextContent('3');
    expect(screen.getByLabelText('Stale artifact cache candidates')).toHaveTextContent('summary@1.0.0');
    expect(screen.getByLabelText('Stale source cache candidates')).toHaveTextContent('Old Topic');
    expect(screen.getByRole('link', { name: 'Open runbook for Ops Dashboard' })).toHaveAttribute('href', '/runbooks/outcomes-slo-alerts#ops-dashboard-overview');
    expect(screen.getByRole('link', { name: 'Open runbook for SLO Targets' })).toHaveAttribute('href', '/runbooks/outcomes-slo-alerts#slo-targets');
    expect(screen.getByRole('link', { name: 'Open runbook for Cost Drilldowns' })).toHaveAttribute('href', '/runbooks/outcomes-slo-alerts#cost-drilldowns');
    expect(screen.getByRole('link', { name: 'Open runbook for Local LLM Runtime' })).toHaveAttribute('href', '/runbooks/outcomes-slo-alerts#reliability-inputs');
    expect(screen.getByRole('link', { name: 'Open runbook for Fallback And Errors' })).toHaveAttribute('href', '/runbooks/outcomes-slo-alerts#fallback-and-errors');
    expect(screen.getByRole('link', { name: 'Open runbook for Security And Rate Limits' })).toHaveAttribute('href', '/runbooks/outcomes-slo-alerts#security-and-rate-limits');
    expect(screen.getByRole('link', { name: 'Open runbook for Cache Invalidation' })).toHaveAttribute('href', '/runbooks/outcomes-slo-alerts#reliability-inputs');
    expect(screen.getByRole('link', { name: 'Open runbook for Reliability Inputs' })).toHaveAttribute('href', '/runbooks/outcomes-slo-alerts#reliability-inputs');
    expect(screen.getByLabelText('Ops time window')).toHaveValue('24');
    expect(fetchMock).toHaveBeenCalledWith('/api/analytics/outcomes?window_hours=24');
    expect(fetchMock).toHaveBeenCalledWith('/api/analytics/costs?window_hours=24');
    expect(fetchMock).toHaveBeenCalledWith('/api/analytics/costs/drilldown?window_hours=24&limit=25');
    expect(fetchMock).toHaveBeenCalledWith('/api/analytics/slo?window_hours=24');
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime/llm/health');
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime/llm/presets');
    expect(fetchMock).toHaveBeenCalledWith('/api/evaluation/prompts');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/cache',
      expect.objectContaining({
        headers: { 'x-user-id': expect.stringMatching(/^user-/) }
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Repair stale cache artifacts' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/cache/invalidate',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-user-id': expect.stringMatching(/^user-/)
          },
          body: JSON.stringify({
            target: 'expired',
            dry_run: false,
            reason: 'ops_stale_artifact_repair'
          })
        })
      );
    });
    expect(await screen.findByText('Deleted 3 of 3 matched cache entries.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Ops time window'), { target: { value: '168' } });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/analytics/outcomes?window_hours=168');
      expect(fetchMock).toHaveBeenCalledWith('/api/analytics/costs?window_hours=168');
      expect(fetchMock).toHaveBeenCalledWith('/api/analytics/costs/drilldown?window_hours=168&limit=25');
      expect(fetchMock).toHaveBeenCalledWith('/api/analytics/slo?window_hours=168');
      expect(fetchMock).toHaveBeenCalledWith('/api/runtime/llm/health');
      expect(fetchMock).toHaveBeenCalledWith('/api/runtime/llm/presets');
      expect(fetchMock).toHaveBeenCalledWith('/api/evaluation/prompts');
    });
    expect(screen.getByRole('link', { name: 'Export cost summary CSV' })).toHaveAttribute('href', '/api/analytics/costs?window_hours=168&format=csv');

    fireEvent.change(screen.getByLabelText('Drilldown stage'), { target: { value: 'summarization' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/analytics/costs/drilldown?window_hours=168&stage=summarization&limit=25');
    });
    expect(screen.getByRole('link', { name: 'Export cost drilldown CSV' })).toHaveAttribute('href', '/api/analytics/costs/drilldown?window_hours=168&stage=summarization&limit=25&format=csv');
  });

  it('runs the full critical-flow smoke in the app shell', async () => {
    window.localStorage.setItem('ultrawiki_user_id', 'user-test');
    const fetchMock = await generateLoadedPack();

    fireEvent.click(screen.getByRole('button', { name: 'Save current pack' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/study-packs/pack-1/save',
        expect.objectContaining({
          method: 'POST',
          headers: { 'x-user-id': 'user-test' }
        })
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create share link' }));
    expect(await screen.findAllByText(/\/shared\/share-1/)).not.toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/study-packs/pack-1/share',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': 'user-test'
        },
        body: JSON.stringify({ role: 'viewer' })
      })
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Flashcards' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start due-card session' }));
    expect(await screen.findByText('Card 1 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark card 1 good' }));
    expect(await screen.findByText('Card 2 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark card 2 easy' }));
    expect(await screen.findByText('No due cards remain.')).toBeInTheDocument();
    expect(screen.getByLabelText('Learning session')).toHaveTextContent('2/2');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/study-packs/pack-1/learning-session',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-user-id': 'user-test' })
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/study-packs/pack-1/learning-session?session_id=session-1',
      expect.objectContaining({ headers: { 'x-user-id': 'user-test' } })
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Quiz' }));
    const quizRegion = screen.getByRole('tabpanel', { name: 'Quiz' });
    fireEvent.click(within(quizRegion).getByLabelText('Computing history figure'));
    fireEvent.click(screen.getByRole('button', { name: 'Grade Quiz' }));
    expect(await screen.findByText('Score: 1/1')).toBeInTheDocument();
    expect(screen.getByText('Saved attempt 1')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/quiz-attempts',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-user-id': 'user-test' }),
        body: JSON.stringify({ pack_id: 'pack-1', selected_indices: [1] })
      })
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Ops' }));
    expect(await screen.findByRole('heading', { name: 'Ops Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('SLO Targets')).toBeInTheDocument();
    expect(screen.getByLabelText('Security and rate-limit metrics')).toHaveTextContent('1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/queue/status',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-session-id': expect.any(String) })
      })
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/analytics/outcomes?window_hours=24');
    expect(fetchMock).toHaveBeenCalledWith('/api/analytics/costs?window_hours=24');
    expect(fetchMock).toHaveBeenCalledWith('/api/analytics/slo?window_hours=24');
  });

  it('surfaces queue backpressure without starting a polling flow', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/queue/status') {
        return jsonResponse({ ...queueStatus, queued: 100, capacity_state: 'queue_full' });
      }
      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: false });
      }
      if (url === '/api/study-packs?limit=8') {
        return jsonResponse({ items: [] });
      }
      if (url === '/api/study-packs') {
        return jsonResponse({ error: 'admission_denied', reason: 'queue_full' }, 429);
      }
      return jsonResponse({ error: 'unexpected request' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(StudyPackApp));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByText('System is at capacity: the generation queue is full. Wait a moment and try again.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/study-packs', expect.objectContaining({ method: 'POST' }));
    expect(screen.getByRole('button', { name: 'Generate' })).not.toBeDisabled();
  });

  it('imports a topic list for safe batch generation with deferred capacity results', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/queue/status') {
        return jsonResponse(queueStatus);
      }
      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: false });
      }
      if (url === '/api/study-packs?limit=8') {
        return jsonResponse({ items: [] });
      }
      if (url === '/api/library?limit=8') {
        return jsonResponse({ items: [] });
      }
      if (url === '/api/learning/analytics') {
        return jsonResponse(learningAnalytics);
      }
      if (url === '/api/learning/reminders') {
        return jsonResponse(learningReminder);
      }
      if (url === '/api/study-packs/batch') {
        return jsonResponse({
          batch_idempotency_key: 'batch-ui-1',
          accepted_at: '2026-01-01T00:00:00.000Z',
          summary: {
            requested: 2,
            accepted: 1,
            reused: 0,
            rejected: 0,
            deferred: 1
          },
          capacity_before: queueStatus,
          capacity_after: { ...queueStatus, queued: 1, session_inflight: 1, capacity_state: 'session_limit' },
          items: [
            {
              index: 0,
              title_or_url: 'Ada Lovelace',
              status: 'accepted',
              pack_id: 'batch-pack-1',
              job_id: 'batch-job-1'
            },
            {
              index: 1,
              title_or_url: 'Grace Hopper',
              status: 'deferred',
              reason: 'session_limit'
            }
          ]
        });
      }
      if (url === '/api/jobs/batch-job-1') {
        return jsonResponse({ id: 'batch-job-1', status: 'queued', stage: 'ingestion', progress: 0 });
      }
      return jsonResponse({ error: 'unexpected request' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(StudyPackApp));
    fireEvent.change(screen.getByLabelText('Topic list'), { target: { value: 'Ada Lovelace\nGrace Hopper' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start batch generation' }));

    const results = await screen.findByLabelText('Batch generation results');
    expect(within(results).getByText('1/2')).toBeInTheDocument();
    expect(within(results).getByText('Session full')).toBeInTheDocument();
    expect(within(results).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(results).getByText('Grace Hopper')).toBeInTheDocument();
    expect(within(results).getAllByText('Deferred').length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/study-packs/batch',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-session-id': expect.any(String)
        }),
        body: expect.any(String)
      })
    );
    const batchCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/study-packs/batch');
    expect(JSON.parse(String(batchCall?.[1]?.body))).toMatchObject({
      topics: ['Ada Lovelace', 'Grace Hopper']
    });
  });

  it('surfaces retrying and partial degraded job states during polling', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url === '/api/queue/status') {
          return jsonResponse(queueStatus);
        }

        if (url === '/api/auth/session') {
          return jsonResponse({ authenticated: false });
        }

        if (url === '/api/study-packs?limit=8') {
          return jsonResponse({ items: [] });
        }

        if (url === '/api/study-packs') {
          return jsonResponse({ pack_id: 'pack-1', job_id: 'job-1' });
        }

        if (url === '/api/jobs/job-1') {
          return jsonResponse({
            id: 'job-1',
            status: 'running',
            stage: 'summarization',
            progress: 62,
            attempt: 2,
            retry_state: 'retrying',
            degradation_state: 'partial'
          });
        }

        return jsonResponse({ error: 'unexpected request' }, 404);
      })
    );

    render(React.createElement(StudyPackApp));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await screen.findByText('Generating');

    expect(await screen.findByText('Summaries is retrying after a transient failure.')).toBeInTheDocument();
    expect(screen.getByText('Retrying after a transient failure (attempt 2).')).toBeInTheDocument();
    expect(screen.getByText('Partial output mode is active. UltraWiki will show completed artifacts and avoid hiding usable work.')).toBeInTheDocument();
  });

  it('surfaces failed job errors in the generation rail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url === '/api/queue/status') {
          return jsonResponse(queueStatus);
        }

        if (url === '/api/auth/session') {
          return jsonResponse({ authenticated: false });
        }

        if (url === '/api/study-packs?limit=8') {
          return jsonResponse({ items: [] });
        }

        if (url === '/api/study-packs') {
          return jsonResponse({ pack_id: 'pack-1', job_id: 'job-1' });
        }

        if (url === '/api/jobs/job-1') {
          return jsonResponse({
            id: 'job-1',
            status: 'failed',
            stage: 'ingestion',
            progress: 12,
            errors: ['Wikipedia fetch failed']
          });
        }

        return jsonResponse({ error: 'unexpected request' }, 404);
      })
    );

    render(React.createElement(StudyPackApp));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await screen.findByText('Generating');

    await waitFor(() => expect(screen.getByText('Wikipedia fetch failed')).toBeInTheDocument());
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});
