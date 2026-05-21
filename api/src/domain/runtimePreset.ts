export type RuntimePreset = {
  id: string;
  quantization: 'q4_k_m' | 'q5_k_m' | 'q8_0';
  contextWindow: number;
  chunkSize: number;
  concurrency: number;
};

export const defaultRuntimePresetId = 'rtx4080_qwen14b_safe';

const runtimePresets: RuntimePreset[] = [
  {
    id: 'rtx4080_qwen14b_safe',
    quantization: 'q4_k_m',
    contextWindow: 4096,
    chunkSize: 1000,
    concurrency: 1
  },
  {
    id: 'rtx4080_qwen14b_balanced',
    quantization: 'q4_k_m',
    contextWindow: 6144,
    chunkSize: 1300,
    concurrency: 2
  },
  {
    id: 'rtx4080_qwen14b_throughput',
    quantization: 'q5_k_m',
    contextWindow: 4096,
    chunkSize: 900,
    concurrency: 2
  }
];

export const listRuntimePresets = (): RuntimePreset[] => runtimePresets;

export const resolveRuntimePreset = (id: string | undefined): RuntimePreset => {
  const presetId = id ?? defaultRuntimePresetId;
  return runtimePresets.find((preset) => preset.id === presetId) ?? runtimePresets[0];
};
