import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const realModelSmokeConfirmation = 'run-real-model-smoke';

export type RealModelSmokeState = 'idle' | 'running' | 'passed' | 'failed';

export type RealModelSmokeStatus = {
  status: RealModelSmokeState;
  runId?: string;
  command: string;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number;
  outputTail?: string;
  error?: string;
};

export type RealModelSmokeRunnerInput = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  displayCommand: string;
};

export type RealModelSmokeRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
};

export type RealModelSmokeRunner = (input: RealModelSmokeRunnerInput) => Promise<RealModelSmokeRunResult>;

export class RealModelSmokeAlreadyRunningError extends Error {
  constructor() {
    super('real_model_smoke_already_running');
  }
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const outputTailLimit = 8_000;

const appendTail = (current: string, chunk: Buffer | string): string =>
  `${current}${String(chunk)}`.slice(-outputTailLimit);

const resolveRepoRoot = (): string => {
  const candidates = [
    process.env.REAL_MODEL_SMOKE_WORKDIR,
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(moduleDir, '../../..'),
    path.resolve(moduleDir, '../../../..')
  ].filter((candidate): candidate is string => Boolean(candidate));

  return (
    candidates.find(
      (candidate) =>
        existsSync(path.resolve(candidate, 'package.json')) &&
        existsSync(path.resolve(candidate, 'scripts/smoke-real-llm.sh'))
    ) ?? process.cwd()
  );
};

export const buildRealModelSmokeCommand = (): RealModelSmokeRunnerInput => {
  const cwd = resolveRepoRoot();
  return {
    command: 'npm',
    args: ['run', 'smoke:real-llm'],
    cwd,
    env: {
      ...process.env,
      REAL_MODEL_SMOKE_TRIGGERED_BY: 'api'
    },
    displayCommand: 'npm run smoke:real-llm'
  };
};

export const runRealModelSmokeCommand: RealModelSmokeRunner = async (input) =>
  new Promise<RealModelSmokeRunResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout?.on('data', (chunk) => {
      stdout = appendTail(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = appendTail(stderr, chunk);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode: 1,
        stdout,
        stderr: appendTail(stderr, error.message),
        error: error.message
      });
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        error: signal ? `terminated_by_signal:${signal}` : undefined
      });
    });
  });

export class RealModelSmokeController {
  private runner: RealModelSmokeRunner;

  private status: RealModelSmokeStatus = {
    status: 'idle',
    command: buildRealModelSmokeCommand().displayCommand
  };

  constructor(runner: RealModelSmokeRunner = runRealModelSmokeCommand) {
    this.runner = runner;
  }

  getStatus(): RealModelSmokeStatus {
    return { ...this.status, command: this.status.command || buildRealModelSmokeCommand().displayCommand };
  }

  trigger(): RealModelSmokeStatus {
    if (this.status.status === 'running') {
      throw new RealModelSmokeAlreadyRunningError();
    }

    const command = buildRealModelSmokeCommand();
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    this.status = {
      status: 'running',
      runId,
      command: command.displayCommand,
      startedAt
    };

    void this.runner(command)
      .then((result) => {
        this.status = {
          status: result.exitCode === 0 ? 'passed' : 'failed',
          runId,
          command: command.displayCommand,
          startedAt,
          completedAt: new Date().toISOString(),
          exitCode: result.exitCode,
          outputTail: appendTail(result.stdout, result.stderr),
          error: result.error
        };
      })
      .catch((error: unknown) => {
        this.status = {
          status: 'failed',
          runId,
          command: command.displayCommand,
          startedAt,
          completedAt: new Date().toISOString(),
          exitCode: 1,
          outputTail: '',
          error: error instanceof Error ? error.message : 'real_model_smoke_failed'
        };
      });

    return this.getStatus();
  }

  setRunnerForTests(runner: RealModelSmokeRunner): void {
    this.runner = runner;
  }

  resetForTests(): void {
    this.runner = runRealModelSmokeCommand;
    this.status = {
      status: 'idle',
      command: buildRealModelSmokeCommand().displayCommand
    };
  }
}
