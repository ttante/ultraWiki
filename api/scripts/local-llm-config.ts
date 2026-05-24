import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLocalLlmConfig, type LocalLlmConfig } from '../src/domain/localLlmConfig.js';
import { listRuntimePresets } from '../src/domain/runtimePreset.js';

const requireModel = process.env.LOCAL_LLM_REQUIRE_MODEL === '1';

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '../..');
  const [configRaw, composeText] = await Promise.all([
    readFile(path.resolve(root, 'infra/llm/local-qwen.json'), 'utf8'),
    readFile(path.resolve(root, 'docker-compose.yml'), 'utf8')
  ]);
  const config = JSON.parse(configRaw) as LocalLlmConfig;
  const runtimePresetIds = listRuntimePresets().map((preset) => preset.id);
  const validation = validateLocalLlmConfig(config, composeText, runtimePresetIds);
  const errors = [...validation.errors];

  if (requireModel) {
    try {
      await stat(path.resolve(root, config.model.host_path));
    } catch {
      errors.push(`model file missing: ${config.model.host_path}`);
    }
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`FAIL ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `Local LLM config passed: model=${config.model.name} quantization=${config.model.quantization} preset=${config.runtime_preset_id} profile=${config.compose_profile}`
  );
};

void run();
