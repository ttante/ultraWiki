import type { StudyPack } from '../contracts/studyPack.js';

export type StudyPackExportFormat = 'json' | 'markdown' | 'anki_csv';

export type StudyPackExport = {
  body: string;
  contentType: string;
  filename: string;
};

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'study-pack';

const csvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const bullet = (value: string): string => `- ${value}`;

export const parseStudyPackExportFormat = (value: unknown): StudyPackExportFormat | undefined => {
  if (value === 'json' || value === 'markdown' || value === 'anki_csv') {
    return value;
  }
  return undefined;
};

const formatMarkdown = (pack: StudyPack): string => {
  const lines: string[] = [
    `# ${pack.input}`,
    '',
    `Source revision: ${pack.source_revision_id}`,
    `Canonical source: ${pack.source_attribution.canonical_url}`,
    `Exact revision: ${pack.source_attribution.revision_url}`,
    `License: ${pack.source_attribution.license}`,
    '',
    '## Summaries',
    ''
  ];

  for (const summary of pack.summaries) {
    lines.push(`### ${summary.level}`, '', summary.text, '', ...summary.citations.map(bullet), '');
  }

  lines.push('## Glossary', '');
  for (const term of pack.glossary) {
    lines.push(`### ${term.term}`, '', term.definition, '', bullet(term.citation), '');
  }

  lines.push('## Timeline', '');
  for (const event of pack.timeline) {
    lines.push(`### ${event.date_label}`, '', event.description, '', bullet(event.citation), '');
  }

  lines.push('## Flashcards', '');
  for (const card of pack.flashcards) {
    lines.push(`### ${card.question}`, '', card.answer, '', bullet(card.citation), '');
  }

  lines.push('## Quiz', '');
  for (const question of pack.quiz_questions) {
    lines.push(`### ${question.question}`, '');
    question.options.forEach((option, index) => {
      const marker = index === question.correct_index ? 'correct' : 'choice';
      lines.push(`- ${option} (${marker})`);
    });
    lines.push('', question.explanation, '', bullet(question.citation), '');
  }

  return `${lines.join('\n').trim()}\n`;
};

const formatAnkiCsv = (pack: StudyPack): string => {
  const rows = [['Front', 'Back', 'Citation', 'Source Revision']];
  for (const card of pack.flashcards) {
    rows.push([card.question, card.answer, card.citation, pack.source_revision_id]);
  }
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
};

export const formatStudyPackExport = (pack: StudyPack, format: StudyPackExportFormat): StudyPackExport => {
  const baseName = slugify(pack.input);

  if (format === 'json') {
    return {
      body: `${JSON.stringify(pack, null, 2)}\n`,
      contentType: 'application/json; charset=utf-8',
      filename: `${baseName}-study-pack.json`
    };
  }

  if (format === 'anki_csv') {
    return {
      body: formatAnkiCsv(pack),
      contentType: 'text/csv; charset=utf-8',
      filename: `${baseName}-flashcards-anki.csv`
    };
  }

  return {
    body: formatMarkdown(pack),
    contentType: 'text/markdown; charset=utf-8',
    filename: `${baseName}-study-pack.md`
  };
};
