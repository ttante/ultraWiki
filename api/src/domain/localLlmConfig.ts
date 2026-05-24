export type LocalLlmConfig = {
  version: string;
  runtime_preset_id: string;
  compose_profile: string;
  compose_service: string;
  model: {
    name: 'qwen2.5-14b';
    quantization: 'q4_k_m' | 'q5_k_m';
    host_path: string;
    container_path: string;
    min_vram_gb: number;
  };
  server: {
    host: string;
    port: number;
    context_window: number;
    gpu_layers: number;
    health_url: string;
  };
};

export type LocalLlmValidation = {
  valid: boolean;
  errors: string[];
};

export const validateLocalLlmConfig = (
  config: LocalLlmConfig,
  composeText: string,
  runtimePresetIds: string[]
): LocalLlmValidation => {
  const errors: string[] = [];

  if (!config.version.trim()) {
    errors.push('version is required');
  }
  if (!runtimePresetIds.includes(config.runtime_preset_id)) {
    errors.push(`runtime preset missing: ${config.runtime_preset_id}`);
  }
  if (config.compose_profile !== 'llama') {
    errors.push('compose_profile must be llama');
  }
  if (config.compose_service !== 'llama') {
    errors.push('compose_service must be llama');
  }
  if (config.model.name !== 'qwen2.5-14b') {
    errors.push('model.name must be qwen2.5-14b');
  }
  if (!config.model.host_path.endsWith('.gguf')) {
    errors.push('model.host_path must point to a GGUF file');
  }
  if (config.model.host_path.startsWith('/')) {
    errors.push('model.host_path must be repository-relative');
  }
  if (!config.model.container_path.startsWith('/models/') || !config.model.container_path.endsWith('.gguf')) {
    errors.push('model.container_path must point to /models/*.gguf');
  }
  if (config.model.min_vram_gb > 12) {
    errors.push('model.min_vram_gb must fit RTX 4080 12GB');
  }
  if (config.server.port !== 8080) {
    errors.push('server.port must match llama.cpp container port 8080');
  }
  if (config.server.context_window < 2048 || config.server.context_window > 8192) {
    errors.push('server.context_window must stay within RTX 4080 12GB validated range');
  }
  if (config.server.gpu_layers < 1) {
    errors.push('server.gpu_layers must enable GPU offload');
  }
  if (!config.server.health_url.includes(':8080/health')) {
    errors.push('server.health_url must target the default llama.cpp health endpoint');
  }
  if (!composeText.includes(`${config.compose_service}:`)) {
    errors.push(`docker-compose.yml missing service: ${config.compose_service}`);
  }
  if (!composeText.includes(`profiles: ["${config.compose_profile}"]`)) {
    errors.push(`docker-compose.yml missing profile: ${config.compose_profile}`);
  }
  if (!composeText.includes(`-m", "${config.model.container_path}"`)) {
    errors.push('docker-compose.yml llama command does not reference configured model path');
  }
  if (!composeText.includes(`-c", "${config.server.context_window}"`)) {
    errors.push('docker-compose.yml llama command does not reference configured context window');
  }
  if (!composeText.includes('gpus: all')) {
    errors.push('docker-compose.yml llama service must request GPU access');
  }

  return { valid: errors.length === 0, errors };
};
