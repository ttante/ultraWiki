import { validateAlertRoutingPolicyFiles } from '../src/domain/alertPolicy.js';

const result = validateAlertRoutingPolicyFiles({
  alertsPath: 'infra/monitoring/prometheus/alerts/outcomes-slo-alerts.yml',
  alertmanagerPath: 'infra/monitoring/alertmanager/alertmanager.yml',
  policyPath: 'infra/monitoring/alert-routing-policy.json'
});

if (!result.valid) {
  for (const violation of result.violations) {
    console.error(`policy violation: ${violation}`);
  }
  process.exit(1);
}

console.log('alert routing policy checks passed');
