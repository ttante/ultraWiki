import { describe, expect, it } from 'vitest';
import {
  computeMasteryScore,
  getRatingTransition,
  isFlashcardDue,
  orderDueQueue,
  scheduleFlashcardReview
} from '../src/domain/learningScheduler.js';

describe('learning scheduler', () => {
  it('maps ratings to deterministic intervals and mastery transitions', () => {
    const reviewedAt = new Date('2026-01-01T12:00:00.000Z');

    expect(scheduleFlashcardReview('again', reviewedAt)).toMatchObject({
      reviewedAt: '2026-01-01T12:00:00.000Z',
      nextDueAt: '2026-01-01T12:10:00.000Z',
      intervalMs: 10 * 60 * 1000,
      masteryScore: 0
    });
    expect(scheduleFlashcardReview('hard', reviewedAt).nextDueAt).toBe('2026-01-02T12:00:00.000Z');
    expect(scheduleFlashcardReview('good', reviewedAt).nextDueAt).toBe('2026-01-04T12:00:00.000Z');
    expect(scheduleFlashcardReview('easy', reviewedAt).nextDueAt).toBe('2026-01-08T12:00:00.000Z');
    expect(getRatingTransition('hard')).toEqual({ intervalMs: 24 * 60 * 60 * 1000, masteryScore: 0.4 });
  });

  it('orders overdue cards by oldest due timestamp before new cards', () => {
    const ordered = orderDueQueue([
      { cardIndex: 3, reviewed: false },
      { cardIndex: 1, reviewed: true, nextDueAt: '2026-01-03T00:00:00.000Z' },
      { cardIndex: 2, reviewed: true, nextDueAt: '2026-01-01T00:00:00.000Z' },
      { cardIndex: 0, reviewed: false }
    ]);

    expect(ordered.map((card) => card.cardIndex)).toEqual([2, 1, 0, 3]);
  });

  it('computes due state and mastery score from rating transitions', () => {
    expect(isFlashcardDue(undefined, new Date('2026-01-01T00:00:00.000Z'))).toBe(true);
    expect(isFlashcardDue('2025-12-31T23:59:00.000Z', new Date('2026-01-01T00:00:00.000Z'))).toBe(true);
    expect(isFlashcardDue('2026-01-01T00:01:00.000Z', new Date('2026-01-01T00:00:00.000Z'))).toBe(false);
    expect(computeMasteryScore(['again', 'hard', 'good', 'easy'], 4)).toBe(0.5375);
  });
});
