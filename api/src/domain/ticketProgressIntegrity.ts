export type TicketProgressQueueRow = {
  rank: number;
  ticket: string;
  status: string;
  priority: string;
  dependsOn: string;
  blockedBy: string;
};

export type TicketProgressActiveRow = {
  ticket: string;
  title: string;
  status: string;
  priority: string;
  blockers: string;
};

export type TicketProgressIntegrityResult = {
  valid: boolean;
  errors: string[];
  queueRows: TicketProgressQueueRow[];
  activeRows: TicketProgressActiveRow[];
  remainingRows: TicketProgressActiveRow[];
  expectedQueueCount: number;
};

const queueStart = '<!-- LLM_NEXT_QUEUE_START -->';
const queueEnd = '<!-- LLM_NEXT_QUEUE_END -->';
const remainingStatuses = new Set(['next', 'in_progress', 'blocked', 'planned']);
const closedStatuses = new Set(['done', 'canceled']);

const normalizeBlocker = (value: string | undefined): string => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'None';
};

const splitMarkdownRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

const parseMarkdownTable = (section: string, label: string): Array<Record<string, string>> => {
  const tableLines = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'));

  const headerIndex = tableLines.findIndex((line, index) => {
    const next = tableLines[index + 1];
    return Boolean(next && /^\|\s*:?-{3,}/.test(next));
  });

  if (headerIndex === -1) {
    throw new Error(`${label} table not found`);
  }

  const headers = splitMarkdownRow(tableLines[headerIndex]);
  const rows: Array<Record<string, string>> = [];

  for (const line of tableLines.slice(headerIndex + 2)) {
    if (/^\|\s*:?-{3,}/.test(line)) {
      continue;
    }
    const values = splitMarkdownRow(line);
    if (values.length !== headers.length) {
      throw new Error(`${label} row has ${values.length} cells; expected ${headers.length}: ${line}`);
    }
    rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
  }

  return rows;
};

const getQueueSection = (markdown: string): string => {
  const start = markdown.indexOf(queueStart);
  const end = markdown.indexOf(queueEnd);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM_NEXT_QUEUE markers are missing or out of order');
  }
  return markdown.slice(start + queueStart.length, end);
};

const getHeadingSection = (markdown: string, heading: string): string => {
  const start = markdown.indexOf(`## ${heading}`);
  if (start === -1) {
    throw new Error(`${heading} section not found`);
  }
  const rest = markdown.slice(start + `## ${heading}`.length);
  const nextHeading = rest.search(/\n## /);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
};

export const parseTicketProgressQueue = (markdown: string): TicketProgressQueueRow[] => {
  return parseMarkdownTable(getQueueSection(markdown), 'LLM_NEXT_QUEUE').map((row) => ({
    rank: Number.parseInt(row.Rank ?? '', 10),
    ticket: row.Ticket ?? '',
    status: row.Status ?? '',
    priority: row.Priority ?? '',
    dependsOn: row['Depends On'] ?? '',
    blockedBy: normalizeBlocker(row['Blocked By'])
  }));
};

export const parseActiveTicketStatus = (markdown: string): TicketProgressActiveRow[] => {
  return parseMarkdownTable(getHeadingSection(markdown, 'Active Ticket Status'), 'Active Ticket Status').map((row) => ({
    ticket: row.Ticket ?? '',
    title: row.Title ?? '',
    status: row.Status ?? '',
    priority: row.Priority ?? '',
    blockers: normalizeBlocker(row.Blockers)
  }));
};

export const validateTicketProgressIntegrity = (markdown: string): TicketProgressIntegrityResult => {
  const errors: string[] = [];
  let queueRows: TicketProgressQueueRow[] = [];
  let activeRows: TicketProgressActiveRow[] = [];

  try {
    queueRows = parseTicketProgressQueue(markdown);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    activeRows = parseActiveTicketStatus(markdown);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const remainingRows = activeRows.filter((row) => remainingStatuses.has(row.status));
  const expectedQueueCount = Math.min(50, remainingRows.length);
  const activeByTicket = new Map(activeRows.map((row) => [row.ticket, row]));
  const seenQueueTickets = new Set<string>();
  const seenActiveTickets = new Set<string>();

  for (const row of activeRows) {
    if (!row.ticket) {
      errors.push('active ticket row is missing Ticket');
      continue;
    }
    if (seenActiveTickets.has(row.ticket)) {
      errors.push(`active ticket appears more than once: ${row.ticket}`);
    }
    seenActiveTickets.add(row.ticket);
    if (!remainingStatuses.has(row.status) && !closedStatuses.has(row.status)) {
      errors.push(`active ticket ${row.ticket} has unknown status: ${row.status}`);
    }
  }

  if (queueRows.length !== expectedQueueCount) {
    errors.push(
      `LLM_NEXT_QUEUE has ${queueRows.length} rows; expected ${expectedQueueCount} (${remainingRows.length >= 50 ? 'next 50 active tickets' : 'all remaining active tickets'})`
    );
  }

  queueRows.forEach((row, index) => {
    const expectedRank = index + 1;
    if (row.rank !== expectedRank) {
      errors.push(`queue row ${index + 1} has rank ${Number.isNaN(row.rank) ? 'NaN' : row.rank}; expected ${expectedRank}`);
    }
    if (!row.ticket) {
      errors.push(`queue row ${expectedRank} is missing Ticket`);
      return;
    }
    if (seenQueueTickets.has(row.ticket)) {
      errors.push(`queue ticket appears more than once: ${row.ticket}`);
    }
    seenQueueTickets.add(row.ticket);

    const active = activeByTicket.get(row.ticket);
    if (!active) {
      errors.push(`queue ticket is not present in Active Ticket Status: ${row.ticket}`);
      return;
    }
    if (closedStatuses.has(active.status)) {
      errors.push(`queue ticket ${row.ticket} has closed active status: ${active.status}`);
    }
    if (row.status !== active.status) {
      errors.push(`queue ticket ${row.ticket} status mismatch: queue=${row.status} active=${active.status}`);
    }
    if (row.priority !== active.priority) {
      errors.push(`queue ticket ${row.ticket} priority mismatch: queue=${row.priority} active=${active.priority}`);
    }
    if (row.blockedBy !== active.blockers) {
      errors.push(`queue ticket ${row.ticket} blocker mismatch: queue=${row.blockedBy} active=${active.blockers}`);
    }
  });

  for (let index = 0; index < Math.min(queueRows.length, expectedQueueCount); index += 1) {
    const expected = remainingRows[index];
    const actual = queueRows[index];
    if (expected && actual && expected.ticket !== actual.ticket) {
      errors.push(`queue rank ${index + 1} expected ${expected.ticket} from active ticket order but found ${actual.ticket}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    queueRows,
    activeRows,
    remainingRows,
    expectedQueueCount
  };
};
