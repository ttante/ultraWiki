import { beforeEach, describe, expect, it } from 'vitest';
import { defaultRuntimePresetId, getConfig } from '../src/config.js';

describe('getConfig', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
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
    delete process.env.AUTH_ALLOW_HEADER_USER;
    delete process.env.SHARE_TOKEN_SECRET;
    delete process.env.SHARE_LINK_TTL_SECONDS;
    delete process.env.SHARE_READ_RATE_LIMIT_WINDOW_SECONDS;
    delete process.env.SHARE_READ_RATE_LIMIT_MAX;
    delete process.env.SHARE_READ_FAILED_RATE_LIMIT_MAX;
    delete process.env.GENERATION_RATE_LIMIT_WINDOW_SECONDS;
    delete process.env.GENERATION_RATE_LIMIT_MAX;
    delete process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS;
    delete process.env.AUTH_RATE_LIMIT_MAX;
    delete process.env.ANALYTICS_RATE_LIMIT_WINDOW_SECONDS;
    delete process.env.ANALYTICS_RATE_LIMIT_MAX;
    delete process.env.TRUST_PROXY;
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
    expect(c.authAllowHeaderUser).toBe(true);
    expect(c.shareTokenSecret).toBe('dev-only-ultrawiki-share-token-secret');
    expect(c.shareLinkTtlSeconds).toBe(604_800);
    expect(c.shareReadRateLimitWindowSeconds).toBe(60);
    expect(c.shareReadRateLimitMax).toBe(120);
    expect(c.shareReadFailedRateLimitMax).toBe(20);
    expect(c.generationRateLimitWindowSeconds).toBe(60);
    expect(c.generationRateLimitMax).toBe(30);
    expect(c.authRateLimitWindowSeconds).toBe(60);
    expect(c.authRateLimitMax).toBe(120);
    expect(c.analyticsRateLimitWindowSeconds).toBe(60);
    expect(c.analyticsRateLimitMax).toBe(240);
    expect(c.trustProxy).toBe(false);
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

  it('disables legacy header auth by default in production unless explicitly enabled', () => {
    process.env.NODE_ENV = 'production';
    expect(getConfig().authAllowHeaderUser).toBe(false);

    process.env.AUTH_ALLOW_HEADER_USER = '1';
    expect(getConfig().authAllowHeaderUser).toBe(true);
  });

  it('enables trusted proxy address handling only when explicitly configured', () => {
    expect(getConfig().trustProxy).toBe(false);

    process.env.TRUST_PROXY = '1';
    expect(getConfig().trustProxy).toBe(true);
  });

  it('reads share token security settings from env', () => {
    process.env.SHARE_TOKEN_SECRET = 'share-secret';
    process.env.SHARE_LINK_TTL_SECONDS = '3600';
    process.env.SHARE_READ_RATE_LIMIT_WINDOW_SECONDS = '30';
    process.env.SHARE_READ_RATE_LIMIT_MAX = '40';
    process.env.SHARE_READ_FAILED_RATE_LIMIT_MAX = '5';
    process.env.GENERATION_RATE_LIMIT_WINDOW_SECONDS = '45';
    process.env.GENERATION_RATE_LIMIT_MAX = '12';
    process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS = '90';
    process.env.AUTH_RATE_LIMIT_MAX = '25';
    process.env.ANALYTICS_RATE_LIMIT_WINDOW_SECONDS = '120';
    process.env.ANALYTICS_RATE_LIMIT_MAX = '80';

    const c = getConfig();
    expect(c.shareTokenSecret).toBe('share-secret');
    expect(c.shareLinkTtlSeconds).toBe(3600);
    expect(c.shareReadRateLimitWindowSeconds).toBe(30);
    expect(c.shareReadRateLimitMax).toBe(40);
    expect(c.shareReadFailedRateLimitMax).toBe(5);
    expect(c.generationRateLimitWindowSeconds).toBe(45);
    expect(c.generationRateLimitMax).toBe(12);
    expect(c.authRateLimitWindowSeconds).toBe(90);
    expect(c.authRateLimitMax).toBe(25);
    expect(c.analyticsRateLimitWindowSeconds).toBe(120);
    expect(c.analyticsRateLimitMax).toBe(80);
  });
});
