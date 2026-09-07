export type LocalLlmDoctorReportInput = {
  validationErrors: string[];
  modelPath: string;
  modelExists: boolean;
  modelBytes?: number;
  composeValid: boolean;
  composeError?: string;
  gpuSummary?: string;
  llamaHostPort: number;
};

export type LocalLlmDoctorReport = {
  status: 'ready' | 'blocked' | 'invalid';
  lines: string[];
};

export type LocalLlmRuntimeHealthInput = {
  provider: 'rule_based' | 'openai_compatible';
  model: string;
  baseUrl: string;
  runtimePreset: string;
  quantization: string;
  contextWindow: number;
  chunkSize: number;
  concurrency: number;
  timeoutMs: number;
  calls: {
    attempted: number;
    succeeded: number;
    fallback: number;
    timeouts: number;
    timeoutRate: number;
  };
  byStageModel: Array<{
    provider: string;
    model: string;
    stage: string;
    attempted: number;
    succeeded: number;
    fallback: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  }>;
};

export type LocalLlmRuntimeHealth = {
  generatedAt: string;
  provider: 'rule_based' | 'openai_compatible';
  model: string;
  baseUrl: string;
  runtimePreset: string;
  quantization: string;
  contextWindow: number;
  chunkSize: number;
  concurrency: number;
  timeoutMs: number;
  status: 'ready' | 'idle' | 'degraded' | 'fallback';
  fallbackMode: boolean;
  timeoutStatus: 'clear' | 'timeouts_recorded';
  calls: {
    attempted: number;
    succeeded: number;
    fallback: number;
    timeouts: number;
    timeoutRate: number;
  };
  latency: {
    avgMs: number;
    p95Ms: number;
  };
  stages: Array<{
    provider: string;
    model: string;
    stage: string;
    attempted: number;
    succeeded: number;
    fallback: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  }>;
};

const formatBytes = (bytes: number): string => `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;

const averageWeightedLatency = (
  rows: Array<{ attempted: number; avgLatencyMs: number }>,
  attemptedTotal: number
): number => {
  if (attemptedTotal <= 0) return 0;
  return rows.reduce((sum, row) => sum + row.avgLatencyMs * row.attempted, 0) / attemptedTotal;
};

export const buildLocalLlmRuntimeHealth = (input: LocalLlmRuntimeHealthInput): LocalLlmRuntimeHealth => {
  const stageRows = input.byStageModel
    .filter((row) => row.provider === input.provider && row.model === input.model)
    .sort((a, b) => a.stage.localeCompare(b.stage));
  const avgMs = averageWeightedLatency(stageRows, input.calls.attempted);
  const p95Ms = stageRows.reduce((max, row) => Math.max(max, row.p95LatencyMs), 0);
  const fallbackMode = input.provider === 'rule_based' || input.calls.fallback > 0;
  const status =
    input.provider === 'rule_based'
      ? 'fallback'
      : input.calls.timeouts > 0 || input.calls.fallback > 0
        ? 'degraded'
        : input.calls.succeeded > 0
          ? 'ready'
          : 'idle';

  return {
    generatedAt: new Date().toISOString(),
    provider: input.provider,
    model: input.model,
    baseUrl: input.baseUrl,
    runtimePreset: input.runtimePreset,
    quantization: input.quantization,
    contextWindow: input.contextWindow,
    chunkSize: input.chunkSize,
    concurrency: input.concurrency,
    timeoutMs: input.timeoutMs,
    status,
    fallbackMode,
    timeoutStatus: input.calls.timeouts > 0 ? 'timeouts_recorded' : 'clear',
    calls: { ...input.calls },
    latency: {
      avgMs,
      p95Ms
    },
    stages: stageRows
  };
};

export const buildLocalLlmDoctorReport = (input: LocalLlmDoctorReportInput): LocalLlmDoctorReport => {
  const lines: string[] = ['Local Qwen 14B doctor'];

  if (input.validationErrors.length > 0) {
    lines.push('Config: invalid');
    lines.push(...input.validationErrors.map((error) => `FAIL ${error}`));
    return { status: 'invalid', lines };
  }

  lines.push('Config: valid');

  if (input.modelExists) {
    lines.push(`Model file: found at ${input.modelPath}${input.modelBytes ? ` (${formatBytes(input.modelBytes)})` : ''}`);
  } else {
    lines.push(`Model file: missing at ${input.modelPath}`);
    lines.push(`Place the GGUF at ${input.modelPath} before running npm run llm:check-local or npm run eval:real-model.`);
  }

  if (input.composeValid) {
    lines.push('Docker compose llama profile: valid');
  } else {
    lines.push(`Docker compose llama profile: unavailable${input.composeError ? ` (${input.composeError})` : ''}`);
  }

  if (input.gpuSummary) {
    lines.push(`GPU: ${input.gpuSummary}`);
  } else {
    lines.push('GPU: nvidia-smi unavailable; confirm Docker can expose the RTX 4080 before real-model eval.');
  }

  lines.push(`Expected llama.cpp health URL: http://localhost:${input.llamaHostPort}/health`);
  lines.push('Next commands:');
  lines.push('  npm run llm:check-local');
  lines.push('  npm run llm:check-local -- --start');
  lines.push('  npm run eval:real-model');

  const ready = input.modelExists && input.composeValid;
  return { status: ready ? 'ready' : 'blocked', lines };
};
