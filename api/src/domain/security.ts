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

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAtMs: number;
};

export class FixedWindowRateLimiter {
  private readonly maxEvents: number;
  private readonly windowMs: number;
  private readonly entries = new Map<string, { count: number; resetAtMs: number }>();

  constructor(maxEvents: number, windowSeconds: number) {
    this.maxEvents = Math.max(1, Math.floor(maxEvents));
    this.windowMs = Math.max(1, Math.floor(windowSeconds)) * 1000;
  }

  check(key: string, nowMs = Date.now()): RateLimitDecision {
    const normalizedKey = key.trim() || 'unknown';
    this.pruneExpired(nowMs);
    const current = this.entries.get(normalizedKey);
    const entry =
      current && current.resetAtMs > nowMs
        ? current
        : {
            count: 0,
            resetAtMs: nowMs + this.windowMs
          };

    entry.count += 1;
    this.entries.set(normalizedKey, entry);

    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAtMs - nowMs) / 1000));
    return {
      allowed: entry.count <= this.maxEvents,
      limit: this.maxEvents,
      remaining: Math.max(0, this.maxEvents - entry.count),
      retryAfterSeconds,
      resetAtMs: entry.resetAtMs
    };
  }

  reset(): void {
    this.entries.clear();
  }

  getEntryCount(): number {
    return this.entries.size;
  }

  private pruneExpired(nowMs: number): void {
    for (const [key, entry] of this.entries.entries()) {
      if (entry.resetAtMs <= nowMs) {
        this.entries.delete(key);
      }
    }
  }
}

export type SecurityMetricsSnapshot = {
  suspiciousInputsTotal: number;
  signatureAlertsTotal: number;
  securityEventsTotal: number;
  rateLimitEventsTotal: number;
  signatures: Array<{
    signature: string;
    suspiciousInputs: number;
    alerts: number;
  }>;
  eventCategories: Array<{
    category: SecurityEventCategory;
    count: number;
  }>;
  rateLimitEvents: Array<{
    eventType: string;
    count: number;
  }>;
  events: Array<{
    eventType: string;
    count: number;
  }>;
};

export type SecurityEventCategory = 'auth' | 'share' | 'security' | 'rate_limit' | 'other';

const securityEventCategoryOrder: SecurityEventCategory[] = ['auth', 'share', 'security', 'rate_limit', 'other'];

export const classifySecurityEvent = (eventType: string): SecurityEventCategory => {
  if (eventType.startsWith('auth.')) return 'auth';
  if (eventType.startsWith('share.')) return 'share';
  if (eventType.startsWith('security.')) return 'security';
  if (eventType.startsWith('rate_limit.')) return 'rate_limit';
  return 'other';
};

export class SecurityEventMetrics {
  private suspiciousInputsTotal = 0;
  private signatureAlertsTotal = 0;
  private securityEventsTotal = 0;
  private signatureCounts = new Map<string, { suspiciousInputs: number; alerts: number }>();
  private eventCounts = new Map<string, number>();

  reset(): void {
    this.suspiciousInputsTotal = 0;
    this.signatureAlertsTotal = 0;
    this.securityEventsTotal = 0;
    this.signatureCounts.clear();
    this.eventCounts.clear();
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

  recordSecurityEvent(eventType: string): void {
    this.securityEventsTotal += 1;
    this.eventCounts.set(eventType, (this.eventCounts.get(eventType) ?? 0) + 1);
  }

  getSnapshot(): SecurityMetricsSnapshot {
    const events = [...this.eventCounts.entries()]
      .map(([eventType, count]) => ({ eventType, count }))
      .sort((a, b) => a.eventType.localeCompare(b.eventType));
    const eventCategoryCounts = events.reduce((acc, event) => {
      const category = classifySecurityEvent(event.eventType);
      acc.set(category, (acc.get(category) ?? 0) + event.count);
      return acc;
    }, new Map<SecurityEventCategory, number>());
    const rateLimitEvents = events.filter((event) => classifySecurityEvent(event.eventType) === 'rate_limit');

    return {
      suspiciousInputsTotal: this.suspiciousInputsTotal,
      signatureAlertsTotal: this.signatureAlertsTotal,
      securityEventsTotal: this.securityEventsTotal,
      rateLimitEventsTotal: rateLimitEvents.reduce((acc, event) => acc + event.count, 0),
      signatures: [...this.signatureCounts.entries()]
        .map(([signature, counts]) => ({
          signature,
          suspiciousInputs: counts.suspiciousInputs,
          alerts: counts.alerts
        }))
        .sort((a, b) => a.signature.localeCompare(b.signature)),
      eventCategories: [...eventCategoryCounts.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => securityEventCategoryOrder.indexOf(a.category) - securityEventCategoryOrder.indexOf(b.category)),
      rateLimitEvents,
      events
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
