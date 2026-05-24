import { beforeEach, describe, expect, it } from 'vitest';
import { defaultRuntimePresetId, getConfig } from '../src/config.js';

describe('getConfig', () => {
  beforeEach(() => {
    delete process.env.RUNTIME_PRESET;
    delete process.env.LLM_QUANTIZATION;
    delete process.env.LLM_CONTEXT_WINDOW;
    delete process.env.LLM_CHUNK_SIZE;
    delete process.env.LLM_CONCURRENCY;
    delete process.env.JOB_CONCURRENCY_LIMIT;
  });

  it('reads defaults', () => {
    const c = getConfig();
    expect(c.apiPort).toBeGreaterThan(0);
    expect(c.wikipediaLang).toBe('en');
    expect(c.runtimePreset).toBe(defaultRuntimePresetId);
    expect(c.llmConcurrency).toBe(1);
    expect(c.globalConcurrencyLimit).toBe(1);
    expect(c.cacheTtlSeconds).toBe(604_800);
  });

  it('loads selected runtime preset and allows explicit concurrency override', () => {
    process.env.RUNTIME_PRESET = 'rtx4080_qwen14b_balanced';
    process.env.JOB_CONCURRENCY_LIMIT = '3';
    const c = getConfig();
    expect(c.runtimePreset).toBe('rtx4080_qwen14b_balanced');
    expect(c.llmContextWindow).toBe(6144);
    expect(c.llmChunkSize).toBe(1300);
    expect(c.llmConcurrency).toBe(2);
    expect(c.globalConcurrencyLimit).toBe(3);
  });
});
