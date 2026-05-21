import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultErrorBudgetPolicy,
  evaluateErrorBudgetPolicy,
  type ErrorBudgetInput,
  type ReleaseDecision
} from '../src/domain/errorBudgetPolicy.js';

type PolicyScenario = {
  id: string;
  input: ErrorBudgetInput;
  expected_decision: ReleaseDecision;
};

type ScenarioFile = {
  version: string;
  policy: {
    warning_burn_rate_threshold: number;
    critical_burn_rate_threshold: number;
    min_traffic_rate_1h: number;
    min_traffic_rate_6h: number;
  };
  scenarios: PolicyScenario[];
};

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const scenariosPath = path.resolve(scriptDir, '../../infra/monitoring/fixtures/error-budget-policy-scenarios.json');
  const file = JSON.parse(await readFile(scenariosPath, 'utf8')) as ScenarioFile;

  const policy = {
    warningBurnRateThreshold: file.policy.warning_burn_rate_threshold,
    criticalBurnRateThreshold: file.policy.critical_burn_rate_threshold,
    minTrafficRate1h: file.policy.min_traffic_rate_1h,
    minTrafficRate6h: file.policy.min_traffic_rate_6h
  };

  if (
    policy.warningBurnRateThreshold !== defaultErrorBudgetPolicy.warningBurnRateThreshold ||
    policy.criticalBurnRateThreshold !== defaultErrorBudgetPolicy.criticalBurnRateThreshold
  ) {
    console.error('Policy/implementation threshold mismatch with default release policy.');
    process.exit(1);
  }

  let failed = 0;
  for (const scenario of file.scenarios) {
    const result = evaluateErrorBudgetPolicy(scenario.input, policy);
    if (result.decision !== scenario.expected_decision) {
      failed += 1;
      console.error(
        `FAIL scenario=${scenario.id} expected=${scenario.expected_decision} actual=${result.decision} reason=${result.reason}`
      );
    }
  }

  if (failed > 0) {
    process.exit(1);
  }

  console.log(`Error budget policy gate passed: ${file.scenarios.length} scenarios (version=${file.version})`);
};

void run();
