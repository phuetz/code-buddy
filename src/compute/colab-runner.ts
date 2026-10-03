import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';
import { z } from 'zod';
import { writeJsonAtomic } from '../utils/atomic-write.js';
import { classifySecretPath } from '../security/secret-files.js';
import { SECRET_PATTERNS } from '../security/secret-patterns.js';
import { scrubSecrets } from '../security/secret-scrubber.js';
import { getShutdownManager } from '../utils/graceful-shutdown.js';

export function sanitizeColabOutput(text: string): string {
  return scrubSecrets(text).replace(/(colab-runtime-proxy-token=)[^&\s"'<>]+/gi, '$1[REDACTED]');
}

export const isColabEnabled = () => process.env.CODEBUDDY_COLAB === 'true';
export type ColabGpu = 'L4' | 'A100' | 'H100';
export class ColabInterruptedError extends Error {
  constructor(public readonly signal: 'SIGINT' | 'SIGTERM') {
    super(`Colab interrupted by ${signal}`);
    this.name = 'ColabInterruptedError';
  }
}
export interface CliOptions { stdin?: string; signal?: AbortSignal; timeoutMs?: number }
export interface CliResult { code: number; stdout: string; stderr: string }
export type ColabCli = (args: string[], options?: CliOptions) => Promise<CliResult>;

/** No shell, no local credentials/environment forwarded to the remote kernel. */
export const invokeColab: ColabCli = (args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(path.join(os.homedir(), '.local/bin/colab'), ['--auth', 'oauth2', ...args], {
    stdio: ['pipe', 'pipe', 'pipe'], signal: options.signal,
  });
  let stdout = '', stderr = '', overflow = false;
  const capture = (target: 'stdout' | 'stderr', chunk: Buffer) => {
    if (stdout.length + stderr.length + chunk.length > 2 * 1024 * 1024) {
      overflow = true; child.kill('SIGKILL'); return;
    }
    if (target === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
  };
  child.stdout.on('data', chunk => capture('stdout', chunk));
  child.stderr.on('data', chunk => capture('stderr', chunk));
  let failure: Error | undefined;
  child.on('error', error => { failure = error; });
  const timer = setTimeout(() => { failure = new Error('Colab CLI timeout'); child.kill('SIGKILL'); }, options.timeoutMs ?? 60000);
  child.on('close', code => {
    clearTimeout(timer);
    if (failure || overflow) {
      const error = failure ?? new Error('Colab CLI output limit');
      error.message += `; output: ${sanitizeColabOutput(stdout + stderr).slice(-2000)}`;
      reject(error);
    }
    else resolve({ code: code ?? 1, stdout: sanitizeColabOutput(stdout), stderr: sanitizeColabOutput(stderr) });
  });
  child.stdin.on('error', () => { /* Child can close stdin on interruption. */ });
  child.stdin.end(options.stdin);
});

export const colabJobSchema = z.object({
  script: z.string().min(1), gpu: z.enum(['L4', 'A100', 'H100']).default('L4'),
  inputs: z.array(z.string().min(1)).max(32).default([]),
  dependencies: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*(?:==[a-zA-Z0-9_.+-]+)?$/)).max(32).default([]),
  outputDir: z.string().min(1).optional(),
  timeoutSeconds: z.number().finite().min(1).max(3600).default(600),
}).strict();
export type ColabJob = z.input<typeof colabJobSchema>;
export interface ColabJobResult { session: string; gpu: ColabGpu; outputDir: string; files: string[]; stdout: string; reservedUnits: number }
const ledgerSchema = z.object({
  days: z.record(z.string(), z.object({ charged: z.number().finite().nonnegative(), measured: z.number().finite().nonnegative() })),
  open: z.record(z.string(), z.object({ day: z.string(), reserved: z.number().finite().nonnegative() })),
}).strict();
type Ledger = z.infer<typeof ledgerSchema>;
// Conservative ceilings; verify the actual account rate after allocation.
const RATE: Record<ColabGpu, number> = { L4: 15, A100: 30, H100: 100 };
// Three stop/list/usage attempts (30+10+10s), plus final metering (10s).
const CLEANUP_MS = 160000;
const MAX_FILE = 64 * 1024 * 1024;
const MAX_OUTPUT = 256 * 1024 * 1024;

