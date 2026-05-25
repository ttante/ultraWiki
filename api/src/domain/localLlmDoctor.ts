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

const formatBytes = (bytes: number): string => `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;

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
