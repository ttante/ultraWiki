const suspiciousPatterns: Array<{ signature: string; pattern: RegExp }> = [
  { signature: 'ignore_previous_instructions', pattern: /ignore\s+(?:all\s+)?previous\s+instructions/gi },
  { signature: 'disregard_prior_instructions', pattern: /disregard\s+(?:all\s+)?(?:prior|previous)\s+instructions/gi },
  { signature: 'reveal_system_prompt', pattern: /(?:reveal|print|dump|show)\s+(?:the\s+)?(?:system|developer)\s+prompt/gi },
  { signature: 'system_tag', pattern: /\bsystem\s*:/gi },
  { signature: 'developer_tag', pattern: /\bdeveloper\s*:/gi },
  { signature: 'assistant_tag', pattern: /\bassistant\s*:/gi },
  { signature: 'chatml_tag', pattern: /<\/?(system|assistant|user|tool)>/gi },
  { signature: 'tool_call_json', pattern: /"tool_calls?"\s*:/gi },
  { signature: 'html_script_tag', pattern: /<script\b[^>]*>[\s\S]*?<\/script>/gi },
  { signature: 'html_comment', pattern: /<!--[\s\S]*?-->/g },
  { signature: 'triple_backticks', pattern: /```/g },
  { signature: 'begin_prompt', pattern: /BEGIN\s+PROMPT/gi }
];

export const sanitizeSourceText = (input: string): { sanitized: string; flagged: boolean; signatures: string[] } => {
  let flagged = false;
  let sanitized = input;
  const signatures: string[] = [];

  for (const { signature, pattern } of suspiciousPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(sanitized)) {
      flagged = true;
      signatures.push(signature);
      pattern.lastIndex = 0;
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

export type SecurityMetricsSnapshot = {
  suspiciousInputsTotal: number;
  signatureAlertsTotal: number;
  signatures: Array<{
    signature: string;
    suspiciousInputs: number;
    alerts: number;
  }>;
};

export class SecurityEventMetrics {
  private suspiciousInputsTotal = 0;
  private signatureAlertsTotal = 0;
  private signatureCounts = new Map<string, { suspiciousInputs: number; alerts: number }>();

  reset(): void {
    this.suspiciousInputsTotal = 0;
    this.signatureAlertsTotal = 0;
    this.signatureCounts.clear();
  }

  recordSuspiciousInput(signatures: string[]): void {
    this.suspiciousInputsTotal += 1;

    for (const signature of new Set(signatures)) {
      const current = this.signatureCounts.get(signature) ?? { suspiciousInputs: 0, alerts: 0 };
      current.suspiciousInputs += 1;
      this.signatureCounts.set(signature, current);
    }
  }

  recordSignatureAlert(signature: string): void {
    this.signatureAlertsTotal += 1;
    const current = this.signatureCounts.get(signature) ?? { suspiciousInputs: 0, alerts: 0 };
    current.alerts += 1;
    this.signatureCounts.set(signature, current);
  }

  getSnapshot(): SecurityMetricsSnapshot {
    return {
      suspiciousInputsTotal: this.suspiciousInputsTotal,
      signatureAlertsTotal: this.signatureAlertsTotal,
      signatures: [...this.signatureCounts.entries()]
        .map(([signature, counts]) => ({
          signature,
          suspiciousInputs: counts.suspiciousInputs,
          alerts: counts.alerts
        }))
        .sort((a, b) => a.signature.localeCompare(b.signature))
    };
  }
}

export const securityEventMetrics = new SecurityEventMetrics();

export const isLikelyWikipediaInput = (value: string): boolean => {
  if (!value.trim()) return false;
  if (/^https?:\/\//i.test(value)) {
    return /https?:\/\/(?:[a-z]+\.)?wikipedia\.org\/wiki\//i.test(value);
  }
  return true;
};
