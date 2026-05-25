'use client';

import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

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

type QuizAttemptResult = {
  attempt_id: string;
  pack_id: string;
  total_questions: number;
  correct_answers: number;
  accuracy: number;
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

type OutcomesAnalytics = {
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
    avg_accuracy: number;
  };
};

type CostAnalytics = {
  total_estimated_usd: number;
  avg_estimated_usd_per_pack: number;
  llm_ops: {
    calls: {
      attempted: number;
      succeeded: number;
      fallback: number;
      timeout_rate: number;
    };
  };
};

type SloAnalytics = {
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
};

type OpsSnapshots = {
  outcomes: OutcomesAnalytics;
  costs: CostAnalytics;
  slo: SloAnalytics;
};

type Tab = 'overview' | 'concepts' | 'flashcards' | 'quiz' | 'ops';

type CitationItem = {
  label: string;
  value: string;
};

const tabs: Array<[Tab, string]> = [
  ['overview', 'Overview'],
  ['concepts', 'Concepts'],
  ['flashcards', 'Flashcards'],
  ['quiz', 'Quiz'],
  ['ops', 'Ops']
];

const nodeFilters = ['all', 'person', 'organization', 'event', 'concept', 'place', 'work'] as const;

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

const formatScore = (value: number): string => `${Math.round(value * 100)} relevance`;

const formatCurrency = (value: number): string => `$${value.toFixed(value < 1 ? 4 : 2)}`;

const formatMs = (value: number): string => `${Math.round(value).toLocaleString()} ms`;

const shortCitation = (citation: string): string => {
  if (citation.length <= 76) return citation;
  return `${citation.slice(0, 72)}...`;
};

const titleCase = (value: string): string => value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());

const formatCapacityState = (value: QueueStatus['capacity_state']): string => {
  if (value === 'open') return 'Open';
  if (value === 'queue_full') return 'Queue full';
  if (value === 'global_limit') return 'Workers full';
  return 'Session full';
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
  const add = (label: string, value?: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    items.push({ label, value });
  };

  pack.summaries.forEach((summary) => summary.citations.forEach((citation) => add(`${summary.level} summary`, citation)));
  pack.glossary.forEach((term) => add(term.term, term.citation));
  pack.flashcards.forEach((card, idx) => add(`flashcard ${idx + 1}`, card.citation));
  pack.quiz_questions.forEach((question, idx) => add(`quiz ${idx + 1}`, question.citation));
  pack.timeline.forEach((event) => add(event.date_label, event.citation));
  pack.graph.nodes.forEach((node) => add(node.label, node.citation));

  return items.slice(0, 10);
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

const cacheFootprint = (pack: StudyPack | null): CacheEvent[] => {
  if (!pack) return [];
  return [pack.cache.source, ...pack.cache.artifacts].filter((event): event is CacheEvent => Boolean(event));
};

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
    return <span className="uw-pill">Ready</span>;
  }

  const tone = job.status === 'completed' ? 'green' : job.status === 'failed' || job.status === 'quarantined' ? 'red' : 'coral';
  const label = job.status === 'completed' && job.degradation_state === 'partial'
    ? 'Partial'
    : busy
      ? 'Generating'
      : titleCase(job.status);
  return (
    <span className="uw-pill" data-tone={tone}>
      {label}
    </span>
  );
}

function TopBar({
  topicInput,
  setTopicInput,
  submitTopic,
  busy,
  job
}: {
  topicInput: string;
  setTopicInput: (value: string) => void;
  submitTopic: () => void;
  busy: boolean;
  job: JobStatus | null;
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
  onOpenHistory
}: {
  history: StudyPackHistoryItem[];
  onOpenHistory: (packId: string) => void;
}) {
  return (
    <section className="uw-panel uw-panel-pad">
      <h2 className="uw-section-title">Recent Packs</h2>
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
      ) : (
        <p className="uw-muted">Generated packs for this browser session will appear here.</p>
      )}
    </section>
  );
}

