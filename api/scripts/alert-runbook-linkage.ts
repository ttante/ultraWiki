import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type AlertRule = {
  name: string;
  severity: string;
  runbook: string;
};

type DrillLog = {
  version: string;
  drills: Array<{
    alert: string;
    executed_at: string;
    outcome: 'passed' | 'failed';
    operator: string;
    notes: string;
  }>;
};

const headingToAnchor = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');

const parseAlerts = (content: string): AlertRule[] => {
  const lines = content.split(/\r?\n/);
  const rules: AlertRule[] = [];

  let current: AlertRule | null = null;
  for (const line of lines) {
    const alertMatch = line.match(/^\s*-\s*alert:\s*(.+)\s*$/);
    if (alertMatch) {
      if (current) rules.push(current);
      current = { name: alertMatch[1].trim(), severity: '', runbook: '' };
      continue;
    }

    if (!current) continue;

    const severityMatch = line.match(/^\s*severity:\s*(.+)\s*$/);
    if (severityMatch) {
      current.severity = severityMatch[1].replace(/"/g, '').trim();
      continue;
    }

    const runbookMatch = line.match(/^\s*runbook:\s*"?([^"\s]+)"?\s*$/);
    if (runbookMatch) {
      current.runbook = runbookMatch[1].trim();
      continue;
    }
  }

  if (current) rules.push(current);
  return rules;
};

const parseRunbookAnchors = (content: string): Set<string> => {
  const lines = content.split(/\r?\n/);
  const anchors = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^###\s+(.+)$/);
    if (!m) continue;
    anchors.add(headingToAnchor(m[1]));
  }
  return anchors;
};

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '../..');

  const alertsPath = path.resolve(root, 'infra/monitoring/prometheus/alerts/outcomes-slo-alerts.yml');
  const runbookPath = path.resolve(root, 'infra/monitoring/runbooks/outcomes-slo-alerts.md');
  const drillPath = path.resolve(root, 'infra/monitoring/drills/alert-drills.json');

  const alertsRaw = await readFile(alertsPath, 'utf8');
  const runbookRaw = await readFile(runbookPath, 'utf8');
  const drillRaw = JSON.parse(await readFile(drillPath, 'utf8')) as DrillLog;

  const rules = parseAlerts(alertsRaw);
  const pageAlerts = rules.filter((rule) => rule.severity === 'page');
  const anchors = parseRunbookAnchors(runbookRaw);

  let failed = 0;

  for (const alert of pageAlerts) {
    if (!alert.runbook) {
      failed += 1;
      console.error(`FAIL alert=${alert.name} missing runbook`);
      continue;
    }

    const [runbookFile, anchor] = alert.runbook.split('#');
    if (runbookFile !== 'infra/monitoring/runbooks/outcomes-slo-alerts.md' || !anchor) {
      failed += 1;
      console.error(`FAIL alert=${alert.name} runbook target invalid: ${alert.runbook}`);
      continue;
    }

    if (!anchors.has(anchor)) {
      failed += 1;
      console.error(`FAIL alert=${alert.name} runbook anchor missing: ${anchor}`);
    }

    const drillPass = drillRaw.drills.some((entry) => entry.alert === alert.name && entry.outcome === 'passed');
    if (!drillPass) {
      failed += 1;
      console.error(`FAIL alert=${alert.name} missing passed drill evidence`);
    }
  }

  for (const entry of drillRaw.drills) {
    if (!Number.isFinite(Date.parse(entry.executed_at))) {
      failed += 1;
      console.error(`FAIL drill alert=${entry.alert} invalid executed_at=${entry.executed_at}`);
    }
  }

  if (failed > 0) {
    process.exit(1);
  }

  console.log(`Alert/runbook linkage gate passed: ${pageAlerts.length} page alerts, ${drillRaw.drills.length} drill entries`);
};

void run();
