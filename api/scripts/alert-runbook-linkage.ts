import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateAlertRunbookLinkage,
  type AlertDrillLog
} from '../src/domain/alertRunbookLinkage.js';

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '../..');

  const alertsPath = path.resolve(root, 'infra/monitoring/prometheus/alerts/outcomes-slo-alerts.yml');
  const runbookPath = path.resolve(root, 'infra/monitoring/runbooks/outcomes-slo-alerts.md');
  const drillPath = path.resolve(root, 'infra/monitoring/drills/alert-drills.json');

  const result = validateAlertRunbookLinkage({
    alertsText: await readFile(alertsPath, 'utf8'),
    runbookText: await readFile(runbookPath, 'utf8'),
    drillLog: JSON.parse(await readFile(drillPath, 'utf8')) as AlertDrillLog
  });

  if (!result.valid) {
    for (const violation of result.violations) {
      console.error(`FAIL ${violation}`);
    }
    process.exit(1);
  }

  console.log(
    `Alert/runbook linkage gate passed: ${result.alertCount} alerts, ${result.pageAlertCount} page alerts, ${result.drillCount} drill entries`
  );
};

void run();