function SavedLibrary({
  library,
  userId,
  onUserIdChange,
  onOpenLibrary,
  onSaveCurrent,
  canSave,
  saving
}: {
  library: StudyPackHistoryItem[];
  userId: string;
  onUserIdChange: (value: string) => void;
  onOpenLibrary: (packId: string) => void;
  onSaveCurrent: () => void;
  canSave: boolean;
  saving: boolean;
}) {
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
      <button className="uw-secondary" disabled={!canSave || saving} onClick={onSaveCurrent} type="button">
        {saving ? 'Saving...' : 'Save current pack'}
      </button>
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
              <small>rev {item.source_revision_id}</small>
            </button>
          ))}
        </div>
      ) : (
        <p className="uw-muted">Saved packs for this library key will appear here.</p>
      )}
    </section>
  );
}

function LeftRail({
  pack,
  history,
  library,
  userId,
  onUserIdChange,
  onOpenHistory,
  onOpenLibrary,
  onSaveCurrent,
  librarySaving
}: {
  pack: StudyPack | null;
  history: StudyPackHistoryItem[];
  library: StudyPackHistoryItem[];
  userId: string;
  onUserIdChange: (value: string) => void;
  onOpenHistory: (packId: string) => void;
  onOpenLibrary: (packId: string) => void;
  onSaveCurrent: () => void;
  librarySaving: boolean;
}) {
  if (!pack) {
    return (
      <aside className="uw-sidebar">
        <section className="uw-panel uw-panel-pad">
          <h2 className="uw-section-title">Workspace</h2>
          <p className="uw-muted">Generate a pack to populate grounded summaries, graph entities, recall cards, and quiz checks.</p>
        </section>
        <RecentPacks history={history} onOpenHistory={onOpenHistory} />
        <SavedLibrary
          library={library}
          userId={userId}
          onUserIdChange={onUserIdChange}
          onOpenLibrary={onOpenLibrary}
          onSaveCurrent={onSaveCurrent}
          canSave={false}
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
      <RecentPacks history={history} onOpenHistory={onOpenHistory} />
      <SavedLibrary
        library={library}
        userId={userId}
        onUserIdChange={onUserIdChange}
        onOpenLibrary={onOpenLibrary}
        onSaveCurrent={onSaveCurrent}
        canSave={Boolean(pack)}
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
  shareLink,
  shareBusy,
  onCreateShareLink
}: {
  pack: StudyPack | null;
  job: JobStatus | null;
  error: string | null;
  queueStatus: QueueStatus | null;
  shareLink: ShareLink | null;
  shareBusy: boolean;
  onCreateShareLink: () => void;
}) {
  const citations = useMemo(() => uniqueCitations(pack), [pack]);
  const footprint = useMemo(() => modelFootprint(pack), [pack]);
  const cacheEvents = useMemo(() => cacheFootprint(pack), [pack]);
  const currentStageIndex = job ? Math.max(stageOrder.indexOf(job.stage), 0) : -1;
  const shareUrl = shareLink
    ? `${typeof window === 'undefined' ? '' : window.location.origin}${shareLink.share_path}`
    : null;

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
      <section className="uw-panel uw-panel-pad">
        <h2 className="uw-section-title">Capacity</h2>
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
        ) : (
          <p className="uw-muted">Capacity status appears once the API responds.</p>
        )}
      </section>
      <section className="uw-panel uw-panel-pad">
        <h2 className="uw-section-title">Citation Stream</h2>
        {citations.length > 0 ? (
          <div className="uw-grid">
            {citations.map((citation) => (
              <div className="uw-citation-link" key={`${citation.label}-${citation.value}`}>
                <span>{citation.label}</span>
                <strong>{shortCitation(citation.value)}</strong>
              </div>
            ))}
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
  return (
    <nav className="uw-tabs" aria-label="Study pack sections">
      {tabs.map(([tab, label]) => (
        <button
          className="uw-tab"
          data-active={tab === activeTab}
          disabled={disabled}
          key={tab}
          onClick={() => setActiveTab(tab)}
          type="button"
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

function TopicHeader({ pack }: { pack: StudyPack }) {
  return (
    <section className="uw-topic-head">
      <div>
        <p className="uw-eyebrow">Study pack</p>
        <h1 className="uw-topic-title">{pack.input}</h1>
        <p className="uw-muted">{pack.summaries[0]?.text.slice(0, 180)}{pack.summaries[0]?.text.length > 180 ? '...' : ''}</p>
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
        {pack.summaries.map((summary) => (
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
        ))}
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
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : nodes[0] ?? null;
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
  const evidence = selectedEvidence ?? (nodes[0]
    ? {
        kind: 'Node' as const,
        title: nodes[0].label,
        detail: `A ${nodes[0].type} entity extracted from the source text.`,
        citation: nodes[0].citation
      }
    : null);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setGraphSearch('');
    setRelationFilter('all');
  };

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
            <button className="uw-filter" onClick={() => setZoom((value) => Math.min(1.75, Number((value + 0.25).toFixed(2))))} type="button">
              Zoom in
            </button>
            <button className="uw-filter" onClick={() => setZoom((value) => Math.max(0.75, Number((value - 0.25).toFixed(2))))} type="button">
              Zoom out
            </button>
            <button className="uw-filter" onClick={() => setPan((value) => ({ ...value, x: value.x - 24 }))} type="button">
              Pan left
            </button>
            <button className="uw-filter" onClick={() => setPan((value) => ({ ...value, x: value.x + 24 }))} type="button">
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
  const ratings: FlashcardReviewRating[] = ['again', 'hard', 'good', 'easy'];
  return (
    <div className="uw-review-actions" aria-label={`Review card ${cardIndex + 1}`}>
      {ratings.map((rating) => (
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
  reviewingCardIndex,
  onReviewCard
}: {
  pack: StudyPack;
  progress: LearningProgress | null;
  reviewingCardIndex: number | null;
  onReviewCard: (cardIndex: number, rating: FlashcardReviewRating) => void;
}) {
  const [feature, ...rest] = pack.flashcards;

  if (!feature) {
    return <p className="uw-panel uw-panel-pad uw-muted">No flashcards were generated for this source.</p>;
  }
  const featureProgress = progress?.cards.find((card) => card.card_index === 0);

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
  quizAttemptResult
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
          {quizSubmitting ? 'Saving...' : 'Grade Quiz'}
        </button>
        <div className="uw-grade-result">
          {quizScore ? <strong>Score: {quizScore.correct}/{quizScore.total}</strong> : <span className="uw-muted">Select answers, then save the attempt.</span>}
          {quizAttemptResult ? <span className="uw-micro">Saved attempt {quizAttemptResult.attempt_id}</span> : null}
          {quizError ? <span className="uw-error-text">{quizError}</span> : null}
        </div>
      </div>
    </section>
  );
}

function OpsPanel({
  snapshots,
  loading,
  error,
  onRefresh
}: {
  snapshots: OpsSnapshots | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
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

  return (
    <section className="uw-grid" aria-label="Ops dashboard">
      <div className="uw-panel uw-panel-pad">
        <div className="uw-split">
          <div>
            <h2 className="uw-section-title">Ops Dashboard</h2>
            <p className="uw-muted">Backend health, cost posture, learning outcomes, and model fallback signals.</p>
          </div>
          <button className="uw-secondary" disabled={loading} onClick={onRefresh} type="button">
            {loading ? 'Refreshing...' : 'Refresh ops'}
          </button>
        </div>
      </div>
      <div className="uw-ops-grid">
        <Metric label="Job success" value={formatPercent(snapshots.slo.current.job_success_rate)} detail="current SLO success rate" />
        <Metric label="Citation coverage" value={formatPercent(snapshots.slo.current.citation_coverage_rate)} detail="grounded output coverage" />
        <Metric label="Total cost" value={formatCurrency(snapshots.costs.total_estimated_usd)} detail="estimated LLM and pipeline cost" />
        <Metric label="Avg pack cost" value={formatCurrency(snapshots.costs.avg_estimated_usd_per_pack)} detail="estimated per generated pack" />
        <Metric label="Quiz attempts" value={String(snapshots.outcomes.learning.attempts)} detail={`${formatPercent(snapshots.outcomes.learning.avg_accuracy)} average accuracy`} />
        <Metric label="LLM fallback" value={String(snapshots.costs.llm_ops.calls.fallback)} detail={`${snapshots.costs.llm_ops.calls.attempted} attempted model calls`} />
      </div>
      <section className="uw-panel uw-panel-pad">
        <h2 className="uw-section-title">SLO Targets</h2>
        <div className="uw-grid">
          <div className="uw-kv">
            <span>Time to first artifact p95</span>
            <strong>{formatMs(snapshots.slo.current.p95_time_to_first_artifact_ms)}</strong>
          </div>
          <div className="uw-kv">
            <span>Full pack completion p95</span>
            <strong>{formatMs(snapshots.slo.current.p95_full_pack_completion_ms)}</strong>
          </div>
          {snapshots.slo.targets.map((target) => (
            <div className="uw-kv" key={target.id}>
              <span>{target.name}</span>
              <strong>{target.comparator} {target.target}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className="uw-panel uw-panel-pad">
        <h2 className="uw-section-title">Reliability Inputs</h2>
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
  const [nodeTypeFilter, setNodeTypeFilter] = useState<'all' | GraphNode['type']>('all');
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [history, setHistory] = useState<StudyPackHistoryItem[]>([]);
  const [library, setLibrary] = useState<StudyPackHistoryItem[]>([]);
  const [userId, setUserId] = useState('');
  const [librarySaving, setLibrarySaving] = useState(false);
  const [shareLink, setShareLink] = useState<ShareLink | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [learningProgress, setLearningProgress] = useState<LearningProgress | null>(null);
  const [reviewingCardIndex, setReviewingCardIndex] = useState<number | null>(null);
  const [opsSnapshots, setOpsSnapshots] = useState<OpsSnapshots | null>(null);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsError, setOpsError] = useState<string | null>(null);

  const sessionId = useMemo(() => getSessionId(), []);

  useEffect(() => {
    setUserId(getUserId());
  }, []);

  const refreshQueueStatus = useCallback(async () => {
    const response = await fetch('/api/queue/status', {
      headers: {
        'x-session-id': sessionId
      }
    });
    if (!response.ok) return;
    setQueueStatus((await response.json()) as QueueStatus);
  }, [sessionId]);

  const refreshHistory = useCallback(async () => {
    const response = await fetch('/api/study-packs?limit=8', {
      headers: {
        'x-session-id': sessionId
      }
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { items?: StudyPackHistoryItem[] };
    setHistory(Array.isArray(payload.items) ? payload.items : []);
  }, [sessionId]);

  const refreshLibrary = useCallback(async () => {
    const trimmedUserId = userId.trim();
    if (!trimmedUserId) {
      setLibrary([]);
      return;
    }

    const response = await fetch('/api/library?limit=8', {
      headers: {
        'x-user-id': trimmedUserId
      }
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { items?: StudyPackHistoryItem[] };
    setLibrary(Array.isArray(payload.items) ? payload.items : []);
  }, [userId]);

  const refreshLearningProgress = useCallback(async (nextPackId: string) => {
    const trimmedUserId = userId.trim();
    if (!trimmedUserId) {
      setLearningProgress(null);
      return;
    }
    const response = await fetch(`/api/study-packs/${nextPackId}/progress`, {
      headers: {
        'x-user-id': trimmedUserId
      }
    });
    if (!response.ok) return;
    setLearningProgress((await response.json()) as LearningProgress);
  }, [userId]);

  const refreshOpsSnapshots = useCallback(async () => {
    setOpsLoading(true);
    setOpsError(null);
    try {
      const [outcomesResponse, costsResponse, sloResponse] = await Promise.all([
        fetch('/api/analytics/outcomes'),
        fetch('/api/analytics/costs?window_hours=24'),
        fetch('/api/analytics/slo')
      ]);
      if (!outcomesResponse.ok || !costsResponse.ok || !sloResponse.ok) {
        throw new Error('ops_fetch_failed');
      }
      setOpsSnapshots({
        outcomes: (await outcomesResponse.json()) as OutcomesAnalytics,
        costs: (await costsResponse.json()) as CostAnalytics,
        slo: (await sloResponse.json()) as SloAnalytics
      });
    } catch {
      setOpsError('Could not load operational metrics.');
    } finally {
      setOpsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshQueueStatus();
    void refreshHistory();
  }, [refreshHistory, refreshQueueStatus]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  useEffect(() => {
    if (studyPack) {
      void refreshLearningProgress(studyPack.id);
    } else {
      setLearningProgress(null);
    }
  }, [refreshLearningProgress, studyPack]);

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
  }, [job, packId, refreshHistory, refreshLibrary, refreshLearningProgress, refreshQueueStatus]);

  useEffect(() => {
    setSelectedAnswers({});
    setShowQuizResult(false);
    setQuizSubmitting(false);
    setQuizError(null);
    setQuizAttemptResult(null);
    setShareLink(null);
  }, [studyPack?.id]);

  const updateUserId = (value: string) => {
    setUserId(value);
    const trimmed = value.trim();
    if (typeof window !== 'undefined' && trimmed.length > 0) {
      window.localStorage.setItem('ultrawiki_user_id', trimmed);
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
    setActiveTab('overview');

    const response = await fetch('/api/study-packs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-id': sessionId,
        ...(userId.trim() ? { 'x-user-id': userId.trim() } : {})
      },
      body: JSON.stringify({
        title_or_url: requestedTopic,
        idempotency_key: `idem-${crypto.randomUUID()}`
      })
    });

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
        ...(userId.trim() ? { 'x-user-id': userId.trim() } : {})
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
  };

  const saveCurrentPack = async () => {
    if (!studyPack || !userId.trim()) return;

    setLibrarySaving(true);
    setError(null);
    const response = await fetch(`/api/study-packs/${studyPack.id}/save`, {
      method: 'POST',
      headers: {
        'x-user-id': userId.trim()
      }
    });

    if (!response.ok) {
      setError('Could not save this pack to the library.');
      setLibrarySaving(false);
      return;
    }

    await refreshLibrary();
    setLibrarySaving(false);
  };

  const createShareLink = async () => {
    if (!studyPack || !userId.trim()) return;

    setShareBusy(true);
    setError(null);
    const response = await fetch(`/api/study-packs/${studyPack.id}/share`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': userId.trim()
      },
      body: JSON.stringify({ role: 'viewer' })
    });

    if (!response.ok) {
      setError('Could not create a share link.');
      setShareBusy(false);
      return;
    }

    setShareLink((await response.json()) as ShareLink);
    setShareBusy(false);
  };

  const reviewFlashcard = async (cardIndex: number, rating: FlashcardReviewRating) => {
    if (!studyPack || !userId.trim()) return;

    setReviewingCardIndex(cardIndex);
    setError(null);
    const response = await fetch(`/api/study-packs/${studyPack.id}/flashcards/${cardIndex}/reviews`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': userId.trim()
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
        'content-type': 'application/json'
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
    setShowQuizResult(true);
    setQuizSubmitting(false);
  };

  return (
    <main className="uw-root">
      <TopBar topicInput={topicInput} setTopicInput={setTopicInput} submitTopic={() => void submitTopic()} busy={busy} job={job} />
      <div className="uw-layout">
        <LeftRail
          pack={studyPack}
          history={history}
          library={library}
          userId={userId}
          onUserIdChange={updateUserId}
          onOpenHistory={(id) => void loadHistoryPack(id)}
          onOpenLibrary={(id) => void loadHistoryPack(id)}
          onSaveCurrent={() => void saveCurrentPack()}
          librarySaving={librarySaving}
        />
        <section className="uw-main">
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
          {studyPack && activeTab === 'overview' ? (
            <OverviewPanel
              pack={studyPack}
              onStartRecommendation={(title) => void submitTopic(title)}
              busy={busy}
            />
          ) : null}
          {studyPack && activeTab === 'concepts' ? (
            <ConceptsPanel pack={studyPack} nodeTypeFilter={nodeTypeFilter} setNodeTypeFilter={setNodeTypeFilter} />
          ) : null}
          {studyPack && activeTab === 'flashcards' ? (
            <FlashcardsPanel
              pack={studyPack}
              progress={learningProgress}
              reviewingCardIndex={reviewingCardIndex}
              onReviewCard={(cardIndex, rating) => void reviewFlashcard(cardIndex, rating)}
            />
          ) : null}
          {studyPack && activeTab === 'quiz' ? (
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
            />
          ) : null}
          {activeTab === 'ops' ? (
            <OpsPanel
              snapshots={opsSnapshots}
              loading={opsLoading}
              error={opsError}
              onRefresh={() => void refreshOpsSnapshots()}
            />
          ) : null}
        </section>
        <RightRail
          pack={studyPack}
          job={job}
          error={error}
          queueStatus={queueStatus}
          shareLink={shareLink}
          shareBusy={shareBusy}
          onCreateShareLink={() => void createShareLink()}
        />
      </div>
    </main>
  );
}
