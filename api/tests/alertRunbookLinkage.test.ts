import { describe, expect, it } from 'vitest';
import {
  parseLinkedAlertRules,
  parseRunbookAnchors,
  validateAlertRunbookLinkage,
  type AlertDrillLog
} from '../src/domain/alertRunbookLinkage.js';

const alertsText = `
groups:
  - name: test
    rules:
      - alert: PageAlert
        expr: vector(1)
        labels:
          severity: page
        annotations:
          runbook: "infra/monitoring/runbooks/outcomes-slo-alerts.md#pagealert"
      - alert: TicketAlert
        expr: vector(1)
        labels:
          severity: ticket
        annotations:
          runbook: "infra/monitoring/runbooks/outcomes-slo-alerts.md#ticketalert"
`;

const runbookText = `
### PageAlert
Steps.

### TicketAlert
Steps.
`;

const drillLog: AlertDrillLog = {
  version: '2026-05-20',
  drills: [
    {
      alert: 'PageAlert',
      executed_at: '2026-05-20T00:00:00.000Z',
      outcome: 'passed',
      operator: 'oncall',
      notes: 'Validated page triage.'
    }
  ]
};

describe('alert runbook linkage', () => {
  it('parses alert rules and runbook anchors', () => {
    expect(parseLinkedAlertRules(alertsText)).toEqual([
      {
        name: 'PageAlert',
        severity: 'page',
        runbook: 'infra/monitoring/runbooks/outcomes-slo-alerts.md#pagealert'
      },
      {
        name: 'TicketAlert',
        severity: 'ticket',
        runbook: 'infra/monitoring/runbooks/outcomes-slo-alerts.md#ticketalert'
      }
    ]);
    expect(parseRunbookAnchors(runbookText)).toEqual(new Set(['pagealert', 'ticketalert']));
  });

  it('requires every alert to have a valid runbook anchor and page alerts to have passed drills', () => {
    const result = validateAlertRunbookLinkage({ alertsText, runbookText, drillLog });

    expect(result).toMatchObject({
      valid: true,
      alertCount: 2,
      pageAlertCount: 1,
      drillCount: 1
    });
  });

  it('fails missing anchors, stale drill references, and missing page drill evidence', () => {
    const result = validateAlertRunbookLinkage({
      alertsText,
      runbookText: runbookText.replace('### PageAlert', '### OtherAlert'),
      drillLog: {
        version: '2026-05-20',
        drills: [
          {
            alert: 'UnknownAlert',
            executed_at: 'not-a-date',
            outcome: 'passed',
            operator: '',
            notes: ''
          }
        ]
      }
    });

    expect(result.valid).toBe(false);
    expect(result.violations).toContain('alert PageAlert runbook anchor missing: pagealert');
    expect(result.violations).toContain('alert PageAlert missing passed drill evidence');
    expect(result.violations).toContain('drill alert UnknownAlert does not match a configured alert');
    expect(result.violations).toContain('drill alert UnknownAlert invalid executed_at=not-a-date');
    expect(result.violations).toContain('drill alert UnknownAlert missing operator');
    expect(result.violations).toContain('drill alert UnknownAlert missing notes');
  });
});
