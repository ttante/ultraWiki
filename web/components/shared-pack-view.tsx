'use client';

import React, { useEffect, useMemo, useState } from 'react';

type SourceProvenance = {
  source_revision_id: string;
  citation: string;
  revision_url: string;
  license: 'CC BY-SA 4.0';
};

type Summary = {
  level: 'beginner' | 'intermediate' | 'advanced';
  text: string;
  citations: string[];
  prompt_version: string;
  model: string;
};

type GlossaryTerm = {
  term: string;
  definition: string;
  citation: string;
  prompt_version: string;
  model: string;
};

type Flashcard = {
  question: string;
  answer: string;
  citation: string;
  prompt_version: string;
  model: string;
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
};

type GraphNode = {
  id: string;
  label: string;
  type: 'person' | 'organization' | 'event' | 'concept' | 'place' | 'work';
  citation: string;
  source_provenance?: SourceProvenance;
};

type GraphEdge = {
  source: string;
  target: string;
  relation: 'influenced' | 'founded' | 'member_of' | 'occurred_in' | 'related_to' | 'precedes';
  citation: string;
  source_provenance?: SourceProvenance;
};

type TimelineEvent = {
  year: number;
  date_label: string;
  description: string;
  citation: string;
  source_provenance?: SourceProvenance;
};

type Recommendation = {
  title: string;
  url: string;
  rationale: string;
  score: number;
  source_heading: string;
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
  readiness: {
    status: 'full' | 'partial';
    missing_artifacts: Array<'summaries' | 'graph' | 'glossary' | 'flashcards' | 'quiz'>;
    can_resume: boolean;
    degradation_reason?: string;
  };
};

type Share = {
  share_id: string;
  pack_id: string;
  owner_user_id: string;
  role: 'viewer' | 'editor';
  created_at: string;
  expires_at?: string;
};

type SharedStudyPackResponse = {
  share: Share;
  pack: StudyPack;
};

type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; payload: SharedStudyPackResponse };

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

const titleCase = (value: string): string => value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
};

const isExpiredShare = (share: Share): boolean => {
  if (!share.expires_at) return false;
  const expiresAt = Date.parse(share.expires_at);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
};

const shortCitation = (citation: string): string => {
  if (citation.length <= 86) return citation;
  return `${citation.slice(0, 82)}...`;
};

const sortedTimeline = (pack: StudyPack): TimelineEvent[] =>
  [...pack.timeline].sort((a, b) => a.year - b.year || a.date_label.localeCompare(b.date_label));

function SharedShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="uw-root uw-shared-root">
      <header className="uw-shared-topbar">
        <a className="uw-brand" href="/">
          <span className="uw-mark">U</span>
          <span>UltraWiki</span>
        </a>
        <span className="uw-pill">Shared pack</span>
      </header>
      {children}
    </main>
  );
}

function SharedUnavailable({ title, message }: { title: string; message: string }) {
  return (
    <SharedShell>
      <section className="uw-shared-status uw-panel uw-panel-pad">
        <p className="uw-eyebrow">Shared pack</p>
        <h1>{title}</h1>
        <p className="uw-muted">{message}</p>
        <a className="uw-secondary uw-shared-link-button" href="/">Open UltraWiki</a>
      </section>
    </SharedShell>
  );
}

