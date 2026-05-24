import { describe, expect, it } from 'vitest';
import {
  defaultRuntimePresetId,
  listRuntimePresets,
  resolveRuntimePreset,
  validateRuntimePresetMatrix
} from '../src/domain/runtimePreset.js';

describe('runtime presets', () => {
  it('provides a matrix with a stable default preset', () => {
    const presets = listRuntimePresets();
    expect(presets.length).toBeGreaterThanOrEqual(3);
    expect(presets.some((preset) => preset.id === defaultRuntimePresetId)).toBe(true);
    expect(validateRuntimePresetMatrix(presets)).toEqual([]);
    expect(presets.every((preset) => preset.model === 'qwen2.5-14b')).toBe(true);
    expect(presets.every((preset) => preset.hardware === 'rtx4080_12gb')).toBe(true);
    expect(presets.every((preset) => preset.validated)).toBe(true);
  });

  it('resolves explicit preset and falls back to default', () => {
    const balanced = resolveRuntimePreset('rtx4080_qwen14b_balanced');
    expect(balanced.concurrency).toBe(2);
    const fallback = resolveRuntimePreset('unknown');
    expect(fallback.id).toBe(defaultRuntimePresetId);
  });

  it('rejects unsafe or inconsistent preset matrix entries', () => {
    expect(
      validateRuntimePresetMatrix([
        {
          id: 'bad',
          model: 'qwen2.5-14b',
          hardware: 'rtx4080_12gb',
          quantization: 'q8_0',
          contextWindow: 16384,
          chunkSize: 9000,
          concurrency: 4,
          validated: false
        }
      ])
    ).toEqual([
      'default preset missing: rtx4080_qwen14b_safe',
      'preset bad must be marked validated',
      'preset bad contextWindow outside 12GB-safe range',
      'preset bad chunkSize must fit contextWindow with headroom',
      'preset bad concurrency outside RTX 4080 12GB validated range',
      'preset bad q8_0 is not validated for Qwen 14B on 12GB VRAM'
    ]);
  });
});
