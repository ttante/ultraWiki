import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLocalLlmConfig, type LocalLlmConfig } from '../src/domain/localLlmConfig.js';
import { buildLocalLlmDoctorReport } from '../src/domain/localLlmDoctor.js';
import { listRuntimePresets } from '../src/domain/runtimePreset.js';

const runCommand = (command: string, args: string[]): { ok: boolean; output?: string; error?: string } => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || result.stdout || `exit ${result.status}`).trim() };
  }
  return { ok: true, output: result.stdout.trim() };
};

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '../..');
  const strict = process.argv.includes('--strict');
  const [configRaw, composeText] = await Promise.all([
    readFile(path.resolve(root, 'infra/llm/local-qwen.json'), 'utf8'),
    readFile(path.resolve(root, 'docker-compose.yml'), 'utf8')
  ]);
  const config = JSON.parse(configRaw) as LocalLlmConfig;
  const runtimePresetIds = listRuntimePresets().map((preset) => preset.id);
  const validation = validateLocalLlmConfig(config, composeText, runtimePresetIds);
  const modelPath = path.resolve(root, config.model.host_path);
  const modelStat = await stat(modelPath).catch(() => undefined);
  const compose = runCommand('docker', ['compose', '--profile', config.compose_profile, 'config']);
  const gpu = runCommand('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader']);
  const report = buildLocalLlmDoctorReport({
    validationErrors: validation.errors,
    modelPath: config.model.host_path,
    modelExists: Boolean(modelStat?.isFile()),
    modelBytes: modelStat?.size,
    composeValid: compose.ok,
    composeError: compose.error,
    gpuSummary: gpu.ok ? gpu.output : undefined,
    llamaHostPort: Number(process.env.LLAMA_HOST_PORT ?? 8080)
  });

  for (const line of report.lines) {
    console.log(line);
  }

  if (report.status === 'invalid' || (strict && report.status !== 'ready')) {
    process.exit(1);
  }
};

void run();
