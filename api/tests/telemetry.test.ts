import { describe, expect, it } from 'vitest';
import { Telemetry } from '../src/telemetry/otel.js';

describe('Telemetry', () => {
  it('records and ends spans', () => {
    const t = new Telemetry();
    const span = t.startSpan('test');
    t.setAttribute(span, 'key', 'value');
    t.endSpan(span);

    expect(t.getSpans()).toHaveLength(1);
    expect(t.getSpans()[0].ended).toBe(true);
  });
});
