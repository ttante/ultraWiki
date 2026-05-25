import { describe, expect, it } from 'vitest';
import { buildLocalLlmDoctorReport } from '../src/domain/localLlmDoctor.js';

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
});
