import { describe, expect, it } from 'vitest';
import type { LearningProgress, StudyPack } from '../src/contracts/studyPack.js';
import { formatStudyPackExport, parseStudyPackExportFormat } from '../src/domain/studyPackExport.js';

const pack: StudyPack = {
  id: 'pack-1',
  input: 'Ada Lovelace',
  source_revision_id: 'rev-1',
  source_attribution: {
    canonical_url: 'https://en.wikipedia.org/wiki/Ada_Lovelace',
    revision_url: 'https://en.wikipedia.org/wiki/Ada_Lovelace?oldid=rev-1',
    license: 'CC BY-SA 4.0'
  },
  schema_version: '1.0.0',
  grounding_stats: {
    citation_rate: 1,
    unsupported_claims: 0
  },
  sections: [{ heading: 'Overview', content: 'Ada Lovelace wrote notes.' }],
  summaries: [
    {
      level: 'beginner',
      text: 'Ada Lovelace wrote notes about computing.',
      citations: ['source:1|"Ada Lovelace wrote notes."'],
      prompt_version: 'summary@1.0.0',
      model: 'local',
      source_provenance: [
        {
          source_revision_id: 'rev-1',
          citation: 'source:1|"Ada Lovelace wrote notes."',
          revision_url: 'https://en.wikipedia.org/wiki/Ada_Lovelace?oldid=rev-1',
          license: 'CC BY-SA 4.0'
        }
      ]
    }
  ],
  glossary: [],
  flashcards: [
    {
      question: 'What did Lovelace write?',
      answer: 'Notes about computing.',
      citation: 'source:1|"Ada Lovelace wrote notes."',
      prompt_version: 'active-recall@1.0.0',
      model: 'local',
      source_provenance: {
        source_revision_id: 'rev-1',
        citation: 'source:1|"Ada Lovelace wrote notes."',
        revision_url: 'https://en.wikipedia.org/wiki/Ada_Lovelace?oldid=rev-1',
        license: 'CC BY-SA 4.0'
      }
    }
  ],
  quiz_questions: [],
  graph: { nodes: [], edges: [] },
  timeline: [],
  recommendations: [],
  cache: { source: null, artifacts: [] },
  readiness: { status: 'partial', missing_artifacts: ['graph', 'glossary', 'quiz'], can_resume: true }
};

const progress: LearningProgress = {
  user_id: 'user-1',
  pack_id: 'pack-1',
  total_cards: 1,
  reviewed_cards: 1,
  due_cards: 0,
  mastery_score: 0.75,
  cards: [
    {
      card_index: 0,
      reviewed: true,
      due: false,
      last_rating: 'good',
      reviewed_at: '2026-01-01T10:00:00.000Z',
      next_due_at: '2026-01-04T10:00:00.000Z'
    }
  ]
};

describe('study pack exports', () => {
  it('parses supported export formats', () => {
    expect(parseStudyPackExportFormat('json')).toBe('json');
    expect(parseStudyPackExportFormat('markdown')).toBe('markdown');
    expect(parseStudyPackExportFormat('anki_csv')).toBe('anki_csv');
    expect(parseStudyPackExportFormat('pdf')).toBeUndefined();
  });

  it('exports markdown with source attribution', () => {
    const exported = formatStudyPackExport(pack, 'markdown');

    expect(exported.filename).toBe('ada-lovelace-study-pack.md');
    expect(exported.contentType).toContain('text/markdown');
    expect(exported.body).toContain('# Ada Lovelace');
    expect(exported.body).toContain('Exact revision: https://en.wikipedia.org/wiki/Ada_Lovelace?oldid=rev-1');
    expect(exported.body).toContain('## Flashcards');
  });

  it('adds learning progress to markdown exports when available', () => {
    const exported = formatStudyPackExport(pack, 'markdown', { progress });

    expect(exported.body).toContain('## Learning Progress');
    expect(exported.body).toContain('Reviewed cards: 1/1');
    expect(exported.body).toContain('Due cards: 0');
    expect(exported.body).toContain('Progress: reviewed: true; due: false; last rating: good');
  });

  it('exports Anki-compatible CSV flashcards with escaped cells', () => {
    const exported = formatStudyPackExport(pack, 'anki_csv');

    expect(exported.filename).toBe('ada-lovelace-flashcards-anki.csv');
    expect(exported.contentType).toContain('text/csv');
    expect(exported.body.split('\n')[0]).toBe('"Front","Back","Citation","Source Revision"');
    expect(exported.body).toContain('"What did Lovelace write?","Notes about computing."');
  });

  it('adds learning progress columns to Anki CSV exports when available', () => {
    const exported = formatStudyPackExport(pack, 'anki_csv', { progress });

    expect(exported.body.split('\n')[0]).toBe(
      '"Front","Back","Citation","Source Revision","Reviewed","Due","Last Rating","Reviewed At","Next Due At"'
    );
    expect(exported.body).toContain(
      '"What did Lovelace write?","Notes about computing.","source:1|""Ada Lovelace wrote notes.""","rev-1","true","false","good","2026-01-01T10:00:00.000Z","2026-01-04T10:00:00.000Z"'
    );
  });

  it('adds learning progress to JSON exports when available', () => {
    const exported = formatStudyPackExport(pack, 'json', { progress });
    const parsed = JSON.parse(exported.body) as StudyPack & { learning_progress: LearningProgress };

    expect(parsed.learning_progress).toMatchObject({
      user_id: 'user-1',
      reviewed_cards: 1,
      due_cards: 0
    });
  });
});
