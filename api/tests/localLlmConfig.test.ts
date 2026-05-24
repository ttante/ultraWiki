import { describe, expect, it } from 'vitest';
import { validateLocalLlmConfig, type LocalLlmConfig } from '../src/domain/localLlmConfig.js';

const composeText = `
services:
  llama:
    image: ghcr.io/ggerganov/llama.cpp:server
    command: ["--host", "0.0.0.0", "--port", "8080", "-m", "/models/qwen2.5-14b-instruct-q4_k_m.gguf", "-c", "4096", "-ngl", "100"]
    volumes:
      - ./models:/models
    ports:
      - "\${LLAMA_HOST_PORT:-8080}:8080"
    gpus: all
    profiles: ["llama"]
`;

const validConfig: LocalLlmConfig = {
  version: '1.0.0',
  runtime_preset_id: 'rtx4080_qwen14b_safe',
  compose_profile: 'llama',
  compose_service: 'llama',
  model: {
    name: 'qwen2.5-14b',
    quantization: 'q4_k_m',
    host_path: 'models/qwen2.5-14b-instruct-q4_k_m.gguf',
    container_path: '/models/qwen2.5-14b-instruct-q4_k_m.gguf',
    min_vram_gb: 12
  },
  server: {
    host: '0.0.0.0',
    port: 8080,
    context_window: 4096,
    gpu_layers: 100,
    health_url: 'http://localhost:8080/health'
  }
};

describe('validateLocalLlmConfig', () => {
  it('accepts the local Qwen 14B llama.cpp profile', () => {
    const result = validateLocalLlmConfig(validConfig, composeText, ['rtx4080_qwen14b_safe']);
    expect(result.valid).toBe(true);
  });

  it('rejects unsafe or unlinked local model config', () => {
    const result = validateLocalLlmConfig(
      {
        ...validConfig,
        runtime_preset_id: 'missing',
        compose_profile: 'mock',
        model: {
          ...validConfig.model,
          host_path: '/tmp/model.bin',
          container_path: '/tmp/model.bin',
          min_vram_gb: 24
        },
        server: {
          ...validConfig.server,
          port: 9000,
          context_window: 16384,
          gpu_layers: 0,
          health_url: 'http://localhost:9000/status'
        }
      },
      'services: {}',
      ['rtx4080_qwen14b_safe']
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('runtime preset missing');
    expect(result.errors.join(' ')).toContain('compose_profile must be llama');
    expect(result.errors.join(' ')).toContain('repository-relative');
    expect(result.errors.join(' ')).toContain('RTX 4080 12GB');
    expect(result.errors.join(' ')).toContain('GPU offload');
  });
});
