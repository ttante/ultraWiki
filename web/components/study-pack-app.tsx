'use client';

import { useEffect, useMemo, useState } from 'react';

type Summary = {
  level: 'beginner' | 'intermediate' | 'advanced';
  text: string;
  citations: string[];
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
};

type GraphEdge = {
  source: string;
  target: string;
  relation: 'influenced' | 'founded' | 'member_of' | 'occurred_in' | 'related_to' | 'precedes';
  citation: string;
};

type TimelineEvent = {
  year: number;
  date_label: string;
  description: string;
  citation: string;
};

type StudyPack = {
  id: string;
  input: string;
  source_revision_id: string;
  grounding_stats: {
    citation_rate: number;
    unsupported_claims: number;
  };
  summaries: Summary[];
  flashcards: Flashcard[];
  quiz_questions: QuizQuestion[];
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  timeline: TimelineEvent[];
};

type JobStatus = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'quarantined';
  stage: 'ingestion' | 'summarization' | 'active_recall' | 'knowledge_structure' | 'done';
  progress: number;
  errors?: string[];
};

type Tab = 'overview' | 'concepts' | 'flashcards' | 'quiz';

const stageLabel: Record<JobStatus['stage'], string> = {
  ingestion: 'Ingestion',
  summarization: 'Summarization',
  active_recall: 'Active Recall',
  knowledge_structure: 'Knowledge Structure',
  done: 'Done'
};

