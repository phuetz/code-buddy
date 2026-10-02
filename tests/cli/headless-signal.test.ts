import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('returns 143 when a headless CLI without a terminal is terminated while awaiting its provider', async () => {
  if (process.platform === 'win32') return; // POSIX signal status is tested on Linux.
  const home = await mkdtemp(join(tmpdir(), 'headless-signal-'));
  let child: ChildProcess | undefined;
  let interrupted = false;
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/ps' || req.url === '/api/tags') {
      res.end(JSON.stringify({ models: [{ name: 'fixture-model', context_length: 32768 }] }));
    } else if (req.url === '/api/chat') {
      // No completion is supplied. Kill only after the CLI has actually entered
      // its provider request, when its headless signal handlers are installed.
      interrupted = child?.kill('SIGTERM') ?? false;
    } else res.end('{}');
  });
  try {
    await new Promise<void>((accept, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', accept);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No listening port');
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((accept, reject) => {
      child = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'),
        resolve('src/index.ts'), '-p', 'Describe the current directory.',
        '--output-format', 'json', '--ephemeral', '--permission-mode', 'dontAsk'], {
        cwd: home, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, HOME: home, USERPROFILE: home, CODEBUDDY_HOME: join(home, '.codebuddy'),
          CODEBUDDY_PROVIDER: 'ollama', OLLAMA_HOST: `http://127.0.0.1:${address.port}`,
          GROK_MODEL: 'fixture-model', CODEBUDDY_DISABLE_MCP: 'true',
          CODEBUDDY_LEARNING_BACKGROUND_REVIEW: 'false', CODEBUDDY_TELEMETRY: 'false',
          LOG_LEVEL: 'error', NODE_ENV: 'production' },
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', chunk => { stdout += chunk; });
      child.stderr?.on('data', chunk => { stderr += chunk; });
      const timer = setTimeout(() => child?.kill('SIGKILL'), 30_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); accept({ code, stdout, stderr }); });
    });
    expect(interrupted).toBe(true);
    expect(result.code, result.stderr).toBe(143);
    expect(result.stdout).toBe('');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    server.closeAllConnections();
    await new Promise<void>(accept => server.close(() => accept()));
    await rm(home, { recursive: true, force: true });
  }
}, 45_000);
