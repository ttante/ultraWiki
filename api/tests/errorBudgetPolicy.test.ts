import { describe, expect, it } from 'vitest';
import { evaluateErrorBudgetPolicy } from '../src/domain/errorBudgetPolicy.js';

describe('error budget policy', () => {
  it('allows release when within budget', () => {
    const result = evaluateErrorBudgetPolicy({
      burnRate5m: 1,
      burnRate1h: 1,
      burnRate30m: 1,
      burnRate6h: 1,
      requestsRate1h: 0.2,
      requestsRate6h: 0.2
    });
    expect(result.decision).toBe('allow');
    expect(result.reason).toBe('within_budget');
  });

  it('returns restricted on warning burn', () => {
    const result = evaluateErrorBudgetPolicy({
      burnRate5m: 3,
      burnRate1h: 3,
      burnRate30m: 6.1,
      burnRate6h: 6.2,
      requestsRate1h: 0.2,
      requestsRate6h: 0.2
    });
    expect(result.decision).toBe('restricted');
    expect(result.reason).toBe('warning_burn_rate_exceeded');
  });

  it('returns freeze on critical burn', () => {
    const result = evaluateErrorBudgetPolicy({
      burnRate5m: 15,
      burnRate1h: 15,
      burnRate30m: 7,
      burnRate6h: 7,
      requestsRate1h: 0.2,
      requestsRate6h: 0.2
    });
    expect(result.decision).toBe('freeze');
    expect(result.reason).toBe('critical_burn_rate_exceeded');
  });

  it('allows on low traffic guard', () => {
    const result = evaluateErrorBudgetPolicy({
      burnRate5m: 100,
      burnRate1h: 100,
      burnRate30m: 100,
      burnRate6h: 100,
      requestsRate1h: 0.001,
      requestsRate6h: 0.001
    });
    expect(result.decision).toBe('allow');
    expect(result.reason).toBe('insufficient_traffic');
  });
});