function SaveToLibrary({
  packId,
  userId,
  setUserId
}: {
  packId: string;
  userId: string;
  setUserId: (value: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  const savePack = async () => {
    const trimmedUserId = userId.trim();
    if (!trimmedUserId) {
      setStatus('error');
      return;
    }

    setSaving(true);
    setStatus('idle');
    const response = await fetch(`/api/study-packs/${packId}/save`, {
      method: 'POST',
      headers: {
        'x-user-id': trimmedUserId
      }
    });
    setSaving(false);
    setStatus(response.ok ? 'saved' : 'error');
  };

  const updateUserId = (value: string) => {
    setUserId(value);
    const trimmed = value.trim();
    if (typeof window !== 'undefined' && trimmed) {
      window.localStorage.setItem('ultrawiki_user_id', trimmed);
    }
  };

  return (
    <section className="uw-panel uw-panel-pad">
      <div className="uw-split">
        <div>
          <h2 className="uw-section-title">Save To Library</h2>
          <p className="uw-muted">Store this pack with the current library key.</p>
        </div>
      </div>
      <label className="uw-library-key">
        <span>Library key</span>
        <input
          aria-label="Library key"
          value={userId}
          onChange={(event) => updateUserId(event.target.value)}
          spellCheck={false}
        />
      </label>
      <button className="uw-generate" disabled={saving || !userId.trim()} onClick={() => void savePack()} type="button">
        {saving ? 'Saving...' : 'Save to library'}
      </button>
      {status === 'saved' ? <p className="uw-success-text">Saved to library.</p> : null}
      {status === 'error' ? <p className="uw-error-text">Could not save this pack.</p> : null}
    </section>
  );
}

function SharedPackReadOnly({ payload }: { payload: SharedStudyPackResponse }) {
  const [userId, setUserId] = useState('');
  const timeline = useMemo(() => sortedTimeline(payload.pack).slice(0, 5), [payload.pack]);
  const pack = payload.pack;

  useEffect(() => {
    setUserId(getUserId());
  }, []);

  return (
    <SharedShell>
      <div className="uw-shared-layout">
        <aside className="uw-shared-sidebar">
          <section className="uw-panel uw-panel-pad">
            <h2 className="uw-section-title">Share</h2>
            <div className="uw-kv"><span>Access</span><strong>{titleCase(payload.share.role)}</strong></div>
            <div className="uw-kv"><span>Created</span><strong>{formatDateTime(payload.share.created_at)}</strong></div>
            <div className="uw-kv"><span>Share ID</span><strong>{payload.share.share_id}</strong></div>
            {payload.share.expires_at ? (
              <div className="uw-kv"><span>Expires</span><strong>{formatDateTime(payload.share.expires_at)}</strong></div>
            ) : null}
          </section>
          <section className="uw-panel uw-panel-pad">
            <h2 className="uw-section-title">Source</h2>
            <div className="uw-kv"><span>Revision</span><strong>{pack.source_revision_id}</strong></div>
            <div className="uw-links">
              <a href={pack.source_attribution.canonical_url} target="_blank" rel="noreferrer">Canonical article</a>
              <a href={pack.source_attribution.revision_url} target="_blank" rel="noreferrer">Exact revision</a>
            </div>
            <p className="uw-micro">License: {pack.source_attribution.license}</p>
          </section>
          <SaveToLibrary packId={pack.id} userId={userId} setUserId={setUserId} />
        </aside>
        <section className="uw-shared-main">
          <section className="uw-topic-head">
            <div>
              <p className="uw-eyebrow">Read-only study pack</p>
              <h1 className="uw-topic-title">{pack.input}</h1>
              <p className="uw-muted">
                {pack.summaries[0]?.text.slice(0, 180)}
                {pack.summaries[0] && pack.summaries[0].text.length > 180 ? '...' : ''}
              </p>
            </div>
            <div className="uw-metrics">
              <div className="uw-metric"><strong>{formatPercent(pack.grounding_stats.citation_rate)}</strong><span>Citation rate</span></div>
              <div className="uw-metric"><strong>{pack.glossary.length}</strong><span>Glossary terms</span></div>
              <div className="uw-metric"><strong>{pack.flashcards.length}</strong><span>Flashcards</span></div>
              <div className="uw-metric"><strong>{pack.quiz_questions.length}</strong><span>Quiz items</span></div>
            </div>
          </section>

          <section className="uw-grid" aria-label="Shared summaries">
            {pack.summaries.map((summary) => (
              <article className="uw-panel uw-summary" key={summary.level}>
                <div className="uw-card-meta">
                  <span className="uw-pill" data-tone={summary.level === 'advanced' ? 'coral' : 'green'}>{summary.level}</span>
                  <span className="uw-micro">{summary.prompt_version} / {summary.model}</span>
                </div>
                <h2>{titleCase(summary.level)}</h2>
                <p>{summary.text}</p>
                <div className="uw-citations">
                  {summary.citations.slice(0, 4).map((citation) => (
                    <span className="uw-citation" key={`${summary.level}-${citation}`}>{shortCitation(citation)}</span>
                  ))}
                </div>
              </article>
            ))}
          </section>

          <section className="uw-shared-artifacts">
            <article className="uw-panel uw-panel-pad">
              <h2 className="uw-section-title">Glossary</h2>
              {pack.glossary.length > 0 ? (
                <div className="uw-grid">
                  {pack.glossary.slice(0, 6).map((term) => (
                    <div className="uw-glossary-term" key={`${term.term}-${term.citation}`}>
                      <strong>{term.term}</strong>
                      <p>{term.definition}</p>
                      <span className="uw-citation">{shortCitation(term.citation)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="uw-muted">No glossary terms are available.</p>
              )}
            </article>
            <article className="uw-panel uw-panel-pad">
              <h2 className="uw-section-title">Flashcards</h2>
              {pack.flashcards.length > 0 ? (
                <div className="uw-grid">
                  {pack.flashcards.slice(0, 4).map((card, idx) => (
                    <div className="uw-card" key={`${card.question}-${idx}`}>
                      <span className="uw-pill">Card {idx + 1}</span>
                      <h3>{card.question}</h3>
                      <p className="uw-muted">{card.answer}</p>
                      <span className="uw-micro">{shortCitation(card.citation)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="uw-muted">No flashcards are available.</p>
              )}
            </article>
          </section>

          <section className="uw-shared-artifacts">
            <article className="uw-panel uw-panel-pad">
              <h2 className="uw-section-title">Quiz Preview</h2>
              {pack.quiz_questions.length > 0 ? (
                <div className="uw-grid">
                  {pack.quiz_questions.slice(0, 3).map((question, idx) => (
                    <div className="uw-question" key={`${question.question}-${idx}`}>
                      <span className="uw-pill">Question {idx + 1}</span>
                      <h3>{question.question}</h3>
                      <p className="uw-muted">{question.explanation}</p>
                      <span className="uw-micro">{shortCitation(question.citation)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="uw-muted">No quiz questions are available.</p>
              )}
            </article>
            <article className="uw-panel uw-panel-pad">
              <h2 className="uw-section-title">Timeline</h2>
              {timeline.length > 0 ? (
                <div className="uw-grid">
                  {timeline.map((event) => (
                    <div className="uw-timeline-item" key={`${event.date_label}-${event.citation}`}>
                      <strong>{event.date_label}</strong>
                      <p>{event.description}</p>
                      <span className="uw-micro">{shortCitation(event.citation)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="uw-muted">No timeline events are available.</p>
              )}
            </article>
          </section>
        </section>
      </div>
    </SharedShell>
  );
}

export default function SharedPackView({ shareId }: { shareId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const loadSharedPack = async () => {
      setState({ status: 'loading' });
      try {
        const response = await fetch(`/api/shared/${shareId}`);
        if (response.status === 404) {
          if (!cancelled) setState({ status: 'missing' });
          return;
        }
        if (!response.ok) {
          if (!cancelled) setState({ status: 'error', message: 'Could not load this shared pack.' });
          return;
        }
        const payload = (await response.json()) as SharedStudyPackResponse;
        if (!cancelled) setState({ status: 'ready', payload });
      } catch {
        if (!cancelled) setState({ status: 'error', message: 'Could not load this shared pack.' });
      }
    };

    void loadSharedPack();

    return () => {
      cancelled = true;
    };
  }, [shareId]);

  if (state.status === 'loading') {
    return (
      <SharedShell>
        <section className="uw-shared-status uw-panel uw-panel-pad" aria-live="polite">
          <p className="uw-eyebrow">Shared pack</p>
          <h1>Loading shared pack...</h1>
        </section>
      </SharedShell>
    );
  }

  if (state.status === 'missing') {
    return (
      <SharedUnavailable
        title="Shared pack unavailable"
        message="This link does not match an available shared pack."
      />
    );
  }

  if (state.status === 'error') {
    return <SharedUnavailable title="Shared pack unavailable" message={state.message} />;
  }

  if (isExpiredShare(state.payload.share)) {
    return (
      <SharedUnavailable
        title="Share link expired"
        message="This shared pack link is past its expiration time."
      />
    );
  }

  return <SharedPackReadOnly payload={state.payload} />;
}
