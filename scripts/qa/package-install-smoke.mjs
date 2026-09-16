#!/usr/bin/env node
/** Verify an installed dist/index.js with isolated credentials and bounded commands. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function runSmokeCommand(args, options) {
  const { binPath, homeDir, timeoutMs = 15000, nodeBin = process.execPath } = options;
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const systemPaths = process.platform === 'win32'
    ? [join(systemRoot, 'System32')]
    : ['/usr/local/bin', '/usr/bin', '/bin'];
  const start = Date.now();
  // Invoke Node explicitly: npm's platform-specific shell shims are not JS.
  const result = spawnSync(nodeBin, [resolve(binPath), ...args], {
    cwd: homeDir,
    env: {
      HOME: homeDir,
      USERPROFILE: homeDir,
      TMPDIR: homeDir,
      TEMP: homeDir,
      TMP: homeDir,
      PATH: [dirname(nodeBin), ...systemPaths].join(delimiter),
      ...(process.platform === 'win32' ? { SystemRoot: systemRoot } : {}),
      CI: 'true',
      TERM: 'dumb',
      NO_COLOR: '1',
    },
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const timedOut = result.error?.code === 'ETIMEDOUT';
  return {
    args,
    exitCode: result.status ?? (timedOut ? 124 : 1),
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || '',
    durationMs: Date.now() - start,
    timedOut,
  };
}

const CHECKS = [
  { name: 'version', args: ['--version'], codes: [0], output: /^\d+\.\d+\.\d+/m },
  { name: 'help', args: ['--help'], codes: [0], output: /Usage:/ },
  { name: 'loginHelp', args: ['login', '--help'], codes: [0], output: /Usage:.*login/ },
  { name: 'whoami', args: ['whoami'], codes: [0], output: /ChatGPT: not connected/ },
  { name: 'loginNoBrowser', args: ['login', '--no-browser'], codes: [1], output: /interactive terminal and a browser/ },
  { name: 'doctor', args: ['doctor'], codes: [0, 1], output: /Code Buddy Doctor/ },
];

export function runAllSmokeTests(options) {
  const homeDir = mkdtempSync(join(tmpdir(), 'codebuddy-package-smoke-'));
  try {
    const checks = CHECKS.map(({ name, args, codes, output }) => {
      const result = runSmokeCommand(args, { ...options, homeDir });
      return {
        name,
        ...result,
        passed: !result.timedOut && codes.includes(result.exitCode)
          && output.test(result.stdout + result.stderr),
      };
    });
    return { passed: checks.every((check) => check.passed), checks };
  } finally {
    rmSync(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    process.stderr.write('Usage: package-install-smoke.mjs <installed-package/dist/index.js>\n');
    process.exitCode = 2;
  } else {
    const result = runAllSmokeTests({ binPath: process.argv[2] });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.passed ? 0 : 1;
  }
}
