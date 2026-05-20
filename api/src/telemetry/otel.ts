export type Span = {
  name: string;
  ended: boolean;
  attributes: Record<string, string | number | boolean>;
};

export class Telemetry {
  private spans: Span[] = [];

  startSpan(name: string): Span {
    const span: Span = { name, ended: false, attributes: {} };
    this.spans.push(span);
    return span;
  }

  setAttribute(span: Span, key: string, value: string | number | boolean): void {
    span.attributes[key] = value;
  }

  endSpan(span: Span): void {
    span.ended = true;
  }

  getSpans(): Span[] {
    return this.spans;
  }
}

export const telemetry = new Telemetry();
