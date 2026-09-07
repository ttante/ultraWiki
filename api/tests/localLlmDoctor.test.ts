import { describe, expect, it } from 'vitest';
import { buildLocalLlmDoctorReport, buildLocalLlmRuntimeHealth } from '../src/domain/localLlmDoctor.js';

describe('buildLocalLlmDoctorReport', () => {
  it('reports ready when config, compose, GPU, and model file are present', () => {
    const report = buildLocalLlmDoctorReport({
      validationErrors: [],
      modelPath: 'models/qwen2.5-14b-instruct-q4_k_m.gguf',
      modelExists: true,
      modelBytes: 8 * 1024 * 1024 * 1024,
      composeValid: true,
      gpuSummary: 'NVIDIA GeForce RTX 4080, 12282 MiB',
      llamaHostPort: 8080
    });

    expect(report.status).toBe('ready');
    expect(report.lines.join('\n')).toContain('Model file: found');
    expect(report.lines.join('\n')).toContain('Docker compose llama profile: valid');
  });

  it('reports actionable blockers without failing config validation', () => {
    const report = buildLocalLlmDoctorReport({
      validationErrors: [],
      modelPath: 'models/qwen2.5-14b-instruct-q4_k_m.gguf',
      modelExists: false,
      composeValid: false,
      composeError: 'docker not found',
      llamaHostPort: 28080
    });

    expect(report.status).toBe('blocked');
    expect(report.lines.join('\n')).toContain('Model file: missing');
    expect(report.lines.join('\n')).toContain('docker not found');
    expect(report.lines.join('\n')).toContain('http://localhost:28080/health');
  });

  it('reports invalid configuration separately from local machine blockers', () => {
    const report = buildLocalLlmDoctorReport({
      validationErrors: ['runtime preset missing: rtx4080_qwen14b_safe'],
      modelPath: 'models/qwen2.5-14b-instruct-q4_k_m.gguf',
      modelExists: false,
      composeValid: false,
      llamaHostPort: 8080
    });

    expect(report.status).toBe('invalid');
    expect(report.lines.join('\n')).toContain('Config: invalid');
    expect(report.lines.join('\n')).toContain('runtime preset missing');
  });

  it('builds structured runtime health from provider config and LLM telemetry', () => {
    const health = buildLocalLlmRuntimeHealth({
      provider: 'openai_compatible',
      model: 'qwen2.5-14b-instruct-q4_k_m',
      baseUrl: 'http://localhost:8080/v1',
      runtimePreset: 'rtx4080_qwen14b_safe',
      quantization: 'q4_k_m',
      contextWindow: 4096,
      chunkSize: 1000,
      concurrency: 1,
      timeoutMs: 120_000,
      calls: {
        attempted: 3,
        succeeded: 1,
        fallback: 1,
        timeouts: 1,
        timeoutRate: 1 / 3
      },
      byStageModel: [
        {
          provider: 'openai_compatible',
          model: 'qwen2.5-14b-instruct-q4_k_m',
          stage: 'summaries',
          attempted: 2,
          succeeded: 1,
          fallback: 1,
          avgLatencyMs: 1500,
          p95LatencyMs: 2400
        },
        {
          provider: 'openai_compatible',
          model: 'qwen2.5-14b-instruct-q4_k_m',
          stage: 'active_recall',
          attempted: 1,
          succeeded: 0,
          fallback: 0,
          avgLatencyMs: 3000,
          p95LatencyMs: 3000
        }
      ]
    });

    expect(health.status).toBe('degraded');
    expect(health.fallbackMode).toBe(true);
    expect(health.timeoutStatus).toBe('timeouts_recorded');
    expect(health.latency.avgMs).toBe(2000);
    expect(health.latency.p95Ms).toBe(3000);
    expect(health.stages.map((stage) => stage.stage)).toEqual(['active_recall', 'summaries']);
  });
});
