/**
 * Optional RTK command rewriting.
 *
 * RTK is a CLI proxy, not a TypeScript library. We integrate through its
 * stable `rtk rewrite <command>` interface and fail open: when RTK is absent,
 * disabled, times out, or proposes no rewrite, the original command is used.
 */

import { spawn } from '../../utils/tool-process.js';
import { getShellEnvPolicy } from '../../security/shell-env-policy.js';
import { getFilteredEnv } from './command-validator.js';
import { CONTROLLED_SUBPROCESS_ENV } from './env-overrides.js';

export interface RtkRewriteResult {
  originalCommand: string;
  command: string;
  rewritten: boolean;
  reason?: string;
}

const DEFAULT_RTK_TIMEOUT_MS = 1000;
const MAX_REWRITE_OUTPUT_BYTES = 64 * 1024;

export function isRtkRewriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.CODEBUDDY_RTK_REWRITE ?? env.CODEBUDDY_RTK ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on' || raw === 'auto';
}

export function getRtkRewriteTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.CODEBUDDY_RTK_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 50 && raw <= 10000) {
    return Math.trunc(raw);
  }
  return DEFAULT_RTK_TIMEOUT_MS;
}

export async function rewriteCommandWithRtk(command: string): Promise<RtkRewriteResult> {
  const originalCommand = command;
  // Defensive: a malformed tool call can pass a non-string command.
  if (typeof command !== 'string') {
    return { originalCommand, command, rewritten: false, reason: 'invalid-command' };
  }
  if (!isRtkRewriteEnabled()) {
    return { originalCommand, command, rewritten: false, reason: 'disabled' };
  }

  const trimmed = command.trim();
  if (!trimmed) {
    return { originalCommand, command, rewritten: false, reason: 'empty-command' };
  }

  if (/^rtk(?:\s|$)/.test(trimmed)) {
    return { originalCommand, command, rewritten: false, reason: 'already-rtk' };
  }

  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;

    const finish = (result: RtkRewriteResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const filteredEnv = getFilteredEnv();
    const env: NodeJS.ProcessEnv = {
      ...getShellEnvPolicy().buildEnv(filteredEnv),
      ...CONTROLLED_SUBPROCESS_ENV,
    };

    const proc = spawn('rtk', ['rewrite', command], {
      shell: false,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      try {
        proc.kill('SIGTERM');
      } catch {
        // Process already exited.
      }
      finish({ originalCommand, command, rewritten: false, reason: 'timeout' });
    }, getRtkRewriteTimeoutMs());

    proc.stdout?.on('data', (data: Buffer) => {
      if (stdout.length >= MAX_REWRITE_OUTPUT_BYTES) return;
      stdout += data.toString();
      if (stdout.length > MAX_REWRITE_OUTPUT_BYTES) {
        stdout = stdout.slice(0, MAX_REWRITE_OUTPUT_BYTES);
      }
    });

    proc.on('error', () => {
      clearTimeout(timer);
      finish({ originalCommand, command, rewritten: false, reason: 'spawn-error' });
    });

    proc.on('close', () => {
      clearTimeout(timer);
      const rewritten = stdout.trim();
      if (!rewritten) {
        finish({ originalCommand, command, rewritten: false, reason: 'no-rewrite' });
        return;
      }
      if (rewritten === trimmed) {
        finish({ originalCommand, command, rewritten: false, reason: 'unchanged' });
        return;
      }
      if (rewritten.includes('\n')) {
        finish({ originalCommand, command, rewritten: false, reason: 'multiline-rewrite' });
        return;
      }
      finish({ originalCommand, command: rewritten, rewritten: true });
    });
  });
}
