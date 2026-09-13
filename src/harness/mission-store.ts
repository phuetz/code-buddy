/** Durable, single-host mission coordination. The store directory is operator-owned. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

export interface MissionAuthority { owner: string; generation: string }
export interface MissionHandoff {
  succeeded: string[]; failed: string[]; keyFiles: string[]; deadEnds: string[]; nextAction: string;
}
export interface MissionOperation { command: string; args: string[]; workspace: string; timeoutMs: number }
export interface Mission {
  schema: 1; id: string; revision: number; status: 'ready' | 'claimed' | 'running' | 'handoff' | 'completed';
  operation: MissionOperation; authority?: MissionAuthority; expiresAt?: number;
  handoff?: MissionHandoff; result?: { success: boolean; stdout: string; stderr: string; exitCode: number; truncated?: boolean };
  review?: { commit: string; author: string; reviewer?: string };
  acknowledgedBy?: string; updatedAt: number;
}

export class MissionBusyError extends Error {
  constructor() { super('Mission mutation locked; retry. An abandoned lock requires operator inspection.'); }
}

function bounded(value: unknown, label: string, max = 4096): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error(`Invalid ${label}`);
}
function validate(m: Mission): void {
  if (!m || m.schema !== 1 || !Number.isSafeInteger(m.revision) || m.revision < 0 || !['ready', 'claimed', 'running', 'handoff', 'completed'].includes(m.status)) throw new Error('Invalid mission record');
  bounded(m.id, 'mission id', 256);
  const op = m.operation;
  if (!op || !path.isAbsolute(op.workspace) || !Number.isInteger(op.timeoutMs) || op.timeoutMs < 100 || op.timeoutMs > 43200000) throw new Error('Invalid mission operation');
  bounded(op.command, 'command');
  if (Buffer.byteLength(JSON.stringify(op)) > 262144) throw new Error('Mission operation exceeds size limit');
  if (!Array.isArray(op.args) || op.args.length > 256 || op.args.some(a => typeof a !== 'string' || a.length > 65536 || a.includes('\0'))) throw new Error('Invalid operation arguments');
  if (!Number.isFinite(m.updatedAt)) throw new Error('Invalid update time');
  if (m.result && (typeof m.result.success !== 'boolean' || typeof m.result.stdout !== 'string' || typeof m.result.stderr !== 'string' || !Number.isInteger(m.result.exitCode) || m.result.stdout.length > 1000000 || m.result.stderr.length > 1000000 || (m.result.truncated !== undefined && typeof m.result.truncated !== 'boolean'))) throw new Error('Invalid mission result');
  if (m.review && (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(m.review.commit) || typeof m.review.author !== 'string' || (m.review.reviewer !== undefined && (typeof m.review.reviewer !== 'string' || m.review.reviewer === m.review.author)))) throw new Error('Invalid review');
  if (m.acknowledgedBy !== undefined && (m.status !== 'completed' || typeof m.acknowledgedBy !== 'string')) throw new Error('Invalid acknowledgement');
  if (m.result && m.status !== 'completed') throw new Error('Result on unfinished mission');
  if (m.handoff) validateHandoff(m.handoff);
  if (m.authority) { bounded(m.authority.owner, 'owner', 256); bounded(m.authority.generation, 'generation', 256); }
  if (['claimed', 'running'].includes(m.status) && (!m.authority || !Number.isFinite(m.expiresAt))) throw new Error('Invalid mission lease');
}

function validateHandoff(handoff: MissionHandoff): void {
  if (!handoff) throw new Error('Missing handoff');
  bounded(handoff.nextAction, 'next action');
  for (const entries of [handoff.succeeded, handoff.failed, handoff.keyFiles, handoff.deadEnds]) {
    if (!Array.isArray(entries) || entries.length > 32) throw new Error('Invalid handoff list');
    for (const entry of entries) bounded(entry, 'handoff item');
  }
}

export class MissionStore {
  constructor(readonly directory: string, private readonly now: () => number = Date.now) {}
  private file(id: string): string {
    bounded(id, 'mission id', 256);
    return path.join(this.directory, `${createHash('sha256').update(id).digest('hex')}.json`);
  }
  get(id: string): Mission {
    const file = this.file(id);
    if (!fs.lstatSync(file).isFile()) throw new Error('Mission must be a regular file');
    if (fs.statSync(file).size > 3_000_000) throw new Error('Mission record exceeds size limit');
    const m = JSON.parse(fs.readFileSync(file, 'utf8')) as Mission;
    validate(m);
    if (m.id !== id) throw new Error('Mission identity mismatch');
    return m;
  }
  /** Synchronous critical section, exclusive across processes; never steal a mutation lock. */
  private change(id: string, update: (m: Mission | undefined) => Mission): Mission {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = this.file(id);
    const lock = `${file}.lock`;
    let fd: number;
    try { fd = fs.openSync(lock, 'wx', 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new MissionBusyError(); throw error; }
    let temp: string | undefined;
    try {
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, createdAt: this.now() }));
      const current = fs.existsSync(file) ? this.get(id) : undefined;
      const next = update(current);
      next.revision = (current?.revision ?? -1) + 1;
      next.updatedAt = this.now();
      validate(next);
      const content = JSON.stringify(next);
      if (Buffer.byteLength(content) > 3_000_000) throw new Error('Mission record exceeds size limit');
      temp = `${file}.${randomUUID()}.tmp`;
      const out = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(out, content); fs.fsyncSync(out); } finally { fs.closeSync(out); }
      fs.renameSync(temp, file);
      if (process.platform !== 'win32') {
        const dir = fs.openSync(this.directory, 'r');
        try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
      }
      return next;
    } finally {
      if (temp && fs.existsSync(temp)) fs.unlinkSync(temp);
      fs.closeSync(fd); fs.unlinkSync(lock);
    }
  }
  create(id: string, operation: MissionOperation): Mission {
    return this.change(id, current => {
      if (current) throw new Error('Mission already exists');
      return { schema: 1, id, revision: 0, status: 'ready', operation, updatedAt: this.now() };
    });
  }
  claim(id: string, owner: string, leaseMs = 60000): Mission {
    bounded(owner, 'owner', 256); this.lease(leaseMs);
    return this.change(id, m => {
      if (!m) throw new Error('Unknown mission');
      if (m.status === 'completed') throw new Error('Mission already completed');
      if (m.status === 'running') throw new Error('Running mission requires reconciliation before retry');
      if (m.authority && (m.expiresAt ?? 0) > this.now()) throw new Error('Mission already claimed');
      delete m.review;
      m.authority = { owner, generation: randomUUID() }; m.expiresAt = this.now() + leaseMs; m.status = 'claimed';
      return m;
    });
  }
  private lease(ms: number): void { if (!Number.isInteger(ms) || ms < 1000 || ms > 3600000) throw new Error('Lease must be 1000..3600000 ms'); }
  private owned(m: Mission | undefined, a: MissionAuthority): asserts m is Mission {
    if (!m || m.authority?.owner !== a.owner || m.authority.generation !== a.generation || (m.expiresAt ?? 0) <= this.now()) throw new Error('Stale or expired mission authority');
  }
  renew(id: string, a: MissionAuthority, leaseMs = 60000): Mission {
    this.lease(leaseMs);
    return this.change(id, m => { this.owned(m, a); if (!['claimed', 'running'].includes(m.status)) throw new Error('Mission is not active'); m.expiresAt = this.now() + leaseMs; return m; });
  }
  start(id: string, a: MissionAuthority): Mission {
    return this.change(id, m => { this.owned(m, a); if (m.status !== 'claimed') throw new Error('Mission already started'); m.status = 'running'; delete m.review; return m; });
  }
  complete(id: string, a: MissionAuthority, result: NonNullable<Mission['result']>): Mission {
    return this.change(id, m => { this.owned(m, a); if (m.status !== 'running') throw new Error('Mission is not running'); m.result = { ...result, stdout: result.stdout.slice(0, 100000), stderr: result.stderr.slice(0, 100000), truncated: result.stdout.length > 100000 || result.stderr.length > 100000 };  m.status = 'completed'; delete m.expiresAt; return m; });
  }
  handoff(id: string, a: MissionAuthority, handoff: MissionHandoff): Mission {
    validateHandoff(handoff);
    return this.change(id, m => { this.owned(m, a); if (m.status !== 'claimed') throw new Error('Stop execution before handoff'); m.handoff = handoff; m.status = 'handoff'; delete m.review; delete m.authority; delete m.expiresAt; return m; });
  }
  /** Explicit operator reconciliation only; an ambiguous effect is never retried automatically. */
  reconcile(id: string, generation: string, resolution: 'retry' | 'completed', note: string): Mission {
    bounded(note, 'reconciliation evidence');
    if (!['retry', 'completed'].includes(resolution)) throw new Error('Invalid reconciliation resolution');
    return this.change(id, m => {
      if (!m || m.status !== 'running' || m.authority?.generation !== generation || (m.expiresAt ?? 0) > this.now()) throw new Error('Only expired running missions can be reconciled');
      m.handoff = { succeeded: [], failed: [], keyFiles: [], deadEnds: [], nextAction: note };
      m.status = resolution === 'retry' ? 'ready' : 'completed'; delete m.review; delete m.authority; delete m.expiresAt; return m;
    });
  }
  acknowledge(id: string, consumer: string): Mission {
    bounded(consumer, 'consumer', 256);
    return this.change(id, m => { if (!m || m.status !== 'completed') throw new Error('Mission is not completed'); m.acknowledgedBy = consumer; return m; });
  }
  submit(id: string, a: MissionAuthority, commit: string): Mission {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error('Expected full commit SHA');
    return this.change(id, m => { this.owned(m, a); if (m.status !== 'claimed') throw new Error('Review requires a claimed mission'); m.review = { commit, author: a.owner }; return m; });
  }
  approve(id: string, reviewer: string, expectedCommit: string): Mission {
    bounded(reviewer, 'reviewer', 256);
    return this.change(id, m => {
      if (!m || m.status !== 'claimed' || (m.expiresAt ?? 0) <= this.now()) throw new Error('Review requires active ownership');
      const actualCommit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: m.operation.workspace, encoding: 'utf8', timeout: 5000 }).trim();
      const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: m.operation.workspace, encoding: 'utf8', timeout: 5000 }).trim();
      if (dirty) throw new Error('Review requires a clean worktree');
      if (!m?.review || m.review.author === reviewer || m.review.commit !== expectedCommit || actualCommit !== expectedCommit) throw new Error('Review requires an independent reviewer and unchanged commit');
      m.review.reviewer = reviewer; return m;
    });
  }
}
