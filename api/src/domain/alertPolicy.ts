import { readFileSync } from 'node:fs';

type SeverityRoute = {
  receiver: string;
  required_label: string;
  required_annotation?: string;
  escalation_target_prefix?: string;
};

type AlertRoutingPolicy = {
  version: number;
  severity_routes: Record<string, SeverityRoute>;
};

type AlertRule = {
  name: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
};

type AlertmanagerRoute = {
  severity: string;
  receiver: string;
};

type AlertPolicyValidationInput = {
  alertsText: string;
  alertmanagerText: string;
  policy: AlertRoutingPolicy;
};

type AlertPolicyValidationResult = {
  valid: boolean;
  violations: string[];
};

const cleanValue = (value: string): string => value.trim().replace(/^['"]|['"]$/g, '');

export const parsePrometheusAlertRules = (text: string): AlertRule[] => {
  const rules: AlertRule[] = [];
  let current: AlertRule | undefined;
  let section: 'labels' | 'annotations' | undefined;

  for (const line of text.split('\n')) {
    const alertMatch = line.match(/^\s*-\s*alert:\s*(.+)\s*$/);
    if (alertMatch) {
      current = { name: cleanValue(alertMatch[1]), labels: {}, annotations: {} };
      rules.push(current);
      section = undefined;
      continue;
    }

    if (!current) {
      continue;
    }

    if (/^\s*labels:\s*$/.test(line)) {
      section = 'labels';
      continue;
    }

    if (/^\s*annotations:\s*$/.test(line)) {
      section = 'annotations';
      continue;
    }

    const valueMatch = line.match(/^\s{10,}([A-Za-z0-9_]+):\s*(.+?)\s*$/);
    if (section && valueMatch) {
      current[section][valueMatch[1]] = cleanValue(valueMatch[2]);
    }
  }

  return rules;
};

export const parseAlertmanagerSeverityRoutes = (text: string): AlertmanagerRoute[] => {
  const routes: AlertmanagerRoute[] = [];
  let pendingSeverity: string | undefined;

  for (const line of text.split('\n')) {
    const severityMatch = line.match(/severity\s*=\s*"?([A-Za-z0-9_-]+)"?/);
    if (severityMatch) {
      pendingSeverity = severityMatch[1];
      continue;
    }

    const receiverMatch = line.match(/^\s*receiver:\s*([A-Za-z0-9_-]+)\s*$/);
    if (pendingSeverity && receiverMatch) {
      routes.push({ severity: pendingSeverity, receiver: receiverMatch[1] });
      pendingSeverity = undefined;
    }
  }

  return routes;
};

export const parseAlertmanagerReceivers = (text: string): string[] => {
  const receivers = new Set<string>();
  for (const line of text.split('\n')) {
    const receiverMatch = line.match(/^\s*-\s*name:\s*([A-Za-z0-9_-]+)\s*$/);
    if (receiverMatch) {
      receivers.add(receiverMatch[1]);
    }
  }
  return [...receivers];
};

export const validateAlertRoutingPolicy = ({
  alertsText,
  alertmanagerText,
  policy
}: AlertPolicyValidationInput): AlertPolicyValidationResult => {
  const violations: string[] = [];
  const alertRules = parsePrometheusAlertRules(alertsText);
  const alertmanagerRoutes = parseAlertmanagerSeverityRoutes(alertmanagerText);
  const receivers = new Set(parseAlertmanagerReceivers(alertmanagerText));
  const routeBySeverity = new Map(alertmanagerRoutes.map((route) => [route.severity, route.receiver]));

  if (alertRules.length === 0) {
    violations.push('no alert rules found');
  }

  for (const [severity, routePolicy] of Object.entries(policy.severity_routes)) {
    if (!receivers.has(routePolicy.receiver)) {
      violations.push(`severity ${severity} receiver ${routePolicy.receiver} is not defined in Alertmanager receivers`);
    }
    if (routeBySeverity.get(severity) !== routePolicy.receiver) {
      violations.push(`severity ${severity} must route to ${routePolicy.receiver}`);
    }
  }

  for (const rule of alertRules) {
    const severity = rule.labels.severity;
    const routePolicy = policy.severity_routes[severity];

    if (!rule.labels.owner) {
      violations.push(`alert ${rule.name} missing owner label`);
    }
    if (!rule.annotations.runbook) {
      violations.push(`alert ${rule.name} missing runbook annotation`);
    }
    if (!routePolicy) {
      violations.push(`alert ${rule.name} has unsupported severity ${severity || '<missing>'}`);
      continue;
    }
    if (!rule.labels[routePolicy.required_label]) {
      violations.push(`alert ${rule.name} severity=${severity} requires ${routePolicy.required_label} label`);
    }
    if (routePolicy.required_annotation && !rule.annotations[routePolicy.required_annotation]) {
      violations.push(`alert ${rule.name} severity=${severity} requires ${routePolicy.required_annotation} annotation`);
    }
    if (routePolicy.escalation_target_prefix) {
      const escalationTarget = rule.annotations[routePolicy.required_annotation ?? ''];
      if (!escalationTarget?.startsWith(routePolicy.escalation_target_prefix)) {
        violations.push(
          `alert ${rule.name} escalation target must start with ${routePolicy.escalation_target_prefix}`
        );
      }
    }
  }

  return { valid: violations.length === 0, violations };
};

export const validateAlertRoutingPolicyFiles = ({
  alertsPath,
  alertmanagerPath,
  policyPath
}: {
  alertsPath: string;
  alertmanagerPath: string;
  policyPath: string;
}): AlertPolicyValidationResult =>
  validateAlertRoutingPolicy({
    alertsText: readFileSync(alertsPath, 'utf8'),
    alertmanagerText: readFileSync(alertmanagerPath, 'utf8'),
    policy: JSON.parse(readFileSync(policyPath, 'utf8')) as AlertRoutingPolicy
  });
