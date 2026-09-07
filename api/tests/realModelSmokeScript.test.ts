import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('real-model smoke trigger script', () => {
  it('dry-runs the guarded API trigger and status endpoints', async () => {
    const repoRoot = path.resolve(process.cwd(), '..');
    const { stdout } = await execFileAsync('bash', ['scripts/trigger-real-model-smoke.sh', '--dry-run'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        API_BASE_URL: 'http://api.test:4000'
      }
    });

    expect(stdout).toContain('POST http://api.test:4000/api/runtime/llm/smoke');
    expect(stdout).toContain('body {"confirm":"run-real-model-smoke"}');
    expect(stdout).toContain('GET http://api.test:4000/api/runtime/llm/smoke');
  });

  it('sends the configured bearer token when triggering and polling smoke status', async () => {
    const repoRoot = path.resolve(process.cwd(), '..');
    const tempDir = await mkdtemp(path.join(tmpdir(), 'real-model-smoke-script-'));
    const curlLog = path.join(tempDir, 'curl-args.log');
    const fakeCurl = path.join(tempDir, 'curl');
    await writeFile(
      fakeCurl,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$REAL_MODEL_SMOKE_CURL_LOG"
if printf '%s\\n' "$*" | grep -q -- '-X POST'; then
  printf '{"status":"running"}'
else
  printf '{"status":"passed"}'
fi
`,
      'utf8'
    );
    await chmod(fakeCurl, 0o755);

    const { stdout } = await execFileAsync('bash', ['scripts/trigger-real-model-smoke.sh'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        API_BASE_URL: 'http://api.test:4000',
        REAL_MODEL_SMOKE_API_TOKEN: 'script-smoke-secret',
        REAL_MODEL_SMOKE_CURL_BIN: fakeCurl,
        REAL_MODEL_SMOKE_CURL_LOG: curlLog,
        REAL_MODEL_SMOKE_POLL_INTERVAL_SECONDS: '0',
        REAL_MODEL_SMOKE_TIMEOUT_SECONDS: '5'
      }
    });

    const curlCalls = (await readFile(curlLog, 'utf8')).trim().split('\n');
    expect(stdout).toContain('real-model smoke passed');
    expect(curlCalls).toHaveLength(2);
    expect(curlCalls.every((call) => call.includes('-H authorization: Bearer script-smoke-secret'))).toBe(true);
  });
});
