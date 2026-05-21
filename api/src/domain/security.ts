const suspiciousPatterns: Array<{ signature: string; pattern: RegExp }> = [
  { signature: 'ignore_previous_instructions', pattern: /ignore\s+previous\s+instructions/i },
  { signature: 'system_tag', pattern: /system\s*:/i },
  { signature: 'developer_tag', pattern: /developer\s*:/i },
  { signature: 'chatml_tag', pattern: /<\/?(system|assistant|user)>/i },
  { signature: 'triple_backticks', pattern: /```/ },
  { signature: 'begin_prompt', pattern: /BEGIN\s+PROMPT/i }
];

export const sanitizeSourceText = (input: string): { sanitized: string; flagged: boolean; signatures: string[] } => {
  let flagged = false;
  let sanitized = input;
  const signatures: string[] = [];

  for (const { signature, pattern } of suspiciousPatterns) {
    if (pattern.test(sanitized)) {
      flagged = true;
      signatures.push(signature);
      sanitized = sanitized.replace(pattern, '[FILTERED]');
    }
  }

  return { sanitized, flagged, signatures };
};

export class SecuritySignatureTracker {
  private occurrences = new Map<string, number[]>();

  constructor(
    private readonly alertThreshold: number,
    private readonly windowSeconds: number
  ) {}

  record(signatures: string[], nowMs = Date.now()): Array<{ signature: string; count: number; alert: boolean }> {
    const windowStart = nowMs - this.windowSeconds * 1000;
    const updates: Array<{ signature: string; count: number; alert: boolean }> = [];

    for (const signature of signatures) {
      const existing = this.occurrences.get(signature) ?? [];
      const bounded = existing.filter((ts) => ts >= windowStart);
      bounded.push(nowMs);
      this.occurrences.set(signature, bounded);
      updates.push({
        signature,
        count: bounded.length,
        alert: bounded.length >= this.alertThreshold
      });
    }

    return updates;
  }
}

export const isLikelyWikipediaInput = (value: string): boolean => {
  if (!value.trim()) return false;
  if (/^https?:\/\//i.test(value)) {
    return /https?:\/\/(?:[a-z]+\.)?wikipedia\.org\/wiki\//i.test(value);
  }
  return true;
};
