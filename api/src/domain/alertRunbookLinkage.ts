export type LinkedAlertRule = {
  name: string;
  severity: string;
  runbook: string;
};

export type AlertDrillEntry = {
  alert: string;
  executed_at: string;
  outcome: 'passed' | 'failed';
  operator: string;
  notes: string;
};

export type AlertDrillLog = {
  version: string;
  drills: AlertDrillEntry[];
};

export type AlertRunbookValidationResult = {
  valid: boolean;
  violations: string[];
  alertCount: number;
  pageAlertCount: number;
  drillCount: number;
};

export const headingToAnchor = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');

const cleanValue = (value: string): string => value.trim().replace(/^['"]|['"]$/g, '');

export const parseLinkedAlertRules = (content: string): LinkedAlertRule[] => {
  const rules: LinkedAlertRule[] = [];
  let current: LinkedAlertRule | undefined;

  for (const line of content.split(/\r?\n/)) {
    const alertMatch = line.match(/^\s*-\s*alert:\s*(.+)\s*$/);
    if (alertMatch) {
      current = { name: cleanValue(alertMatch[1]), severity: '', runbook: '' };
      rules.push(current);
      continue;
    }

    if (!current) continue;

    const severityMatch = line.match(/^\s*severity:\s*(.+)\s*$/);
    if (severityMatch) {
      current.severity = cleanValue(severityMatch[1]);
      continue;
    }

    const runbookMatch = line.match(/^\s*runbook:\s*(.+)\s*$/);
    if (runbookMatch) {
      current.runbook = cleanValue(runbookMatch[1]);
    }
  }

  return rules;
};

export const parseRunbookAnchors = (content: string): Set<string> => {
  const anchors = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^###\s+(.+)$/);
    if (match) {
      anchors.add(headingToAnchor(match[1]));
    }
  }
  return anchors;
};

export const validateAlertRunbookLinkage = ({
  alertsText,
  runbookText,
  drillLog,
  expectedRunbookPath = 'infra/monitoring/runbooks/outcomes-slo-alerts.md'
}: {
  alertsText: string;
  runbookText: string;
  drillLog: AlertDrillLog;
  expectedRunbookPath?: string;
}): AlertRunbookValidationResult => {
  const rules = parseLinkedAlertRules(alertsText);
  const anchors = parseRunbookAnchors(runbookText);
  const alertNames = new Set(rules.map((rule) => rule.name));
  const pageAlerts = rules.filter((rule) => rule.severity === 'page');
  const violations: string[] = [];

  if (rules.length === 0) {
    violations.push('no alert rules found');
  }

  for (const rule of rules) {
    if (!rule.runbook) {
      violations.push(`alert ${rule.name} missing runbook`);
      continue;
    }

    const [runbookFile, anchor] = rule.runbook.split('#');
    if (runbookFile !== expectedRunbookPath || !anchor) {
      violations.push(`alert ${rule.name} runbook target invalid: ${rule.runbook}`);
      continue;
    }

    if (!anchors.has(anchor)) {
      violations.push(`alert ${rule.name} runbook anchor missing: ${anchor}`);
    }
  }

  for (const alert of pageAlerts) {
    const passedDrill = drillLog.drills.some((entry) => entry.alert === alert.name && entry.outcome === 'passed');
    if (!passedDrill) {
      violations.push(`alert ${alert.name} missing passed drill evidence`);
    }
  }

  for (const entry of drillLog.drills) {
    if (!alertNames.has(entry.alert)) {
      violations.push(`drill alert ${entry.alert} does not match a configured alert`);
    }
    if (!Number.isFinite(Date.parse(entry.executed_at))) {
      violations.push(`drill alert ${entry.alert} invalid executed_at=${entry.executed_at}`);
    }
    if (!entry.operator.trim()) {
      violations.push(`drill alert ${entry.alert} missing operator`);
    }
    if (!entry.notes.trim()) {
      violations.push(`drill alert ${entry.alert} missing notes`);
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    alertCount: rules.length,
    pageAlertCount: pageAlerts.length,
    drillCount: drillLog.drills.length
  };
};
