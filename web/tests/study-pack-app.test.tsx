import React from 'react';
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

const opsSnapshots = {
  outcomes: {
    jobs: { completed: 4, failed: 1, completion_rate: 0.8 },
    quality: { avg_citation_rate: 0.94 },
    learning: { attempts: 3, avg_accuracy: 0.67 }
  },
  costs: {
    total_estimated_usd: 0.1234,
    avg_estimated_usd_per_pack: 0.0411,
    llm_ops: {
      calls: {
        attempted: 2,
        succeeded: 1,
        fallback: 1,
        timeout_rate: 0
      }
    }
  },
  slo: {
    targets: [
      { id: 'job_success_rate', name: 'Job success rate', target: 0.99, comparator: '>=' as const }
    ],
    current: {
      p95_time_to_first_artifact_ms: 1200,
      p95_full_pack_completion_ms: 5200,
      job_success_rate: 0.8,
      citation_coverage_rate: 0.94
    }
  }
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

function mockSuccessfulGeneration(
  quizAttemptResponse: { body: unknown; status?: number } = {
    body: {
      attempt_id: 'attempt-1',
      pack_id: 'pack-1',
      total_questions: 1,
      correct_answers: 1,
      accuracy: 1,
      submitted_at: '2026-01-01T00:00:00.000Z'
    }
  }
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url === '/api/queue/status') {
      return jsonResponse(queueStatus);
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
      return jsonResponse(learningProgress);
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

    if (url === '/api/study-packs/pack-1/flashcards/0/reviews') {
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

    if (url === '/api/quiz-attempts') {
      return jsonResponse(quizAttemptResponse.body, quizAttemptResponse.status ?? 200);
    }

    if (url === '/api/analytics/outcomes') {
      return jsonResponse(opsSnapshots.outcomes);
    }

    if (url === '/api/analytics/costs?window_hours=24') {
      return jsonResponse(opsSnapshots.costs);
    }

    if (url === '/api/analytics/slo') {
      return jsonResponse(opsSnapshots.slo);
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

describe('StudyPackApp', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/queue/status') {
          return jsonResponse(queueStatus);
        }
        if (url === '/api/study-packs?limit=8') {
          return jsonResponse({ items: [] });
        }
        if (url === '/api/library?limit=8') {
          return jsonResponse({ items: [] });
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

  it('generates a pack through mocked APIs and renders source, summaries, citations, and AI ops metadata', async () => {
    const fetchMock = await generateLoadedPack();

    expect(fetchMock).toHaveBeenCalledWith('/api/study-packs', expect.objectContaining({ method: 'POST' }));
    expect(screen.getByText('rev-ada-123')).toBeInTheDocument();
    expect(screen.getAllByText('94%')).toHaveLength(2);
    expect(screen.getAllByText('Ada Lovelace citation one')).not.toHaveLength(0);
    expect(screen.getAllByText('summary@1.0.0 / qwen2.5-14b')).not.toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Glossary' })).toBeInTheDocument();
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

  it('shows partial pack actions and resumes missing artifacts', async () => {
    let resumeRequested = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/queue/status') {
        return jsonResponse(queueStatus);
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/queue/status') {
        return jsonResponse(queueStatus);
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
              readiness: studyPack.readiness
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
      return jsonResponse({ error: 'unexpected request' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(StudyPackApp));
    const library = (await screen.findByRole('heading', { name: 'Saved Library' })).closest('section') as HTMLElement;
    expect(within(library).getByLabelText('Library key')).toHaveValue('user-shared');
    fireEvent.click(within(library).getByRole('button', { name: /Ada Lovelace/ }));

    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
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
  });

  it('creates a viewer share link for the loaded pack', async () => {
    window.localStorage.setItem('ultrawiki_user_id', 'user-test');
    const fetchMock = await generateLoadedPack();

    fireEvent.click(screen.getByRole('button', { name: 'Create share link' }));

    expect(await screen.findByText(/\/api\/shared\/share-1/)).toBeInTheDocument();
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

  it('filters concept nodes by taxonomy type', async () => {
    await generateLoadedPack();

    fireEvent.click(screen.getByRole('button', { name: 'Concepts' }));
    expect(screen.getByText('3 visible nodes, 1 relationships.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'person' }));

    expect(screen.getByText('1 visible nodes, 1 relationships.')).toBeInTheDocument();
    expect(screen.getAllByText('Ada Lovelace')).not.toHaveLength(0);
  });

  it('supports concept graph evidence selection and view controls', async () => {
    await generateLoadedPack();

    fireEvent.click(screen.getByRole('button', { name: 'Concepts' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Concepts' }));
    fireEvent.change(screen.getByLabelText('Search graph nodes and relationships'), {
      target: { value: 'Analytical' }
    });

    expect(screen.getByText('2 visible nodes, 1 relationships.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Path Inspector' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Related To' }));
    expect(screen.getByText('2 visible nodes, 1 relationships.')).toBeInTheDocument();
  });

  it('supports flashcard review and persisted quiz attempt scoring', async () => {
    const fetchMock = await generateLoadedPack();

    fireEvent.click(screen.getByRole('button', { name: 'Flashcards' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Quiz' }));
    const quizRegion = screen.getByLabelText('Quiz');
    fireEvent.click(within(quizRegion).getByLabelText('Computing history figure'));
    fireEvent.click(screen.getByRole('button', { name: 'Grade Quiz' }));

    expect(await screen.findByText('Score: 1/1')).toBeInTheDocument();
    expect(screen.getByText('Saved attempt attempt-1')).toBeInTheDocument();
    expect(screen.getByText(/Correct\./)).toBeInTheDocument();
    expect(screen.getByText('Misconception checks')).toBeInTheDocument();
    expect(screen.getByText(/Computing history figure is the cited answer/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/quiz-attempts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ pack_id: 'pack-1', selected_indices: [1] })
      })
    );
  });

  it('shows server-side invalid quiz attempt payload errors', async () => {
    await generateLoadedPack({
      status: 400,
      body: { error: 'invalid_attempt_payload', reason: 'expected 1 answers' }
    });

    fireEvent.click(screen.getByRole('button', { name: 'Quiz' }));
    const quizRegion = screen.getByLabelText('Quiz');
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

    fireEvent.click(screen.getByRole('button', { name: 'Quiz' }));
    const quizRegion = screen.getByLabelText('Quiz');
    fireEvent.click(within(quizRegion).getByLabelText('Computing history figure'));
    fireEvent.click(screen.getByRole('button', { name: 'Grade Quiz' }));

    expect(await screen.findByText('Quiz is not ready yet. Generate or reload the study pack before submitting an attempt.')).toBeInTheDocument();
  });

  it('loads the frontend ops dashboard on demand', async () => {
    const fetchMock = await generateLoadedPack();

    fireEvent.click(screen.getByRole('button', { name: 'Ops' }));

    expect(await screen.findByRole('heading', { name: 'Ops Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('$0.1234')).toBeInTheDocument();
    expect(screen.getByText('SLO Targets')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/analytics/outcomes');
    expect(fetchMock).toHaveBeenCalledWith('/api/analytics/costs?window_hours=24');
    expect(fetchMock).toHaveBeenCalledWith('/api/analytics/slo');
  });

  it('surfaces queue backpressure without starting a polling flow', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/queue/status') {
        return jsonResponse({ ...queueStatus, queued: 100, capacity_state: 'queue_full' });
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

  it('surfaces retrying and partial degraded job states during polling', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url === '/api/queue/status') {
          return jsonResponse(queueStatus);
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
