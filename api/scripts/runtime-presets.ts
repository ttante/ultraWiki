import { readFile } from 'node:fs/promises';
import {
  defaultRuntimePresetId,
  listRuntimePresets,
  validateRuntimePresetMatrix,
  type RuntimePreset
} from '../src/domain/runtimePreset.js';

type RuntimePresetMatrixFile = {
  version: string;
  default_preset_id: string;
  presets: RuntimePreset[];
};

const run = async (): Promise<void> => {
  const file = JSON.parse(await readFile('infra/evaluation/runtime-presets.json', 'utf8')) as RuntimePresetMatrixFile;
  const errors = validateRuntimePresetMatrix(file.presets, file.default_preset_id);

  if (file.default_preset_id !== defaultRuntimePresetId) {
    errors.push(`default preset mismatch file=${file.default_preset_id} implementation=${defaultRuntimePresetId}`);
  }

  if (JSON.stringify(file.presets) !== JSON.stringify(listRuntimePresets())) {
    errors.push('published runtime preset matrix does not match API runtime presets');
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`FAIL ${error}`);
    }
    process.exit(1);
  }

  console.log(`Runtime preset matrix passed: ${file.presets.length} presets (version=${file.version})`);
};

void run();
