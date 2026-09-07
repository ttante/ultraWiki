import { flashcardReviewPolicy, isFlashcardDue } from './learningScheduler.js';
import type {
  FlashcardReviewRating,
  LearningAnalyticsRecord,
  LearningSessionRecord,
  QuizAttemptRecord,
  StudyGoalRecord
} from '../repo/types.js';

export type LearningAnalyticsPackInput = {
  packId: string;
  totalCards: number;
};

export type LearningAnalyticsReviewInput = {
  packId: string;
  cardIndex: number;
  rating: FlashcardReviewRating;
  reviewedAt: string;
  nextDueAt: string;
};

const average = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
};

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

const roundMetric = (value: number): number => Number(value.toFixed(6));

const validTime = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const dayKey = (value: string): string | undefined => {
  const parsed = validTime(value);
  return parsed === undefined ? undefined : new Date(parsed).toISOString().slice(0, 10);
};

const addUtcDays = (day: string, days: number): string => {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const computeStreak = (
  timestamps: string[],
  now: Date
): { currentDays: number; longestDays: number; lastActivityAt?: string } => {
  const orderedTimestamps = timestamps
    .map((value) => ({ value, time: validTime(value) }))
    .filter((entry): entry is { value: string; time: number } => entry.time !== undefined)
    .sort((a, b) => a.time - b.time);
  const days = new Set(orderedTimestamps.map((entry) => dayKey(entry.value)).filter((value): value is string => Boolean(value)));

  let longestDays = 0;
  let run = 0;
  let previousDay: string | undefined;
  for (const day of [...days].sort()) {
    run = previousDay && day === addUtcDays(previousDay, 1) ? run + 1 : 1;
    longestDays = Math.max(longestDays, run);
    previousDay = day;
  }

  const today = now.toISOString().slice(0, 10);
  const yesterday = addUtcDays(today, -1);
  let cursor = days.has(today) ? today : days.has(yesterday) ? yesterday : undefined;
  let currentDays = 0;
  while (cursor && days.has(cursor)) {
    currentDays += 1;
    cursor = addUtcDays(cursor, -1);
  }

  return {
    currentDays,
    longestDays,
    lastActivityAt: orderedTimestamps[orderedTimestamps.length - 1]?.value
  };
};

const computeGoalProgress = (
  userId: string,
  goal: StudyGoalRecord | undefined,
  reviews: LearningAnalyticsReviewInput[],
  now: Date
): LearningAnalyticsRecord['goal'] => {
  const today = now.toISOString().slice(0, 10);
  const reviewsToday = reviews.filter((review) => dayKey(review.reviewedAt) === today).length;
  const effectiveGoal = goal?.userId === userId ? goal : undefined;
  const dailyTargetReviews = Math.max(0, effectiveGoal?.dailyTargetReviews ?? 0);
  return {
    dailyTargetReviews,
    reviewsToday,
    remainingToday: dailyTargetReviews === 0 ? 0 : Math.max(0, dailyTargetReviews - reviewsToday),
    targetMet: dailyTargetReviews > 0 && reviewsToday >= dailyTargetReviews,
    createdAt: effectiveGoal?.createdAt,
    updatedAt: effectiveGoal?.updatedAt
  };
};

export const buildLearningAnalyticsRecord = (
  userId: string,
  packs: LearningAnalyticsPackInput[],
  reviews: LearningAnalyticsReviewInput[],
  quizAttempts: QuizAttemptRecord[],
  sessions: LearningSessionRecord[],
  goal?: StudyGoalRecord,
  now: Date = new Date()
): LearningAnalyticsRecord => {
  const packTotals = new Map(packs.map((pack) => [pack.packId, Math.max(0, pack.totalCards)]));
  const latestReviews = new Map<string, LearningAnalyticsReviewInput>();

  for (const review of reviews) {
    const totalCards = packTotals.get(review.packId);
    if (totalCards === undefined || review.cardIndex < 0 || review.cardIndex >= totalCards) {
      continue;
    }
    const key = `${review.packId}:${review.cardIndex}`;
    const existing = latestReviews.get(key);
    if (!existing || (validTime(review.reviewedAt) ?? 0) >= (validTime(existing.reviewedAt) ?? 0)) {
      latestReviews.set(key, review);
    }
  }

  const attemptsByPack = quizAttempts.reduce((acc, attempt) => {
    if (!packTotals.has(attempt.packId)) {
      return acc;
    }
    const rows = acc.get(attempt.packId) ?? [];
    rows.push(attempt);
    acc.set(attempt.packId, rows);
    return acc;
  }, new Map<string, QuizAttemptRecord[]>());

  const packSummaries = packs.map((pack) => {
    const totalCards = packTotals.get(pack.packId) ?? 0;
    const latestForPack = [...latestReviews.values()].filter((review) => review.packId === pack.packId);
    const reviewedCards = latestForPack.length;
    const dueReviewedCards = latestForPack.filter((review) => isFlashcardDue(review.nextDueAt, now)).length;
    const retainedCards = reviewedCards - dueReviewedCards;
    const dueCards = Math.max(0, totalCards - reviewedCards) + dueReviewedCards;
    const masteryScore =
      totalCards === 0
        ? 0
        : clampUnit(
            latestForPack.reduce((acc, review) => acc + flashcardReviewPolicy.masteryScoreByRating[review.rating], 0) / totalCards
          );
    const latestAttempt = [...(attemptsByPack.get(pack.packId) ?? [])].sort(
      (a, b) => (validTime(b.submittedAt) ?? 0) - (validTime(a.submittedAt) ?? 0) || b.attemptNumber - a.attemptNumber
    )[0];
    const nextDueAt = latestForPack
      .map((review) => review.nextDueAt)
      .filter((value) => validTime(value) !== undefined)
      .sort((a, b) => (validTime(a) ?? 0) - (validTime(b) ?? 0))[0];
    const lastReviewedAt = latestForPack
      .map((review) => review.reviewedAt)
      .filter((value) => validTime(value) !== undefined)
      .sort((a, b) => (validTime(b) ?? 0) - (validTime(a) ?? 0))[0];

    return {
      packId: pack.packId,
      totalCards,
      reviewedCards,
      dueCards,
      retainedCards,
      retentionRate: reviewedCards === 0 ? 0 : roundMetric(retainedCards / reviewedCards),
      masteryScore: roundMetric(masteryScore),
      nextDueAt,
      lastReviewedAt,
      quizAttempts: attemptsByPack.get(pack.packId)?.length ?? 0,
      latestAccuracy: latestAttempt?.accuracy,
      accuracyDelta: latestAttempt?.accuracyDelta
    };
  });

  const validAttempts = quizAttempts
    .filter((attempt) => packTotals.has(attempt.packId))
    .sort((a, b) => (validTime(a.submittedAt) ?? 0) - (validTime(b.submittedAt) ?? 0) || a.attemptNumber - b.attemptNumber);
  const accuracyTrend = validAttempts.slice(-12).map((attempt) => ({
    packId: attempt.packId,
    attemptNumber: attempt.attemptNumber,
    submittedAt: attempt.submittedAt,
    accuracy: roundMetric(attempt.accuracy),
    accuracyDelta: roundMetric(attempt.accuracyDelta),
    masteryScore: roundMetric(attempt.masteryScore)
  }));
  const latestAttempt = validAttempts[validAttempts.length - 1];

  const sessionTrend = sessions
    .filter((session) => packTotals.has(session.packId))
    .map((session) => ({
      source: 'session' as const,
      packId: session.packId,
      recordedAt: session.completedAt ?? session.startedAt,
      masteryScore: roundMetric(session.outcome.masteryScore),
      masteryDelta: roundMetric(session.outcome.masteryDelta)
    }));
  const quizMasteryTrend = validAttempts.map((attempt) => ({
    source: 'quiz' as const,
    packId: attempt.packId,
    recordedAt: attempt.submittedAt,
    masteryScore: roundMetric(attempt.masteryScore),
    masteryDelta: roundMetric(attempt.masteryDelta)
  }));
  const masteryTrend = [...sessionTrend, ...quizMasteryTrend]
    .filter((point) => validTime(point.recordedAt) !== undefined)
    .sort((a, b) => (validTime(a.recordedAt) ?? 0) - (validTime(b.recordedAt) ?? 0))
    .slice(-12);

  const reviewedCards = packSummaries.reduce((acc, pack) => acc + pack.reviewedCards, 0);
  const retainedCards = packSummaries.reduce((acc, pack) => acc + pack.retainedCards, 0);
  const dueCards = packSummaries.reduce((acc, pack) => acc + pack.dueCards, 0);
  const activityTimestamps = [
    ...reviews.map((review) => review.reviewedAt),
    ...validAttempts.map((attempt) => attempt.submittedAt),
    ...sessions.map((session) => session.completedAt ?? session.startedAt)
  ];

  return {
    userId,
    generatedAt: now.toISOString(),
    totalCards: packSummaries.reduce((acc, pack) => acc + pack.totalCards, 0),
    reviewedCards,
    dueCards,
    duePacks: packSummaries.filter((pack) => pack.dueCards > 0).length,
    streak: computeStreak(activityTimestamps, now),
    goal: computeGoalProgress(userId, goal, reviews.filter((review) => packTotals.has(review.packId)), now),
    retention: {
      reviewedCards,
      retainedCards,
      dueReviewedCards: reviewedCards - retainedCards,
      retentionRate: reviewedCards === 0 ? 0 : roundMetric(retainedCards / reviewedCards)
    },
    mastery: {
      averageScore: roundMetric(average(packSummaries.map((pack) => pack.masteryScore))),
      averageDelta: roundMetric(average(masteryTrend.map((point) => point.masteryDelta))),
      trend: masteryTrend
    },
    accuracy: {
      attempts: validAttempts.length,
      retakes: validAttempts.filter((attempt) => attempt.attemptNumber > 1).length,
      averageAccuracy: roundMetric(average(validAttempts.map((attempt) => attempt.accuracy))),
      latestAccuracy: latestAttempt?.accuracy === undefined ? undefined : roundMetric(latestAttempt.accuracy),
      accuracyDelta: latestAttempt?.accuracyDelta === undefined ? 0 : roundMetric(latestAttempt.accuracyDelta),
      trend: accuracyTrend
    },
    packs: packSummaries
  };
};
