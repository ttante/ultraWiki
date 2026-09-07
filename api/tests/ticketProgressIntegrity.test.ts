import { describe, expect, it } from 'vitest';
import { validateTicketProgressIntegrity } from '../src/domain/ticketProgressIntegrity.js';

const tracker = ({
  queueRows,
  activeRows
}: {
  queueRows: string[];
  activeRows: string[];
}) => [
  '# Tracker',
  '',
  '## LLM_NEXT_QUEUE',
  '<!-- LLM_NEXT_QUEUE_START -->',
  '| Rank | Ticket | Status | Priority | Depends On | Blocked By | Size | Next Action | Required Tests | Likely Files |',
  '|---:|---|---|---|---|---|---|---|---|---|',
  ...queueRows,
  '<!-- LLM_NEXT_QUEUE_END -->',
  '',
  '## Active Ticket Status',
  '| Ticket | Title | Status | Priority | last_worked_at | completed_at | Blockers | Next Action | Future Work / Notes |',
  '|---|---|---|---|---|---|---|---|---|',
  ...activeRows,
  '',
  '## Work Log',
  '| Timestamp | Ticket | Status Change | Summary | Validation |',
  '|---|---|---|---|---|'
].join('\n');

const queueRow = (rank: number, ticket: string, status = 'next', priority = 'P1', blockedBy = 'None') =>
  `| ${rank} | ${ticket} | ${status} | ${priority} | None | ${blockedBy} | S | Do work. | Test. | \`docs/ticket-progress.md\` |`;

const activeRow = (ticket: string, status = 'next', priority = 'P1', blockers = 'None') =>
  `| ${ticket} | Ticket ${ticket} | ${status} | ${priority} | 2026-05-25T00:00:00-05:00 |  | ${blockers} | Do work. | Notes. |`;

describe('validateTicketProgressIntegrity', () => {
  it('accepts a queue that mirrors all remaining active tickets when fewer than 50 remain', () => {
    const result = validateTicketProgressIntegrity(
      tracker({
        queueRows: [queueRow(1, 'T2.1'), queueRow(2, 'T2.2', 'blocked', 'P2', 'T2.1')],
        activeRows: [
          activeRow('T1.1', 'done'),
          activeRow('T2.1'),
          activeRow('T2.2', 'blocked', 'P2', 'T2.1')
        ]
      })
    );

    expect(result.valid).toBe(true);
    expect(result.queueRows).toHaveLength(2);
    expect(result.expectedQueueCount).toBe(2);
  });

  it('rejects stale queue status, priority, blocker, and rank order', () => {
    const result = validateTicketProgressIntegrity(
      tracker({
        queueRows: [queueRow(2, 'T2.2'), queueRow(1, 'T2.1', 'next', 'P2', 'None')],
        activeRows: [
          activeRow('T2.1'),
          activeRow('T2.2', 'blocked', 'P1', 'T2.1')
        ]
      })
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('queue row 1 has rank 2; expected 1');
    expect(result.errors.join(' ')).toContain('queue ticket T2.2 status mismatch');
    expect(result.errors.join(' ')).toContain('queue ticket T2.2 blocker mismatch');
    expect(result.errors.join(' ')).toContain('queue ticket T2.1 priority mismatch');
    expect(result.errors.join(' ')).toContain('queue rank 1 expected T2.1 from active ticket order but found T2.2');
  });

  it('rejects queues that omit remaining active tickets when fewer than 50 remain', () => {
    const result = validateTicketProgressIntegrity(
      tracker({
        queueRows: [queueRow(1, 'T2.1')],
        activeRows: [activeRow('T2.1'), activeRow('T2.2')]
      })
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('LLM_NEXT_QUEUE has 1 rows; expected 2');
  });

  it('requires exactly the next 50 active tickets when more than 50 remain', () => {
    const activeRows = Array.from({ length: 51 }, (_, index) => activeRow(`T${index + 1}.1`));
    const validRows = Array.from({ length: 50 }, (_, index) => queueRow(index + 1, `T${index + 1}.1`));
    const valid = validateTicketProgressIntegrity(tracker({ queueRows: validRows, activeRows }));
    expect(valid.valid).toBe(true);
    expect(valid.expectedQueueCount).toBe(50);

    const short = validateTicketProgressIntegrity(tracker({ queueRows: validRows.slice(0, 49), activeRows }));
    expect(short.valid).toBe(false);
    expect(short.errors.join(' ')).toContain('LLM_NEXT_QUEUE has 49 rows; expected 50');
  });
});
