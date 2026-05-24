import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultErrorBudgetPolicy,
  evaluateErrorBudgetPolicy,
  evaluateReleaseGate,
  type ErrorBudgetInput,
  type ReleaseChangeClass,
  type ReleaseDecision
} from '../src/domain/errorBudgetPolicy.js';

type PolicyScenario = {
  id: string;
  input: ErrorBudgetInput;
  change_class: ReleaseChangeClass;
  expected_decision: ReleaseDecision;
  expected_gate: 'pass' | 'block';
};

type ScenarioFile = {
  version: string;
  policy: {
    warning_burn_rate_threshold: number;
    critical_burn_rate_threshold: number;
    min_traffic_rate_1h: number;
    min_traffic_rate_6h: number;
    release_rules: Record<ReleaseDecision, ReleaseChangeClass[]>;
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
    minTrafficRate6h: file.policy.min_traffic_rate_6h,
    releaseRules: file.policy.release_rules
  };

  if (
    policy.warningBurnRateThreshold !== defaultErrorBudgetPolicy.warningBurnRateThreshold ||
    policy.criticalBurnRateThreshold !== defaultErrorBudgetPolicy.criticalBurnRateThreshold ||
    policy.minTrafficRate1h !== defaultErrorBudgetPolicy.minTrafficRate1h ||
    policy.minTrafficRate6h !== defaultErrorBudgetPolicy.minTrafficRate6h ||
    JSON.stringify(policy.releaseRules) !== JSON.stringify(defaultErrorBudgetPolicy.releaseRules)
  ) {
    console.error('Policy fixture mismatch with default release policy.');
    process.exit(1);
  }

  let failed = 0;
  for (const scenario of file.scenarios) {
    const result = evaluateErrorBudgetPolicy(scenario.input, policy);
    const gate = evaluateReleaseGate({ ...scenario.input, changeClass: scenario.change_class }, policy);
    if (result.decision !== scenario.expected_decision) {
      failed += 1;
      console.error(
        `FAIL scenario=${scenario.id} expected=${scenario.expected_decision} actual=${result.decision} reason=${result.reason}`
      );
    }
    if (gate.gate !== scenario.expected_gate) {
      failed += 1;
      console.error(
        `FAIL scenario=${scenario.id} change_class=${scenario.change_class} expected_gate=${scenario.expected_gate} actual_gate=${gate.gate} decision=${gate.decision}`
      );
    }
  }

  if (failed > 0) {
    process.exit(1);
  }

  console.log(`Error budget policy gate passed: ${file.scenarios.length} scenarios (version=${file.version})`);
};

void run();