function inside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
function safeName(name: string): boolean {
  return !!name && !name.includes('\\') && !name.includes('\0') && !name.split('/').some(p => !p || p === '.' || p === '..') && !path.isAbsolute(name);
}
function secretName(name: string): boolean {
  return classifySecretPath(name).secret || /(^|[/\\])(?:\.git|\.ssh|\.aws|\.kube|colab-cli)([/\\]|$)/i.test(name)
    || /(?:secret|credential|token|password|auth)[^/\\]*\.(?:json|txt|csv|ya?ml|ini)$/i.test(name) || /\.(?:pem|key|pfx|p12)$/i.test(name);
}
function hasSecret(content: Buffer): boolean {
  const text = content.toString('utf8');
  return SECRET_PATTERNS.some(({ pattern }) => new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')).test(text));
}
function isAllocationCapacityFailure(error: unknown): boolean {
  const text = stripVTControlCharacters(String(error)).replace(/\s+/g, ' ');
  if (/Allocation refused|Backend rejected accelerator/i.test(text)) return true;
  // Typer may insert ANSI styling inside the URL and before its reason, even
  // on piped stderr when the parent forces color. Strip it before parsing.
  // assign() performs GET, then POST, with a parameterized URL. Typer can wrap
  // that URL mid-query; restore its whitespace before checking origin and path.
  // An unavailable auth/usage endpoint is not an allocation-capacity failure.
  for (const match of text.matchAll(/Failed to issue request (?:GET|POST) (.+?): Service Unavailable\b/gi)) {
    try {
      const url = new URL(match[1]!.replace(/\s/g, ''));
      if (url.origin === 'https://colab.research.google.com' && url.pathname === '/tun/m/assign'
        && !url.username && !url.password) return true;
    } catch { /* An unparseable request is not safe to retry with another VM. */ }
  }
  return false;
}
export function parseColabUsage(text: string): { balance: number; rate: number; assignments: number } {
  const balance = Number(text.match(/Current balance: ([\d.]+)/)?.[1]);
  const rate = Number(text.match(/Usage rate: ([\d.]+)\/hr/)?.[1]);
  const assignments = Number(text.match(/Active assignments: (\d+)/)?.[1]);
  if (![balance, rate, assignments].every(Number.isFinite)) throw new Error('Colab usage unreadable; allocation refused');
  return { balance, rate, assignments };
}

export class ColabRunner {
  private readonly stateFile: string;
  constructor(private readonly options: { cli?: ColabCli; stateDir?: string; projectRoot?: string; now?: () => number } = {}) {
    this.stateFile = path.join(options.stateDir ?? path.join(process.env.CODEBUDDY_HOME ?? path.join(os.homedir(), '.codebuddy'), 'compute'), 'colab-units.json');
  }
  private now() { return (this.options.now ?? Date.now)(); }
  private day() { return new Date(this.now()).toISOString().slice(0, 10); }
  private enabled() { if (!isColabEnabled()) throw new Error('Colab disabled: set CODEBUDDY_COLAB=true'); }
  private async call(args: string[], options?: CliOptions): Promise<string> {
    const result = await (this.options.cli ?? invokeColab)(args, options);
    // CLI sessions can swallow an OAuth SystemExit and falsely return an empty
    // list with exit zero. Never treat diagnostics on stderr as verified absence.
    if (result.code !== 0 || (args[0] === 'sessions' && result.stderr.trim())) throw new Error(`Colab ${args[0]} failed: ${scrubSecrets(result.stderr || result.stdout).slice(-2000)}`);
    return result.stdout + (args[0] === 'exec' ? result.stderr : '');
  }
  private async readLedger(): Promise<Ledger> {
    try { return ledgerSchema.parse(JSON.parse(await fs.readFile(this.stateFile, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { days: {}, open: {} };
      throw new Error('Colab unit counter corrupt or unreadable; allocation refused');
    }
  }
  private async lock(): Promise<() => Promise<void>> {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true, mode: 0o700 });
    const lock = `${this.stateFile}.lock`;
    try { await fs.mkdir(lock, { mode: 0o700 }); }
    catch { throw new Error('Colab counter locked: another job is running or recovery is required'); }
    return () => fs.rmdir(lock);
  }
  private limit() {
    const limit = Number(process.env.CODEBUDDY_COLAB_MAX_UNITS_PER_DAY ?? '50');
    if (!Number.isFinite(limit) || limit <= 0) throw new Error('Invalid CODEBUDDY_COLAB_MAX_UNITS_PER_DAY');
    return limit;
  }
  async status() {
    this.enabled();
    const ledger = await this.readLedger();
    const [sessions, usage] = await Promise.all([this.call(['sessions']), this.call(['usage'])]);
    return { day: this.day(), ...(ledger.days[this.day()] ?? { charged: 0, measured: 0 }),
      limit: this.limit(), reservations: ledger.open, sessions, account: parseColabUsage(usage) };
  }
  /** Explicit session name, never stops other users' sessions in bulk. */
  async stop(session: string) {
    this.enabled();
    if (!/^cb-[a-f0-9-]{36}$/.test(session)) throw new Error('Only Code Buddy cb- sessions can be closed');
    const release = await this.lock();
    try {
      await this.destroy(session);
      const ledger = await this.readLedger();
      // A recovered reservation stays charged conservatively.
      delete ledger.open[session];
      await writeJsonAtomic(this.stateFile, ledger);
    } finally { await release(); }
  }
  private async destroy(session: string): Promise<void> {
    let failure: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.call(['stop', '-s', session], { timeoutMs: 30000 });
        const sessions = await this.call(['sessions'], { timeoutMs: 10000 });
        // usage does not swallow failed authentication when fetching assignments.
        // Require an independent authenticated empty backend as well as sessions.
        const usage = parseColabUsage(await this.call(['usage'], { timeoutMs: 10000 }));
        if (!sessions.includes(`[${session}]`) && !/^\[\?\]/m.test(sessions) && usage.assignments === 0) return;
        throw new Error('Session remains active or an untracked assignment exists');
      } catch (error) { failure = error; }
    }
    throw new Error(`Colab cleanup unverified for ${session}; use buddy colab stop ${session}: ${String(failure)}`);
  }
  private async snapshot(file: string, root: string): Promise<Buffer> {
    const lexical = path.resolve(root, file);
    if (!inside(root, lexical) || secretName(lexical)) throw new Error('Colab refuses secret files or files outside the project');
    const canonical = await fs.realpath(lexical);
    if (!inside(root, canonical) || secretName(canonical)) throw new Error('Colab refuses secret files or links outside the project');
    const before = await fs.lstat(canonical);
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_FILE) throw new Error('Colab input must be a regular file without hard links, ≤64 MiB');
    // O_NONBLOCK also prevents a FIFO swapped in between lstat and open from
    // hanging before the job timer. Revalidate the descriptor and its identity.
    const handle = await fs.open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE || stat.dev !== before.dev || stat.ino !== before.ino) throw new Error('Colab input must be the checked regular file without hard links, ≤64 MiB');
      const content = await handle.readFile();
      if (content.length > MAX_FILE || hasSecret(content)) throw new Error('Colab refuses content resembling a secret');
      return content;
    } finally { await handle.close(); }
  }
  async run(input: ColabJob, externalSignal?: AbortSignal) {
    this.enabled();
    const job = colabJobSchema.parse(input);
    if (!job.script.endsWith('.py')) throw new Error('Colab requires a Python .py script');
    const root = await fs.realpath(this.options.projectRoot ?? process.cwd());
    const files = [{ name: 'job.py', content: await this.snapshot(job.script, root) }];
    for (const file of job.inputs) {
      const name = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
      if (!safeName(name)) throw new Error('Invalid Colab input path');
      files.push({ name: `inputs/${name}`, content: await this.snapshot(file, root) });
    }
    const out = path.resolve(root, job.outputDir ?? `colab-output-${randomUUID()}`);
    if (!inside(root, out) || secretName(out)) throw new Error('Colab output must be inside the project');
    // Require a new directory; never overwrite previous deliverables.
    try { await fs.lstat(out); throw new Error('Colab output directory already exists'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let ancestor = path.dirname(out);
    while (true) {
      try { if (!inside(root, await fs.realpath(ancestor))) throw new Error('Colab output symlink outside project'); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; ancestor = path.dirname(ancestor); }
    }
    const release = await this.lock();
    let temp: string | undefined;
    const controller = new AbortController();
    const interrupt = () => controller.abort(new Error('Colab interrupted'));
    const sigint = () => controller.abort(new ColabInterruptedError('SIGINT'));
    const sigterm = () => controller.abort(new ColabInterruptedError('SIGTERM'));
    const timer = setTimeout(() => controller.abort(new Error('Colab job deadline exceeded')), job.timeoutSeconds * 1000);
    process.on('SIGINT', sigint); process.on('SIGTERM', sigterm);
    externalSignal?.addEventListener('abort', interrupt, { once: true });
    if (externalSignal?.aborted) interrupt();
    const ledger = await this.readLedger().catch(async error => { clearTimeout(timer); process.off('SIGINT', sigint); process.off('SIGTERM', sigterm); externalSignal?.removeEventListener('abort', interrupt); await release(); throw error; });
    // Servers already have global signal handlers. Cooperate with their shutdown
    // rather than letting process.exit race allocation identity and finally.
    const shutdown = getShutdownManager();
    const shutdownName = `colab-cleanup-${randomUUID()}`;
    let settled!: () => void;
    const settlement = new Promise<void>(resolve => { settled = resolve; });
    shutdown.registerHandler({
      name: shutdownName, priority: 2000, timeoutMs: CLEANUP_MS + 120000 + 20000,
      handler: async () => { interrupt(); await settlement; },
    });
    const day = this.day();
    const record = ledger.days[day] ??= { charged: 0, measured: 0 };
    const reserved = Math.ceil((job.timeoutSeconds * 1000 + CLEANUP_MS + 120000) / 3600000 * RATE[job.gpu] * 100) / 100 + 0.02;
    let session: string | undefined, before: number | undefined, started = this.now(), cleanupError: unknown;
    let allocatedGpu = job.gpu;
    let result: ColabJobResult | undefined;
    let jobError: unknown;
    const call = (args: string[], stdin?: string) => {
      controller.signal.throwIfAborted();
      return this.call(args, { stdin, signal: controller.signal, timeoutMs: job.timeoutSeconds * 1000 });
    };
    try {
      if (new Date(this.now() + job.timeoutSeconds * 1000 + CLEANUP_MS + 120000).toISOString().slice(0, 10) !== day) throw new Error('Colab job would cross UTC accounting midnight; reduce deadline or retry tomorrow');
      if (record.charged + reserved > this.limit()) throw new Error(`Colab daily unit ceiling exceeded (${record.charged.toFixed(2)} + ${reserved.toFixed(2)} > ${this.limit()}); job refused`);
      if (Object.keys(ledger.open).length) throw new Error('Unclosed Colab reservation; close the recorded session before another job');
      before = parseColabUsage(await call(['usage'])).balance;
      session = `cb-${randomUUID()}`;
      record.charged += reserved;
      ledger.open[session] = { day, reserved };
      await writeJsonAtomic(this.stateFile, ledger);
      temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-colab-'));
      started = this.now();
      // Do not abort allocation mid-request: let the CLI persist the VM identity,
      // then honor cancellation. Still bounded, and finally always attempts stop.
      try { await this.call(['new', '-s', session, '--gpu', job.gpu], { timeoutMs: 120000 }); }
      catch (error) {
        if (job.gpu !== 'H100' || !isAllocationCapacityFailure(error)) throw error;
        await this.destroy(session);
        controller.signal.throwIfAborted();
        await this.call(['new', '-s', session, '--gpu', 'A100'], { timeoutMs: 120000 });
        allocatedGpu = 'A100';
      }
      const usage = parseColabUsage(await call(['usage']));
      if (usage.rate > RATE[job.gpu]) throw new Error('Colab rate exceeds reserved ceiling; stopping VM');
      const base = '/content/codebuddy-job';
      const dirs = [...new Set(files.map(f => path.posix.dirname(f.name)))];
      await call(['exec', '-s', session, '--timeout', '60'], `import os\nfor d in ${JSON.stringify(dirs)}:\n os.makedirs(${JSON.stringify(base)} + '/' + d, exist_ok=True)\nos.makedirs('${base}/inputs', exist_ok=True)\nos.makedirs('${base}/outputs', exist_ok=True)`);
      for (const [i, file] of files.entries()) {
        const snapshot = path.join(temp, String(i));
        await fs.writeFile(snapshot, file.content, { mode: 0o600 });
        await call(['upload', '-s', session, snapshot, `${base}/${file.name}`]);
      }
      if (job.dependencies.length) await call(['install', '-s', session, ...job.dependencies]);
      const marker = `CB_SUCCESS_${randomUUID().replaceAll('-', '')}`;
      const stdout = await call(['exec', '-s', session, '--timeout', String(job.timeoutSeconds)],
        `import os, runpy\nos.chdir('${base}')\nos.environ['CODEBUDDY_COLAB_INPUT_DIR']='${base}/inputs'\nos.environ['CODEBUDDY_COLAB_OUTPUT_DIR']='${base}/outputs'\nrunpy.run_path('${base}/job.py', run_name='__main__')\nprint('${marker}')`);
      if (!stdout.split(/\r?\n/).some(line => line.trim() === marker)) throw new Error(`Colab Python job failed (no completion marker): ${stdout.slice(-2000)}`);
      const manifest = `CB_FILES_${randomUUID().replaceAll('-', '')}:`;
      const listing = await call(['exec', '-s', session, '--timeout', '60'],
        `import os, json\nfiles=[]\nfor d, dirs, names in os.walk('${base}/outputs', followlinks=False):\n for n in names:\n  p=os.path.join(d,n)\n  if os.path.islink(p) or not os.path.isfile(p): raise ValueError('Unsafe output')\n  files.append([os.path.relpath(p,'${base}/outputs'),os.path.getsize(p)])\nprint('${manifest}'+json.dumps(files))`);
      const line = listing.split(/\r?\n/).find(l => l.startsWith(manifest));
      if (!line) throw new Error('Colab output manifest missing');
      const entries = z.array(z.tuple([z.string(), z.number().int().nonnegative().max(MAX_FILE)])).max(128).parse(JSON.parse(line.slice(manifest.length)));
      if (new Set(entries.map(e => e[0])).size !== entries.length || entries.some(([name]) => !safeName(name) || secretName(name)) || entries.reduce((n, e) => n + e[1], 0) > MAX_OUTPUT) throw new Error('Unsafe Colab output manifest');
      for (const [i, [name, size]] of entries.entries()) {
        const local = path.join(temp, `out-${i}`);
        await call(['download', '-s', session, `${base}/outputs/${name}`, local]);
        const data = await fs.readFile(local);
        if (data.length !== size || hasSecret(data)) throw new Error('Colab output size mismatch or secret content');
      }
      await fs.mkdir(path.dirname(out), { recursive: true });
      if (!inside(root, await fs.realpath(path.dirname(out)))) throw new Error('Output parent changed outside project');
      await fs.mkdir(out, { mode: 0o700 });
      for (const [i, [name]] of entries.entries()) {
        const destination = path.join(out, name);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(path.join(temp, `out-${i}`), destination, constants.COPYFILE_EXCL);
      }
      controller.signal.throwIfAborted();
      result = { session, gpu: allocatedGpu, outputDir: out, files: entries.map(e => e[0]), stdout: stdout.replace(marker, '').trim(), reservedUnits: reserved };
    } catch (error) {
      jobError = error;
    } finally {
      clearTimeout(timer);
      if (session) {
        try { await this.destroy(session); }
        catch (error) { cleanupError = error; }
        if (!cleanupError) {
          let charge = reserved;
          try {
            const after = parseColabUsage(await this.call(['usage'], { timeoutMs: 10000 })).balance;
            const measured = Math.max(0, (before ?? after) - after);
            record.measured += measured;
            // Balance is rounded to 0.01; conservative time charge covers lag.
            charge = Math.max(measured + 0.02, (this.now() - started) / 3600000 * RATE[job.gpu] + 0.02);
          } catch { /* Retain the full reservation when metering is unavailable. */ }
          record.charged = Math.max(0, record.charged - reserved + charge);
          delete ledger.open[session];
        }
        await writeJsonAtomic(this.stateFile, ledger).catch(error => { cleanupError ??= error; });
      }
      externalSignal?.removeEventListener('abort', interrupt);
      process.off('SIGINT', sigint); process.off('SIGTERM', sigterm);
      try { if (temp) await fs.rm(temp, { recursive: true, force: true }); }
      finally {
        try { await release(); }
        finally {
          // During shutdown the manager is iterating its handlers. Leave this
          // settled barrier in place until disposal so later handlers are kept.
          if (!shutdown.isInShutdown()) shutdown.unregisterHandler(shutdownName);
          settled();
        }
      }
    }
    if (cleanupError) throw cleanupError;
    // Preserve the typed process interruption even if spawn reports AbortError.
    // Exit policy belongs to the CLI, not to this reusable runner/server library.
    if (controller.signal.reason instanceof ColabInterruptedError) throw controller.signal.reason;
    if (jobError) throw jobError;
    if (!result) throw new Error('Colab job returned no result');
    return result;
  }
}
