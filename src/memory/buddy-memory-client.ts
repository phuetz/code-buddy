/**
 * buddy-memory client — a long-running sidecar bridge to the Rust CKG engine
 * (github.com/phuetz/buddy-memory). Spawns `buddy-memory serve --ledger <path>` once and talks
 * newline-delimited JSON-RPC over stdio (request `{id,method,params}` → response `{id,result|error}`),
 * mirroring the buddy-sense sidecar pattern.
 *
 * NEVER-THROWS at the boundary: if the binary is missing or the engine dies, `available()` goes
 * false and callers fall back to the in-process TypeScript CKG. The engine shares the SAME ledger
 * file as the TS implementation, so switching engines is seamless and cross-process-safe.
 *
 * @module memory/buddy-memory-client
 */

import { spawn, type ChildProcessByStdio } from 'child_process';
import type { Readable, Writable } from 'stream';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { createInterface, type Interface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { scanForSecrets, redactSecrets } from '../fleet/privacy-lint.js';

/** Methods whose `text` field must be secret-redacted before reaching the engine store. */
const WRITE_METHODS = new Set(['remember', 'ingest', 'ingestPublication']);

/** Repo root derived from this module (<root>/src/memory or <root>/dist/memory → <root>). */
function repoRoot(): string {
  try {
    return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  } catch {
    return process.cwd();
  }
}

function resolveBin(): string | null {
  const env = process.env.CODEBUDDY_BUDDY_MEMORY_BIN;
  if (env && existsSync(env)) return env;
  // Prefer the in-tree sidecar (like buddy-sense); fall back to a standalone ~/DEV checkout.
  const roots = [
    join(repoRoot(), 'buddy-memory', 'target'),
    join(process.cwd(), 'buddy-memory', 'target'),
    join(homedir(), 'DEV', 'buddy-memory', 'target'),
  ];
  for (const root of roots) {
    for (const sub of ['release', 'debug']) {
      const p = join(root, sub, 'buddy-memory');
      if (existsSync(p)) return p;
    }
  }
  return 'buddy-memory'; // PATH; spawn error → unavailable (graceful)
}

export interface BuddyMemoryClientOptions {
  ledgerPath: string;
  agentId?: string;
  callTimeoutMs?: number;
}

export class BuddyMemoryClient {
  private readonly ledgerPath: string;
  private readonly agentId: string | undefined;
  private readonly callTimeoutMs: number;
  private child: ChildProcessByStdio<Writable, Readable, null> | null = null;
  private rl: Interface | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private dead = false;

  constructor(options: BuddyMemoryClientOptions) {
    this.ledgerPath = options.ledgerPath;
    this.agentId = options.agentId;
    this.callTimeoutMs = options.callTimeoutMs ?? 15_000;
  }

  /** True once the engine process is spawned and alive. Lazily spawns on first check. */
  available(): boolean {
    if (this.dead) return false;
    if (!this.child) this.ensureSpawned();
    return !this.dead && this.child !== null;
  }

  private ensureSpawned(): void {
    if (this.child || this.dead) return;
    const bin = resolveBin();
    if (!bin) {
      this.dead = true;
      return;
    }
    const args = ['serve', '--ledger', this.ledgerPath];
    if (this.agentId) args.push('--agent', this.agentId);
    try {
      this.child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (err) {
      logger.debug(`[buddy-memory] spawn failed: ${msg(err)}`);
      this.dead = true;
      return;
    }
    this.child.on('error', (err) => {
      logger.debug(`[buddy-memory] process error: ${msg(err)}`);
      this.fail();
    });
    this.child.on('exit', () => this.fail());
    this.rl = createInterface({ input: this.child.stdout });
    this.rl.on('line', (line) => this.onLine(line));
  }

  private fail(): void {
    this.dead = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('buddy-memory engine unavailable'));
    }
    this.pending.clear();
    try {
      this.rl?.close();
    } catch {
      /* ignore */
    }
    this.child = null;
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let resp: { id?: number; result?: unknown; error?: string };
    try {
      resp = JSON.parse(trimmed);
    } catch {
      return; // ignore non-JSON noise
    }
    if (typeof resp.id !== 'number') return;
    const p = this.pending.get(resp.id);
    if (!p) return;
    this.pending.delete(resp.id);
    clearTimeout(p.timer);
    if (resp.error) p.reject(new Error(resp.error));
    else p.resolve(resp.result);
  }

  /** Send a JSON-RPC request. Rejects on timeout / engine death. Redacts secrets on write methods. */
  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.available() || !this.child) throw new Error('buddy-memory engine unavailable');
    const safe = WRITE_METHODS.has(method) ? this.redactParams(params) : params;
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`buddy-memory ${method} timed out`));
      }, this.callTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child!.stdin.write(`${JSON.stringify({ id, method, params: safe })}\n`);
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private redactParams(params: Record<string, unknown>): Record<string, unknown> {
    const out = { ...params };
    for (const key of ['text', 'abstract', 'title']) {
      const v = out[key];
      if (typeof v === 'string' && scanForSecrets(v).hasSecrets) out[key] = redactSecrets(v);
    }
    return out;
  }

  /** Stop the engine (test seam / shutdown). */
  close(): void {
    const child = this.child;
    this.fail();
    try {
      if (child && !child.stdin.destroyed) child.stdin.end();
    } catch {
      /* ignore */
    }
    try {
      child?.kill();
    } catch {
      /* ignore */
    }
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
