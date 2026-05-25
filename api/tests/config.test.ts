import { beforeEach, describe, expect, it } from 'vitest';
import { defaultRuntimePresetId, getConfig } from '../src/config.js';

describe('getConfig', () => {
  beforeEach(() => {
    delete process.env.RUNTIME_PRESET;
    delete process.env.LLM_QUANTIZATION;
    delete process.env.LLM_CONTEXT_WINDOW;
    delete process.env.LLM_CHUNK_SIZE;
    delete process.env.LLM_CONCURRENCY;
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_TIMEOUT_MS;
    delete process.env.JOB_CONCURRENCY_LIMIT;
  });

  it('reads defaults', () => {
    const c = getConfig();
    expect(c.apiPort).toBeGreaterThan(0);
    expect(c.wikipediaLang).toBe('en');
    expect(c.runtimePreset).toBe(defaultRuntimePresetId);
    expect(c.llmConcurrency).toBe(1);
    expect(c.llmProvider).toBe('rule_based');
    expect(c.llmBaseUrl).toBe('http://llm:8080/v1');
    expect(c.llmModel).toBe('qwen2.5-14b-instruct-q4_k_m');
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

  it('enables OpenAI-compatible local LLM provider through env', () => {
    process.env.LLM_PROVIDER = 'openai_compatible';
    process.env.LLM_BASE_URL = 'http://localhost:8080/v1';
    process.env.LLM_MODEL = 'qwen2.5-14b-instruct-q4_k_m';
    process.env.LLM_TIMEOUT_MS = '12345';
    const c = getConfig();
    expect(c.llmProvider).toBe('openai_compatible');
    expect(c.llmBaseUrl).toBe('http://localhost:8080/v1');
    expect(c.llmModel).toBe('qwen2.5-14b-instruct-q4_k_m');
    expect(c.llmTimeoutMs).toBe(12345);
  });
});
