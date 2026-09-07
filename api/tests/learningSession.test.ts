import { describe, expect, it } from 'vitest';
import { buildLearningSession } from '../src/domain/learningSession.js';
import type { LearningProgressRecord, PackRecord } from '../src/repo/types.js';

const pack = {
  id: 'pack-session',
  input: 'Ada Lovelace',
  sourceRevisionId: 'rev-session',
  createdAt: '2026-01-01T00:00:00.000Z',
  sections: [],
  outgoingLinks: [],
  cacheEvents: [],
  summaries: [],
  glossary: [],
  graphNodes: [],
  graphEdges: [],
  timelineEvents: [],
  quizQuestions: [],
  flashcards: [
    { question: 'Card 1?', answer: 'Answer 1', citation: 'c1', promptVersion: 'v1', model: 'm1' },
    { question: 'Card 2?', answer: 'Answer 2', citation: 'c2', promptVersion: 'v1', model: 'm1' },
    { question: 'Card 3?', answer: 'Answer 3', citation: 'c3', promptVersion: 'v1', model: 'm1' }
  ]
} satisfies PackRecord;

describe('learning sessions', () => {
  it('builds an overdue-first due-card queue with completion metrics and mastery trend', () => {
    const progress: LearningProgressRecord = {
      userId: 'learner-1',
      packId: 'pack-session',
      totalCards: 3,
      reviewedCards: 2,
      dueCards: 2,
      masteryScore: 0.5,
      cards: [
        {
          cardIndex: 0,
          reviewed: true,
          due: true,
          lastRating: 'again',
          reviewedAt: '2026-01-01T00:00:00.000Z',
          nextDueAt: '2026-01-01T00:10:00.000Z'
        },
        { cardIndex: 1, reviewed: false, due: true },
        {
          cardIndex: 2,
          reviewed: true,
          due: false,
          lastRating: 'easy',
          reviewedAt: '2026-01-01T00:00:00.000Z',
          nextDueAt: '2999-01-05T00:00:00.000Z'
        }
      ]
    };

    const session = buildLearningSession(pack, progress, { dueCards: 3, masteryScore: 0.25 });

    expect(session.status).toBe('ready');
    expect(session.queue.map((card) => card.cardIndex)).toEqual([0, 1]);
    expect(session.metrics).toMatchObject({
      totalCards: 3,
      reviewedCards: 2,
      dueCards: 2,
      sessionTotal: 3,
      completedCards: 1,
      remainingCards: 2,
      masteryScore: 0.5,
      masteryDelta: 0.25
    });
  });

  it('marks a session complete when no cards are due', () => {
    const progress: LearningProgressRecord = {
      userId: 'learner-1',
      packId: 'pack-session',
      totalCards: 3,
      reviewedCards: 3,
      dueCards: 0,
      masteryScore: 0.83,
      cards: pack.flashcards.map((_, cardIndex) => ({
        cardIndex,
        reviewed: true,
        due: false,
        lastRating: 'good',
        reviewedAt: '2026-01-01T00:00:00.000Z',
        nextDueAt: '2999-01-04T00:00:00.000Z'
      }))
    };

    const session = buildLearningSession(pack, progress, { dueCards: 3, masteryScore: 0.5 });

    expect(session.status).toBe('complete');
    expect(session.queue).toEqual([]);
    expect(session.metrics).toMatchObject({
      sessionTotal: 3,
      completedCards: 3,
      remainingCards: 0,
      masteryDelta: 0.33
    });
  });
});