const SessionId = (): string => {
  if (typeof window === 'undefined') {
    return 'server-session';
  }
  const existing = window.localStorage.getItem('ultrawiki_session_id');
  if (existing) return existing;
  const id = `sess-${crypto.randomUUID()}`;
  window.localStorage.setItem('ultrawiki_session_id', id);
  return id;
};

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
  const [nodeTypeFilter, setNodeTypeFilter] = useState<'all' | GraphNode['type']>('all');

  const sessionId = useMemo(() => SessionId(), []);

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
      }

      if (next.status === 'failed' || next.status === 'quarantined') {
        setBusy(false);
        setError(next.errors?.join('; ') ?? 'Job failed');
      }
    }, 800);

    return () => clearInterval(interval);
  }, [job, packId]);

  useEffect(() => {
    setSelectedAnswers({});
    setShowQuizResult(false);
  }, [studyPack?.id]);

  const submitTopic = async () => {
    setBusy(true);
    setError(null);
    setStudyPack(null);
    setJob(null);
    setPackId(null);

    const response = await fetch('/api/study-packs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-id': sessionId
      },
      body: JSON.stringify({
        title_or_url: topicInput,
        idempotency_key: `idem-${crypto.randomUUID()}`
      })
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string; reason?: string };
      setError(payload.error ? `${payload.error}${payload.reason ? ` (${payload.reason})` : ''}` : 'Request failed');
      setBusy(false);
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
  };

  const quizScore = (() => {
    if (!studyPack || !showQuizResult) return null;
    const correct = studyPack.quiz_questions.reduce((acc, q, idx) => {
      return acc + (selectedAnswers[idx] === q.correct_index ? 1 : 0);
    }, 0);
    return { correct, total: studyPack.quiz_questions.length };
  })();

  return (
    <main
      style={{
        maxWidth: 1080,
        margin: '2rem auto',
        padding: '1rem',
        fontFamily: 'Charter, Georgia, Times New Roman, serif',
        color: '#1f2937'
      }}
    >
      <div
        style={{
          border: '2px solid #111827',
          borderRadius: 16,
          padding: '1rem 1.25rem',
          background: 'linear-gradient(135deg, #fdf4ff, #eff6ff)'
        }}
      >
        <h1 style={{ margin: 0, fontSize: '2rem' }}>UltraWiki Study Pack</h1>
        <p style={{ margin: '0.4rem 0 0.8rem 0' }}>
          Enter a Wikipedia title or URL to generate summaries, concepts, flashcards, and quizzes.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            style={{
              flex: 1,
              minWidth: 240,
              border: '1px solid #6b7280',
              borderRadius: 10,
              padding: '0.6rem'
            }}
          />
          <button
            onClick={() => {
              void submitTopic();
            }}
            disabled={busy || topicInput.trim().length === 0}
            style={{
              background: '#111827',
              color: 'white',
              border: 0,
              borderRadius: 10,
              padding: '0.6rem 1rem',
              cursor: busy ? 'not-allowed' : 'pointer'
            }}
          >
            {busy ? 'Generating...' : 'Generate Study Pack'}
          </button>
        </div>
        {job ? (
          <p style={{ marginTop: 10 }}>
            Status: <strong>{job.status}</strong> | Stage: <strong>{stageLabel[job.stage]}</strong> | Progress:{' '}
            <strong>{job.progress}%</strong>
          </p>
        ) : null}
        {error ? (
          <p style={{ marginTop: 10, color: '#991b1b' }}>Error: {error}</p>
        ) : null}
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        {([
          ['overview', 'Overview'],
          ['concepts', 'Concepts'],
          ['flashcards', 'Flashcards'],
          ['quiz', 'Quiz']
        ] as Array<[Tab, string]>).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            disabled={!studyPack}
            style={{
              borderRadius: 999,
              padding: '0.45rem 0.9rem',
              border: tab === activeTab ? '2px solid #111827' : '1px solid #9ca3af',
              background: tab === activeTab ? '#dbeafe' : '#f9fafb',
              cursor: studyPack ? 'pointer' : 'not-allowed'
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {!studyPack ? (
        <section style={{ marginTop: 16, padding: '1rem', border: '1px dashed #9ca3af', borderRadius: 12 }}>
          <p style={{ margin: 0 }}>Generate a topic to load artifacts.</p>
        </section>
      ) : null}

      {studyPack && activeTab === 'overview' ? (
        <section style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          <div style={{ padding: '0.8rem', border: '1px solid #d1d5db', borderRadius: 12 }}>
            <strong>Grounding</strong>
            <p style={{ margin: '0.4rem 0 0 0' }}>
              Citation rate: {(studyPack.grounding_stats.citation_rate * 100).toFixed(0)}% | Unsupported claims:{' '}
              {studyPack.grounding_stats.unsupported_claims}
            </p>
          </div>
          {studyPack.summaries.map((summary) => (
            <article key={summary.level} style={{ padding: '0.8rem', border: '1px solid #d1d5db', borderRadius: 12 }}>
              <h3 style={{ margin: '0 0 0.4rem 0', textTransform: 'capitalize' }}>{summary.level}</h3>
              <p style={{ marginTop: 0 }}>{summary.text}</p>
              <small>Citations: {summary.citations.slice(0, 2).join(' | ')}</small>
            </article>
          ))}
        </section>
      ) : null}

      {studyPack && activeTab === 'flashcards' ? (
        <section style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          {studyPack.flashcards.map((card, idx) => (
            <article key={`${card.question}-${idx}`} style={{ padding: '0.8rem', border: '1px solid #d1d5db', borderRadius: 12 }}>
              <p style={{ margin: 0 }}><strong>Q{idx + 1}.</strong> {card.question}</p>
              <p style={{ margin: '0.4rem 0 0 0' }}><strong>A.</strong> {card.answer}</p>
              <small>{card.citation}</small>
            </article>
          ))}
        </section>
      ) : null}

      {studyPack && activeTab === 'concepts' ? (
        <section style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          <div style={{ padding: '0.8rem', border: '1px solid #d1d5db', borderRadius: 12 }}>
            <strong>Concept Graph</strong>
            <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['all', 'person', 'organization', 'event', 'concept', 'place', 'work'] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setNodeTypeFilter(value)}
                  style={{
                    borderRadius: 999,
                    border: value === nodeTypeFilter ? '2px solid #111827' : '1px solid #9ca3af',
                    background: value === nodeTypeFilter ? '#dbeafe' : '#f9fafb',
                    padding: '0.35rem 0.75rem',
                    cursor: 'pointer'
                  }}
                >
                  {value}
                </button>
              ))}
            </div>
            <p style={{ marginBottom: 0 }}>
              Nodes:{' '}
              {
                studyPack.graph.nodes.filter((n) => nodeTypeFilter === 'all' || n.type === nodeTypeFilter)
                  .length
              }{' '}
              | Edges: {studyPack.graph.edges.length}
            </p>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            {studyPack.graph.nodes
              .filter((node) => nodeTypeFilter === 'all' || node.type === nodeTypeFilter)
              .slice(0, 40)
              .map((node) => (
                <article key={node.id} style={{ padding: '0.8rem', border: '1px solid #d1d5db', borderRadius: 12 }}>
                  <p style={{ margin: 0 }}>
                    <strong>{node.label}</strong> <em>({node.type})</em>
                  </p>
                  <small>{node.citation}</small>
                </article>
              ))}
          </div>

          <div style={{ padding: '0.8rem', border: '1px solid #d1d5db', borderRadius: 12 }}>
            <strong>Relationships</strong>
            <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
              {studyPack.graph.edges.slice(0, 40).map((edge, idx) => (
                <p key={`${edge.source}-${edge.target}-${idx}`} style={{ margin: 0 }}>
                  <strong>{edge.source}</strong> --{edge.relation}--&gt; <strong>{edge.target}</strong>
                </p>
              ))}
            </div>
          </div>

          <div style={{ padding: '0.8rem', border: '1px solid #d1d5db', borderRadius: 12 }}>
            <strong>Timeline</strong>
            <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
              {studyPack.timeline.slice(0, 40).map((event, idx) => (
                <article key={`${event.year}-${idx}`} style={{ borderLeft: '4px solid #1d4ed8', paddingLeft: 10 }}>
                  <p style={{ margin: 0 }}>
                    <strong>{event.date_label}</strong>: {event.description}
                  </p>
                  <small>{event.citation}</small>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {studyPack && activeTab === 'quiz' ? (
        <section style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          {studyPack.quiz_questions.map((question, qIdx) => (
            <article key={`${question.question}-${qIdx}`} style={{ padding: '0.8rem', border: '1px solid #d1d5db', borderRadius: 12 }}>
              <p style={{ margin: 0 }}><strong>Q{qIdx + 1}.</strong> {question.question}</p>
              <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                {question.options.map((option, oIdx) => {
                  const checked = selectedAnswers[qIdx] === oIdx;
                  return (
                    <label key={`${qIdx}-${oIdx}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
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
                <p style={{ margin: '0.5rem 0 0 0' }}>
                  {selectedAnswers[qIdx] === question.correct_index ? 'Correct.' : 'Incorrect.'} {question.explanation}
                </p>
              ) : null}
            </article>
          ))}

          <div>
            <button
              onClick={() => setShowQuizResult(true)}
              style={{
                background: '#1d4ed8',
                color: 'white',
                border: 0,
                borderRadius: 10,
                padding: '0.55rem 0.9rem',
                cursor: 'pointer'
              }}
            >
              Grade Quiz
            </button>
            {quizScore ? (
              <p style={{ marginTop: 8 }}>
                Score: {quizScore.correct}/{quizScore.total}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
