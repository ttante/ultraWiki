import { describe, expect, it } from 'vitest';
import {
  parseAlertmanagerSeverityRoutes,
  parsePrometheusAlertRules,
  validateAlertRoutingPolicy
} from '../src/domain/alertPolicy.js';

const policy = {
  version: 1,
  severity_routes: {
    page: {
      receiver: 'pagerduty-primary',
      required_label: 'page_service',
      required_annotation: 'escalation_target',
      escalation_target_prefix: 'pagerduty://'
    },
    ticket: {
      receiver: 'ticket-queue',
      required_label: 'ticket_queue',
      required_annotation: 'escalation_target',
      escalation_target_prefix: 'linear://'
    },
    info: {
      receiver: 'monitoring-dev',
      required_label: 'notify_channel'
    }
  }
};

const alertmanagerText = `
route:
  receiver: local-observer
  routes:
    - matchers:
        - severity="page"
      receiver: pagerduty-primary
    - matchers:
        - severity="ticket"
      receiver: ticket-queue
    - matchers:
        - severity="info"
      receiver: monitoring-dev
receivers:
  - name: local-observer
  - name: pagerduty-primary
  - name: ticket-queue
  - name: monitoring-dev
`;

const alertsText = `
groups:
  - name: test
    rules:
      - alert: PageAlert
        expr: vector(1)
        labels:
          severity: page
          owner: reliability
          page_service: ultrawiki-primary
        annotations:
          runbook: "infra/monitoring/runbooks/outcomes-slo-alerts.md#pagealert"
          escalation_target: "pagerduty://ultrawiki-primary"
      - alert: TicketAlert
        expr: vector(1)
        labels:
          severity: ticket
          owner: reliability
          ticket_queue: ultrawiki-reliability
        annotations:
          runbook: "infra/monitoring/runbooks/outcomes-slo-alerts.md#ticketalert"
          escalation_target: "linear://ultrawiki-reliability"
      - alert: InfoAlert
        expr: vector(1)
        labels:
          severity: info
          owner: reliability
          notify_channel: ultrawiki-monitoring-dev
        annotations:
          runbook: "infra/monitoring/runbooks/outcomes-slo-alerts.md#infoalert"
`;

describe('alert policy', () => {
  it('parses prometheus alert labels and annotations', () => {
    const rules = parsePrometheusAlertRules(alertsText);
    expect(rules).toHaveLength(3);
    expect(rules[0]).toMatchObject({
      name: 'PageAlert',
      labels: { severity: 'page', page_service: 'ultrawiki-primary' },
      annotations: { escalation_target: 'pagerduty://ultrawiki-primary' }
    });
  });

  it('parses alertmanager severity routes', () => {
    expect(parseAlertmanagerSeverityRoutes(alertmanagerText)).toEqual([
      { severity: 'page', receiver: 'pagerduty-primary' },
      { severity: 'ticket', receiver: 'ticket-queue' },
      { severity: 'info', receiver: 'monitoring-dev' }
    ]);
  });

  it('passes when alert rules match routing policy', () => {
    const result = validateAlertRoutingPolicy({ alertsText, alertmanagerText, policy });
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it('fails when escalation target does not match severity channel', () => {
    const result = validateAlertRoutingPolicy({
      alertsText: alertsText.replace('pagerduty://ultrawiki-primary', 'linear://wrong-channel'),
      alertmanagerText,
      policy
    });
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('alert PageAlert escalation target must start with pagerduty://');
  });

  it('fails when Alertmanager does not route severity to policy receiver', () => {
    const result = validateAlertRoutingPolicy({
      alertsText,
      alertmanagerText: alertmanagerText.replace('receiver: ticket-queue', 'receiver: local-observer'),
      policy
    });
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('severity ticket must route to ticket-queue');
  });
});
