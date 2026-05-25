import { describe, expect, it } from 'vitest';
import type { StudyPack } from '../src/contracts/studyPack.js';
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

  it('exports Anki-compatible CSV flashcards with escaped cells', () => {
    const exported = formatStudyPackExport(pack, 'anki_csv');

    expect(exported.filename).toBe('ada-lovelace-flashcards-anki.csv');
    expect(exported.contentType).toContain('text/csv');
    expect(exported.body.split('\n')[0]).toBe('"Front","Back","Citation","Source Revision"');
    expect(exported.body).toContain('"What did Lovelace write?","Notes about computing."');
  });
});
