import type { FlashcardReviewRating } from '../repo/types.js';

export const flashcardReviewPolicy = {
  intervalsMs: {
    again: 10 * 60 * 1000,
    hard: 24 * 60 * 60 * 1000,
    good: 3 * 24 * 60 * 60 * 1000,
    easy: 7 * 24 * 60 * 60 * 1000
  },
  masteryScoreByRating: {
    again: 0,
    hard: 0.4,
    good: 0.75,
    easy: 1
  }
} as const satisfies {
  intervalsMs: Record<FlashcardReviewRating, number>;
  masteryScoreByRating: Record<FlashcardReviewRating, number>;
};

export type RatingTransition = {
  intervalMs: number;
  masteryScore: number;
};

export type ScheduledFlashcardReview = RatingTransition & {
  reviewedAt: string;
  nextDueAt: string;
};

export type DueQueueOrderInput = {
  cardIndex: number;
  reviewed: boolean;
  nextDueAt?: string;
};

export const getRatingTransition = (rating: FlashcardReviewRating): RatingTransition => ({
  intervalMs: flashcardReviewPolicy.intervalsMs[rating],
  masteryScore: flashcardReviewPolicy.masteryScoreByRating[rating]
});

export const scheduleFlashcardReview = (
  rating: FlashcardReviewRating,
  reviewedAt: Date = new Date()
): ScheduledFlashcardReview => {
  const transition = getRatingTransition(rating);
  const reviewedAtMs = reviewedAt.getTime();
  return {
    ...transition,
    reviewedAt: new Date(reviewedAtMs).toISOString(),
    nextDueAt: new Date(reviewedAtMs + transition.intervalMs).toISOString()
  };
};

export const isFlashcardDue = (nextDueAt: string | undefined, now: Date = new Date()): boolean => {
  if (!nextDueAt) {
    return true;
  }
  const parsed = Date.parse(nextDueAt);
  return Number.isFinite(parsed) ? parsed <= now.getTime() : true;
};

export const computeMasteryScore = (ratings: FlashcardReviewRating[], totalCards: number): number => {
  if (totalCards <= 0) {
    return 0;
  }
  const score = ratings.reduce((acc, rating) => acc + flashcardReviewPolicy.masteryScoreByRating[rating], 0) / totalCards;
  return Math.max(0, Math.min(1, score));
};

const dueTimestamp = (card: DueQueueOrderInput): number | undefined => {
  if (!card.nextDueAt) {
    return undefined;
  }
  const parsed = Date.parse(card.nextDueAt);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const compareDueQueueCards = (a: DueQueueOrderInput, b: DueQueueOrderInput): number => {
  const aDueAt = dueTimestamp(a);
  const bDueAt = dueTimestamp(b);
  if (aDueAt !== undefined && bDueAt !== undefined && aDueAt !== bDueAt) {
    return aDueAt - bDueAt;
  }
  if (aDueAt !== undefined && bDueAt === undefined) {
    return -1;
  }
  if (aDueAt === undefined && bDueAt !== undefined) {
    return 1;
  }
  return a.cardIndex - b.cardIndex;
};

export const orderDueQueue = <T extends DueQueueOrderInput>(cards: T[]): T[] => [...cards].sort(compareDueQueueCards);
