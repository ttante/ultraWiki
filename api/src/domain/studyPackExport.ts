import type { LearningProgress, StudyPack } from '../contracts/studyPack.js';

export type StudyPackExportFormat = 'json' | 'markdown' | 'anki_csv';

export type StudyPackExport = {
  body: string;
  contentType: string;
  filename: string;
};

export type StudyPackExportOptions = {
  progress?: LearningProgress;
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

const boolCell = (value: boolean): string => (value ? 'true' : 'false');

const progressCardsByIndex = (progress?: LearningProgress): Map<number, LearningProgress['cards'][number]> =>
  new Map((progress?.cards ?? []).map((card) => [card.card_index, card]));

export const parseStudyPackExportFormat = (value: unknown): StudyPackExportFormat | undefined => {
  if (value === 'json' || value === 'markdown' || value === 'anki_csv') {
    return value;
  }
  return undefined;
};

const formatProgressSummary = (progress: LearningProgress): string[] => [
  '## Learning Progress',
  '',
  `Reviewed cards: ${progress.reviewed_cards}/${progress.total_cards}`,
  `Due cards: ${progress.due_cards}`,
  `Mastery score: ${Math.round(progress.mastery_score * 100)}%`,
  ...(progress.next_due_at ? [`Next due: ${progress.next_due_at}`] : []),
  ''
];

const formatCardProgress = (card: LearningProgress['cards'][number] | undefined): string => {
  if (!card) {
    return 'Progress: not reviewed; due';
  }
  const pieces = [`reviewed: ${boolCell(card.reviewed)}`, `due: ${boolCell(card.due)}`];
  if (card.last_rating) {
    pieces.push(`last rating: ${card.last_rating}`);
  }
  if (card.reviewed_at) {
    pieces.push(`reviewed at: ${card.reviewed_at}`);
  }
  if (card.next_due_at) {
    pieces.push(`next due: ${card.next_due_at}`);
  }
  return `Progress: ${pieces.join('; ')}`;
};

const formatMarkdown = (pack: StudyPack, progress?: LearningProgress): string => {
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
  if (progress) {
    lines.splice(7, 0, ...formatProgressSummary(progress));
  }

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
  const progressByCard = progressCardsByIndex(progress);
  pack.flashcards.forEach((card, index) => {
    const cardProgress = progressByCard.get(index);
    const progressLines = progress ? ['', formatCardProgress(cardProgress)] : [];
    lines.push(`### ${card.question}`, '', card.answer, '', bullet(card.citation), ...progressLines, '');
  });

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

const formatAnkiCsv = (pack: StudyPack, progress?: LearningProgress): string => {
  const progressByCard = progressCardsByIndex(progress);
  const rows = progress
    ? [['Front', 'Back', 'Citation', 'Source Revision', 'Reviewed', 'Due', 'Last Rating', 'Reviewed At', 'Next Due At']]
    : [['Front', 'Back', 'Citation', 'Source Revision']];
  pack.flashcards.forEach((card, index) => {
    const row = [card.question, card.answer, card.citation, pack.source_revision_id];
    if (progress) {
      const cardProgress = progressByCard.get(index);
      row.push(
        boolCell(cardProgress?.reviewed ?? false),
        boolCell(cardProgress?.due ?? true),
        cardProgress?.last_rating ?? '',
        cardProgress?.reviewed_at ?? '',
        cardProgress?.next_due_at ?? ''
      );
    }
    rows.push(row);
  });
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
};

export const formatStudyPackExport = (pack: StudyPack, format: StudyPackExportFormat, options: StudyPackExportOptions = {}): StudyPackExport => {
  const baseName = slugify(pack.input);

  if (format === 'json') {
    const payload = options.progress ? { ...pack, learning_progress: options.progress } : pack;
    return {
      body: `${JSON.stringify(payload, null, 2)}\n`,
      contentType: 'application/json; charset=utf-8',
      filename: `${baseName}-study-pack.json`
    };
  }

  if (format === 'anki_csv') {
    return {
      body: formatAnkiCsv(pack, options.progress),
      contentType: 'text/csv; charset=utf-8',
      filename: `${baseName}-flashcards-anki.csv`
    };
  }

  return {
    body: formatMarkdown(pack, options.progress),
    contentType: 'text/markdown; charset=utf-8',
    filename: `${baseName}-study-pack.md`
  };
};
