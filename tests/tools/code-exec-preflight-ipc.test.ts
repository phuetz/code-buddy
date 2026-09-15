import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PreflightWorkerResult } from '../../src/tools/code-exec-preflight-runner.js';

const require = createRequire(import.meta.url);
const runner = fileURLToPath(new URL('../../src/tools/code-exec-preflight-runner.ts', import.meta.url));

describe('preflight child process response delivery', () => {
  it.each([
    ['valid code', 'const total = 60;', true],
    ['invalid code', 'const total = ;', false],
  ] as const)('flushes a large catalogue response for %s before exiting', async (_name, code, success) => {
    // Real catalogues already exceed 280KB. Exercise pipe backpressure with
    // declarations echoed by the real compiler, without replacing its IPC.
    const declarations = `//${'catalogue description '.repeat(30000)}\n`;
    const result = await new Promise<PreflightWorkerResult>((resolve, reject) => {
      const child = spawn(process.execPath, [
        '--max-old-space-size=128', '--import', require.resolve('tsx'), runner,
      ], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced' });
      let received: PreflightWorkerResult | undefined;
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Preflight child timed out'));
      }, 15000);
      child.stderr.on('data', chunk => { stderr += String(chunk); });
      child.on('message', (message: { type?: string; result?: PreflightWorkerResult }) => {
        if (message.type === 'result') received = message.result;
      });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', exitCode => {
        clearTimeout(timer);
        if (exitCode !== 0 || !received) {
          reject(new Error(`Preflight exited ${exitCode} before delivering its result: ${stderr}`));
        } else {
          resolve(received);
        }
      });
      child.send({ type: 'compile', payload: { code, declarations } });
    });
    expect(result.success).toBe(success);
    expect(result.declarations).toBe(declarations);
    if (!success) expect(result.error).toContain('Expression expected');
  }, 20000);
});
