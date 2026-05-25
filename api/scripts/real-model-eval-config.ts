import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLocalLlmConfig, type LocalLlmConfig } from '../src/domain/localLlmConfig.js';
import {
  validateRealModelEvalThresholds,
  type RealModelEvalThresholds
} from '../src/domain/realModelEval.js';
import { listRuntimePresets } from '../src/domain/runtimePreset.js';

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '../..');
  const [thresholdRaw, localLlmRaw, composeText, packageRaw] = await Promise.all([
    readFile(path.resolve(root, 'infra/evaluation/real-model-eval.json'), 'utf8'),
    readFile(path.resolve(root, 'infra/llm/local-qwen.json'), 'utf8'),
    readFile(path.resolve(root, 'docker-compose.yml'), 'utf8'),
    readFile(path.resolve(root, 'package.json'), 'utf8')
  ]);

  const thresholds = JSON.parse(thresholdRaw) as RealModelEvalThresholds;
  const localLlm = JSON.parse(localLlmRaw) as LocalLlmConfig;
  const packageJson = JSON.parse(packageRaw) as { scripts?: Record<string, string> };
  const runtimePresetIds = listRuntimePresets().map((preset) => preset.id);
  const errors = [
    ...validateRealModelEvalThresholds(thresholds),
    ...validateLocalLlmConfig(localLlm, composeText, runtimePresetIds).errors
  ];

  if (thresholds.runtime_profile !== localLlm.runtime_preset_id) {
    errors.push(`runtime profile mismatch: eval=${thresholds.runtime_profile} local_llm=${localLlm.runtime_preset_id}`);
  }
  if (!thresholds.model.includes(localLlm.model.name)) {
    errors.push(`eval model=${thresholds.model} must reference local model=${localLlm.model.name}`);
  }
  if (packageJson.scripts?.['eval:real-model'] !== 'bash scripts/run-real-model-eval.sh') {
    errors.push('package.json missing eval:real-model script');
  }
  if (packageJson.scripts?.['smoke:real-llm'] !== 'bash scripts/smoke-real-llm.sh') {
    errors.push('package.json missing smoke:real-llm script');
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`FAIL ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `Real-model eval config passed: model=${thresholds.model} preset=${thresholds.runtime_profile} max_total_ms=${thresholds.max_total_duration_ms}`
  );
};

void run();
