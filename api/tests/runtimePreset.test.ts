import { describe, expect, it } from 'vitest';
import { defaultRuntimePresetId, listRuntimePresets, resolveRuntimePreset } from '../src/domain/runtimePreset.js';

describe('runtime presets', () => {
  it('provides a matrix with a stable default preset', () => {
    const presets = listRuntimePresets();
    expect(presets.length).toBeGreaterThanOrEqual(3);
    expect(presets.some((preset) => preset.id === defaultRuntimePresetId)).toBe(true);
  });

  it('resolves explicit preset and falls back to default', () => {
    const balanced = resolveRuntimePreset('rtx4080_qwen14b_balanced');
    expect(balanced.concurrency).toBe(2);
    const fallback = resolveRuntimePreset('unknown');
    expect(fallback.id).toBe(defaultRuntimePresetId);
  });
});
