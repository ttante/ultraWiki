import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateChangeGate, type ChangeGatingPolicy, type EmergencyOverride } from '../src/domain/changeGatingPolicy.js';

type PolicyFile = {
  version: string;
  required_checks: string[];
  protected_path_prefixes: string[];
  max_override_ttl_days: number;
};

type OverrideFile = {
  version: string;
  overrides: EmergencyOverride[];
};

const parseWorkflowChecks = (workflowContent: string): string[] => {
  const checks = new Set<string>();
  const runLines = workflowContent.match(/-\s+run:\s+npm run [a-z0-9:-]+/gi) ?? [];
  for (const line of runLines) {
    const m = line.match(/npm run ([a-z0-9:-]+)/i);
    if (m) {
      checks.add(m[1]);
    }
  }
  return Array.from(checks);
};

const parseChangedFiles = (raw: string | undefined): string[] => {
  if (!raw) {
    return [];
  }
  return raw
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
};

const loadPolicy = (file: PolicyFile): ChangeGatingPolicy => ({
  requiredChecks: file.required_checks,
  protectedPathPrefixes: file.protected_path_prefixes,
  maxOverrideTtlDays: file.max_override_ttl_days
});

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '../..');

  const [workflowRaw, policyRaw, overrideRaw] = await Promise.all([
    readFile(path.resolve(root, '.github/workflows/ci.yml'), 'utf8'),
    readFile(path.resolve(root, 'infra/evaluation/change-gating-policy.json'), 'utf8'),
    readFile(path.resolve(root, 'infra/evaluation/emergency-overrides.json'), 'utf8')
  ]);

  const policy = loadPolicy(JSON.parse(policyRaw) as PolicyFile);
  const overrides = (JSON.parse(overrideRaw) as OverrideFile).overrides;
  const changedFiles = parseChangedFiles(process.env.CHANGE_GATING_CHANGED_FILES);
  const workflowChecks = parseWorkflowChecks(workflowRaw);
  const overrideId = process.env.CHANGE_GATING_OVERRIDE_ID;
  const nowIso = process.env.CHANGE_GATING_NOW_ISO ?? new Date().toISOString();

  const result = evaluateChangeGate({
    changedFiles,
    workflowChecks,
    overrideId,
    nowIso,
    policy,
    overrides
  });

  if (!result.pass) {
    for (const failure of result.failures) {
      console.error(`FAIL ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `Change gating policy passed: protected_changes=${result.requiresQualityGates ? 'yes' : 'no'} override=${result.usedOverride ? 'yes' : 'no'}`
  );
};

void run();
