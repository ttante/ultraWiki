import { describe, expect, it } from 'vitest';
import {
  buildRuntimePresetVisibility,
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

  it('builds read-only preset visibility with selected preset and fallback mode', () => {
    const visibility = buildRuntimePresetVisibility({
      currentPresetId: 'rtx4080_qwen14b_balanced',
      provider: 'openai_compatible',
      model: 'qwen2.5-14b-instruct-q4_k_m',
      quantization: 'q4_k_m',
      contextWindow: 6144,
      chunkSize: 1300,
      concurrency: 2,
      timeoutMs: 120000
    });

    expect(visibility.defaultPresetId).toBe(defaultRuntimePresetId);
    expect(visibility.fallbackMode).toBe('openai_with_rule_based_fallback');
    expect(visibility.presets.find((preset) => preset.id === 'rtx4080_qwen14b_balanced')).toMatchObject({
      selected: true,
      default: false,
      model: 'qwen2.5-14b',
      hardware: 'rtx4080_12gb'
    });
    expect(visibility.presets.find((preset) => preset.id === defaultRuntimePresetId)).toMatchObject({
      selected: false,
      default: true
    });
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
