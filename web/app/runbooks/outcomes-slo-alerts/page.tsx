import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { opsRunbookSourcePath } from '../../../lib/runbook-links';

export const dynamic = 'force-static';

export const metadata = {
  title: 'Outcomes SLO Alerts Runbook'
};

export const markdownHeadingId = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');

const runbookCandidates = [
  path.resolve(process.cwd(), '..', opsRunbookSourcePath),
  path.resolve(process.cwd(), opsRunbookSourcePath)
];

export const loadRunbookMarkdown = (): string => {
  const runbookPath = runbookCandidates.find((candidate) => existsSync(candidate));
  if (!runbookPath) {
    throw new Error(`Runbook source not found: ${opsRunbookSourcePath}`);
  }

  return readFileSync(runbookPath, 'utf8');
};

const renderInline = (text: string): React.ReactNode[] =>
  text.split(/(`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    }

    return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
  });

const renderMarkdownLine = (line: string, index: number): React.ReactNode | null => {
  const heading = /^(#{1,3})\s+(.+)$/.exec(line);
  if (heading) {
    const level = heading[1].length;
    const text = heading[2];
    const id = markdownHeadingId(text);
    if (level === 1) return <h1 id={id} key={`${id}-${index}`}>{renderInline(text)}</h1>;
    if (level === 2) return <h2 id={id} key={`${id}-${index}`}>{renderInline(text)}</h2>;
    return <h3 id={id} key={`${id}-${index}`}>{renderInline(text)}</h3>;
  }

  if (/^\d+\.\s+/.test(line)) {
    return <p className="uw-runbook-step" key={`line-${index}`}>{renderInline(line)}</p>;
  }

  if (line.startsWith('- ')) {
    return <p className="uw-runbook-bullet" key={`line-${index}`}>{renderInline(line.slice(2))}</p>;
  }

  if (!line.trim()) {
    return null;
  }

  return <p key={`line-${index}`}>{renderInline(line)}</p>;
};

export const renderRunbookMarkdown = (markdown: string): React.ReactNode[] =>
  markdown.split('\n').map(renderMarkdownLine).filter((line): line is React.ReactNode => line !== null);

export default function OutcomesSloRunbookPage() {
  return (
    <main className="uw-runbook-page" aria-label="Outcomes SLO alerts runbook">
      {renderRunbookMarkdown(loadRunbookMarkdown())}
    </main>
  );
}
