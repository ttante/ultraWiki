import { describe, expect, it } from 'vitest';
import { BudgetPolicy } from '../src/domain/budgetPolicy.js';

describe('BudgetPolicy', () => {
  const policy = new BudgetPolicy(100, 1000);

  it('allows work within budget', () => {
    expect(policy.evaluate({ estimatedTokens: 80, estimatedLatencyMs: 900 })).toEqual({
      allowed: true,
      reason: 'within_budget'
    });
  });

  it('blocks token budget exceed', () => {
    expect(policy.evaluate({ estimatedTokens: 101, estimatedLatencyMs: 100 })).toEqual({
      allowed: false,
      reason: 'token_budget_exceeded'
    });
  });

  it('blocks latency budget exceed', () => {
    expect(policy.evaluate({ estimatedTokens: 50, estimatedLatencyMs: 1001 })).toEqual({
      allowed: false,
      reason: 'latency_budget_exceeded'
    });
  });

  it('chunks long text safely', () => {
    const text = 'a'.repeat(9000);
    const chunks = policy.chunkText(text, 3000);
    expect(chunks).toHaveLength(3);
  });
});
