import type { PackRecord, LearningProgressRecord, LearningProgressCard } from '../repo/types.js';
import { orderDueQueue } from './learningScheduler.js';

export type LearningSessionBaseline = {
  dueCards?: number;
  masteryScore?: number;
};

export type LearningSessionQueueCard = {
  position: number;
  cardIndex: number;
  question: string;
  answer: string;
  citation: string;
  promptVersion: string;
  model: string;
  reviewed: boolean;
  due: boolean;
  lastRating?: LearningProgressCard['lastRating'];
  reviewedAt?: string;
  nextDueAt?: string;
};

export type LearningSessionPayload = {
  userId: string;
  packId: string;
  status: 'ready' | 'complete';
  queue: LearningSessionQueueCard[];
  metrics: {
    totalCards: number;
    reviewedCards: number;
    dueCards: number;
    sessionTotal: number;
    completedCards: number;
    remainingCards: number;
    masteryScore: number;
    masteryDelta: number;
  };
};

const roundMetric = (value: number): number => Number(value.toFixed(4));

export const buildLearningSession = (
  pack: PackRecord,
  progress: LearningProgressRecord,
  baseline: LearningSessionBaseline = {}
): LearningSessionPayload => {
  const progressByCard = new Map(progress.cards.map((card) => [card.cardIndex, card]));
  const dueCards = orderDueQueue(
    pack.flashcards.map((card, cardIndex) => ({
      card,
      cardIndex,
      reviewed: Boolean(progressByCard.get(cardIndex)?.reviewed),
      nextDueAt: progressByCard.get(cardIndex)?.nextDueAt,
      progress: progressByCard.get(cardIndex)
    })).filter((entry) => entry.progress?.due ?? true)
  );

  const queue = dueCards.map((entry, index) => ({
    position: index + 1,
    cardIndex: entry.cardIndex,
    question: entry.card.question,
    answer: entry.card.answer,
    citation: entry.card.citation,
    promptVersion: entry.card.promptVersion,
    model: entry.card.model,
    reviewed: Boolean(entry.progress?.reviewed),
    due: entry.progress?.due ?? true,
    lastRating: entry.progress?.lastRating,
    reviewedAt: entry.progress?.reviewedAt,
    nextDueAt: entry.progress?.nextDueAt
  }));

  const sessionTotal = Math.max(baseline.dueCards ?? queue.length, queue.length);
  const completedCards = Math.max(0, sessionTotal - queue.length);
  const baselineMastery = baseline.masteryScore ?? progress.masteryScore;

  return {
    userId: progress.userId,
    packId: progress.packId,
    status: queue.length === 0 ? 'complete' : 'ready',
    queue,
    metrics: {
      totalCards: progress.totalCards,
      reviewedCards: progress.reviewedCards,
      dueCards: progress.dueCards,
      sessionTotal,
      completedCards,
      remainingCards: queue.length,
      masteryScore: roundMetric(progress.masteryScore),
      masteryDelta: roundMetric(progress.masteryScore - baselineMastery)
    }
  };
};
