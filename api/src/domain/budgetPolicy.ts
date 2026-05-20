export type BudgetInput = {
  estimatedTokens: number;
  estimatedLatencyMs: number;
};

export type BudgetResult = {
  allowed: boolean;
  reason: 'within_budget' | 'token_budget_exceeded' | 'latency_budget_exceeded';
};

export class BudgetPolicy {
  constructor(
    private readonly tokenBudgetPerJob: number,
    private readonly latencyBudgetMs: number
  ) {}

  evaluate(input: BudgetInput): BudgetResult {
    if (input.estimatedTokens > this.tokenBudgetPerJob) {
      return { allowed: false, reason: 'token_budget_exceeded' };
    }
    if (input.estimatedLatencyMs > this.latencyBudgetMs) {
      return { allowed: false, reason: 'latency_budget_exceeded' };
    }
    return { allowed: true, reason: 'within_budget' };
  }

  chunkText(text: string, maxChunkChars = 3500): string[] {
    if (maxChunkChars <= 0) {
      throw new Error('maxChunkChars must be > 0');
    }
    if (text.length <= maxChunkChars) {
      return [text];
    }

    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += maxChunkChars) {
      chunks.push(text.slice(i, i + maxChunkChars));
    }
    return chunks;
  }
}
