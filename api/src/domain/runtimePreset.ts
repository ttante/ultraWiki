export type RuntimePreset = {
  id: string;
  model: 'qwen2.5-14b';
  hardware: 'rtx4080_12gb';
  quantization: 'q4_k_m' | 'q5_k_m' | 'q8_0';
  contextWindow: number;
  chunkSize: number;
  concurrency: number;
  validated: boolean;
};

export const defaultRuntimePresetId = 'rtx4080_qwen14b_safe';

const runtimePresets: RuntimePreset[] = [
  {
    id: 'rtx4080_qwen14b_safe',
    model: 'qwen2.5-14b',
    hardware: 'rtx4080_12gb',
    quantization: 'q4_k_m',
    contextWindow: 4096,
    chunkSize: 1000,
    concurrency: 1,
    validated: true
  },
  {
    id: 'rtx4080_qwen14b_balanced',
    model: 'qwen2.5-14b',
    hardware: 'rtx4080_12gb',
    quantization: 'q4_k_m',
    contextWindow: 6144,
    chunkSize: 1300,
    concurrency: 2,
    validated: true
  },
  {
    id: 'rtx4080_qwen14b_throughput',
    model: 'qwen2.5-14b',
    hardware: 'rtx4080_12gb',
    quantization: 'q5_k_m',
    contextWindow: 4096,
    chunkSize: 900,
    concurrency: 2,
    validated: true
  }
];

export const listRuntimePresets = (): RuntimePreset[] => runtimePresets;

export const resolveRuntimePreset = (id: string | undefined): RuntimePreset => {
  const presetId = id ?? defaultRuntimePresetId;
  return runtimePresets.find((preset) => preset.id === presetId) ?? runtimePresets[0];
};

export const validateRuntimePresetMatrix = (presets: RuntimePreset[], defaultPresetId = defaultRuntimePresetId): string[] => {
  const errors: string[] = [];
  const ids = new Set<string>();

  if (!presets.some((preset) => preset.id === defaultPresetId)) {
    errors.push(`default preset missing: ${defaultPresetId}`);
  }

  for (const preset of presets) {
    if (ids.has(preset.id)) {
      errors.push(`duplicate preset id: ${preset.id}`);
    }
    ids.add(preset.id);

    if (preset.model !== 'qwen2.5-14b') {
      errors.push(`preset ${preset.id} model must be qwen2.5-14b`);
    }
    if (preset.hardware !== 'rtx4080_12gb') {
      errors.push(`preset ${preset.id} hardware must be rtx4080_12gb`);
    }
    if (!preset.validated) {
      errors.push(`preset ${preset.id} must be marked validated`);
    }
    if (preset.contextWindow < 2048 || preset.contextWindow > 8192) {
      errors.push(`preset ${preset.id} contextWindow outside 12GB-safe range`);
    }
    if (preset.chunkSize < 512 || preset.chunkSize > preset.contextWindow / 2) {
      errors.push(`preset ${preset.id} chunkSize must fit contextWindow with headroom`);
    }
    if (preset.concurrency < 1 || preset.concurrency > 2) {
      errors.push(`preset ${preset.id} concurrency outside RTX 4080 12GB validated range`);
    }
    if (preset.quantization === 'q8_0') {
      errors.push(`preset ${preset.id} q8_0 is not validated for Qwen 14B on 12GB VRAM`);
    }
  }

  return errors;
};
