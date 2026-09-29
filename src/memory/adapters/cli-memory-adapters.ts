import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { MemoryProvider, MemoryRememberOptions } from '../memory-provider.js';
import { LocalMemoryProvider } from '../local-memory-provider.js';
import type { Memory } from '../persistent-memory.js';
import { logger } from '../../utils/logger.js';
import { getCodeBuddyPath } from '../../utils/codebuddy-home.js';

/**
 * CLI-backed memory providers (Hermes parity).
 *
 * ByteRover (formerly Cipher) is a local-first memory layer driven entirely by
 * the `brv` CLI. The upstream Hermes plugin shells out to `brv`; this adapter
 * does the same — a thin subprocess pipe, no re-implementation. It is honest
 * because the boundary really is the CLI: install `brv`, point Code Buddy at it,
 * and `remember`/`recall` become `brv curate`/`brv query`.
 *
 * Exact argv mirrors NousResearch/hermes-agent plugins/memory/byterover:
 *   query  -> brv query  -- "<text>"
 *   curate -> brv curate -- "<content>"
 *   status -> brv status
 */

const QUERY_TIMEOUT_MS = 30_000;
const CURATE_TIMEOUT_MS = 60_000;

interface BrvResult {
  success: boolean;
  output: string;
  error?: string;
}

/** Resolve the `brv` binary on PATH or well-known install locations. */
export function resolveBrvPath(): string | null {
  const envOverride = process.env.BYTEROVER_CLI_PATH?.trim();
  if (envOverride && fs.existsSync(envOverride)) return envOverride;

  const home = os.homedir();
  const names = process.platform === 'win32' ? ['brv.cmd', 'brv.exe', 'brv'] : ['brv'];
  const dirs = [
    path.join(home, '.brv-cli', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    '/usr/local/bin',
    path.join(home, 'AppData', 'Roaming', 'npm'),
  ];
  // PATH lookup first.
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of [...pathDirs, ...dirs]) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

/** Quote an argument for a Windows `cmd.exe` command line, neutralising
 *  expansion/newline metacharacters in untrusted memory content. Only wraps
 *  when needed so simple tokens stay bare (batch %1 comparisons rely on it). */
function quoteWinArg(value: string): string {
  const cleaned = value.replace(/[\r\n%]/g, ' ');
  if (cleaned === '') return '""';
  if (/[\s"&|<>^()]/.test(cleaned)) {
    return `"${cleaned.replace(/"/g, '""')}"`;
  }
  return cleaned;
}

function runBrv(brvPath: string, args: string[], timeoutMs: number, cwd: string): Promise<BrvResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    // Node refuses to spawn .cmd/.bat with shell:false (CVE-2024-27980). npm's
    // global `brv` on Windows is a `.cmd` shim, so route batch shims through the
    // shell with each argument explicitly quoted/sanitised.
    const isWinBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(brvPath);
    const child = isWinBatch
      ? spawn([brvPath, ...args].map(quoteWinArg).join(' '), { cwd, shell: true, windowsHide: true })
      : spawn(brvPath, args, { cwd, shell: false, windowsHide: true });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ success: false, output: '', error: `brv timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout?.on('data', (d) => (stdout += String(d)));
    child.stderr?.on('data', (d) => (stderr += String(d)));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ success: false, output: '', error: err.message });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const out = stdout.trim();
      const errp = stderr.trim();
      if (code === 0) resolve({ success: true, output: out });
      else resolve({ success: false, output: out, error: errp || out || `brv exited ${code}` });
    });
  });
}

export class ByteRoverMemoryProvider implements MemoryProvider {
  readonly id = 'byterover';
  private fallback: LocalMemoryProvider;
  private brvPath: string | null;
  private cwd: string;

  constructor(options: { brvPath?: string; cwd?: string } = {}) {
    this.brvPath = options.brvPath ?? resolveBrvPath();
    this.cwd = options.cwd ?? getCodeBuddyPath('byterover');
    this.fallback = new LocalMemoryProvider();
  }

  /** Available only when the brv CLI is actually installed. */
  isAvailable(): boolean {
    return this.brvPath !== null;
  }

  async initialize(): Promise<void> {
    await this.fallback.initialize();
    if (this.brvPath) {
      try {
        fs.mkdirSync(this.cwd, { recursive: true });
      } catch {
        /* ignore */
      }
      logger.info(`ByteRoverMemoryProvider: brv at ${this.brvPath}.`);
    } else {
      logger.info('ByteRoverMemoryProvider: brv CLI not found, using local fallback. Install: npm install -g byterover-cli');
    }
  }

  async remember(key: string, value: string, options?: MemoryRememberOptions): Promise<void> {
    if (!this.brvPath) return this.fallback.remember(key, value, options);
    const content = `${key}: ${value}`.slice(0, 5000);
    const res = await runBrv(this.brvPath, ['curate', '--', content], CURATE_TIMEOUT_MS, this.cwd);
    if (!res.success) {
      logger.warn('ByteRoverMemoryProvider: curate failed, falling back to local', { error: res.error });
      await this.fallback.remember(key, value, options);
    }
  }

  private async query(query: string): Promise<string> {
    if (!this.brvPath) return '';
    const res = await runBrv(this.brvPath, ['query', '--', query.trim().slice(0, 5000)], QUERY_TIMEOUT_MS, this.cwd);
    return res.success ? res.output : '';
  }

  async recall(key: string, scope?: 'project' | 'user'): Promise<string | null> {
    if (!this.brvPath) return this.fallback.recall(key, scope);
    const out = await this.query(key);
    return out || this.fallback.recall(key, scope);
  }

  async getRelevantMemories(query: string, limit = 5): Promise<Memory[]> {
    if (!this.brvPath) return this.fallback.getRelevantMemories(query, limit);
    const out = await this.query(query);
    if (!out) return [];
    return [
      {
        key: query,
        value: out.slice(0, 8000),
        category: 'context',
        createdAt: new Date(),
        updatedAt: new Date(),
        accessCount: 1,
      },
    ];
  }

  async getContextForPrompt(): Promise<string> {
    if (!this.brvPath) return this.fallback.getContextForPrompt();
    return this.query('working preferences and project conventions');
  }
}
