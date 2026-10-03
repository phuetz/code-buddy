import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ColabRunner, ColabInterruptedError, parseColabUsage, type ColabCli, type CliOptions, sanitizeColabOutput } from '../../src/compute/colab-runner.js';
import { ColabRunTool } from '../../src/tools/colab-run-tool.js';
import { COLAB_RUN_TOOL_DEF } from '../../src/codebuddy/colab-tool-defs.js';
import { createResearchTools } from '../../src/tools/registry/research-tools.js';
import { Command } from 'commander';
import { registerColabCommands } from '../../src/commands/cli/colab-command.js';
import allocationErrors from '../fixtures/colab/allocation-errors.json';

let root: string;
let calls: string[][];
let behavior: 'ok' | 'python-error' | 'wait' | 'new-error' | 'stop-error' | 'h100-refused';
let active: string | undefined;
let snapshots: string[];
let outputName: string;
let outputContent: string;
let usageRate: number;
let waitStarted: () => void;
let allocationError: string | undefined;
let cleanupMode: 'normal' | 'false-empty' | 'auth-stderr' | 'meter-fails' | 'meter-garbage';
const cli: ColabCli = vi.fn(async (args, options?: CliOptions) => {
  calls.push(args);
  let stdout = '', stderr = '';
  const stopping = calls.some(c => c[0] === 'stop');
  if (args[0] === 'usage' && stopping && cleanupMode === 'meter-fails') return { code: 1, stdout: '', stderr: 'OAuth authentication failed' };
  if (args[0] === 'usage' && stopping && cleanupMode === 'meter-garbage') return { code: 0, stdout: 'unreadable usage', stderr: '' };
  if (args[0] === 'usage') stdout = `Current balance: ${active ? '100.00' : calls.some(c => c[0] === 'new') ? '99.97' : '100.00'} compute units\nUsage rate: ${active ? usageRate : '0.00'}/hr\nActive assignments: ${active ? 1 : 0}`;
  if (args[0] === 'new') {
    if (allocationError && args.includes('H100')) return { code: 1, stdout: '', stderr: allocationError };
    if (behavior === 'new-error') return { code: 1, stdout: '', stderr: 'Allocation refused' };
    if (behavior === 'h100-refused' && args.includes('H100')) return { code: 1, stdout: '', stderr: 'Allocation refused' };
    active = args[2];
  }
  if (args[0] === 'sessions') stdout = active ? `[${active}] remote | Hardware: L4` : '[colab] No active sessions found on server.';
  if (args[0] === 'sessions' && cleanupMode === 'false-empty') stdout = '[colab] No active sessions found on server.';
  if (args[0] === 'sessions' && cleanupMode === 'auth-stderr') stderr = 'OAuth authentication failed';
  if (args[0] === 'stop') {
    if (behavior === 'stop-error') return { code: 1, stdout: '', stderr: 'network unavailable' };
    if (cleanupMode !== 'false-empty') active = undefined;
  }
  if (args[0] === 'upload') snapshots.push(await fs.readFile(args[3]!, 'utf8'));
  if (args[0] === 'exec' && options?.stdin?.includes('runpy.run_path')) {
    if (behavior === 'wait') {
      waitStarted();
      await new Promise((_, reject) => options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }
    stdout = behavior === 'python-error' ? '' : `42\n${options.stdin.match(/print\('(CB_SUCCESS_[^']+)'\)/)?.[1]}\n`;
  }
  if (args[0] === 'exec' && behavior === 'python-error' && options?.stdin?.includes('runpy.run_path')) stderr = `Traceback: RuntimeError intentional\n 6 ${options.stdin.split('\n').at(-1)}`;
  if (args[0] === 'exec' && options?.stdin?.includes('CB_FILES_')) {
    const marker = options.stdin.match(/print\('(CB_FILES_[^']+:)'/)?.[1];
    stdout = `${marker}${JSON.stringify([[outputName, outputContent.length]])}\n`;
  }
  if (args[0] === 'download') await fs.writeFile(args[4]!, outputContent);
  return { code: 0, stdout, stderr };
});
function runner() { return new ColabRunner({ cli, projectRoot: root, stateDir: path.join(root, 'state') }); }
async function ledger(): Promise<{ days: Record<string, { charged: number; measured: number }>; open: Record<string, { day: string; reserved: number }> }> {
  return JSON.parse(await fs.readFile(path.join(root, 'state/colab-units.json'), 'utf8'));
}

beforeEach(async () => {
  vi.stubEnv('CODEBUDDY_COLAB', 'true'); vi.stubEnv('CODEBUDDY_COLAB_MAX_UNITS_PER_DAY', '50');
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'colab-test-'));
  await fs.writeFile(path.join(root, 'job.py'), 'print(42)');
  usageRate = 4.82; calls = []; snapshots = []; active = undefined; behavior = 'ok'; outputName = 'result.txt'; outputContent = '42'; waitStarted = () => {}; allocationError = undefined; cleanupMode = 'normal';
});
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });

describe('Colab lifecycle and budget guards', () => {
  it('disabled: zero CLI calls, zero state writes, explicit refusal', async () => {
    vi.stubEnv('CODEBUDDY_COLAB', 'false');
    await expect(runner().run({ script: 'job.py' })).rejects.toThrow('disabled');
    await expect(runner().status()).rejects.toThrow('disabled');
    expect(calls).toEqual([]); expect(await fs.readdir(root)).toEqual(['job.py']);
    expect(createResearchTools().some(t => t.name === 'colab_run')).toBe(false);
  });
  it('runs, snapshots inputs, downloads verified files, destroys and measures', async () => {
    await fs.writeFile(path.join(root, 'input.txt'), 'hello');
    const result = await runner().run({ script: 'job.py', inputs: ['input.txt'], dependencies: ['numpy==2.2.6'], outputDir: 'results' });
    expect(result.stdout).toBe('42'); expect(snapshots).toEqual(['print(42)', 'hello']);
    expect(await fs.readFile(path.join(root, 'results/result.txt'), 'utf8')).toBe('42');
    expect(calls.find(c => c[0] === 'install')).toContain('numpy==2.2.6');
    expect(calls.filter(c => c[0] === 'new')[0]).toContain('L4');
    expect(calls.filter(c => c[0] === 'stop')).toHaveLength(1);
    expect(active).toBeUndefined(); expect((await ledger()).open).toEqual({});
    expect((await runner().status()).measured).toBeCloseTo(0.03);
  });
  it('Python exception with CLI exit zero is failure and destroys VM', async () => {
    behavior = 'python-error';
    await expect(runner().run({ script: 'job.py' })).rejects.toThrow('no completion marker');
    expect(calls.some(c => c[0] === 'stop')).toBe(true); expect(active).toBeUndefined();
  });
  it('whole-job deadline aborts exec and still destroys VM', async () => {
    behavior = 'wait';
    await expect(runner().run({ script: 'job.py', timeoutSeconds: 1 })).rejects.toThrow('aborted');
    expect(calls.some(c => c[0] === 'stop')).toBe(true); expect(active).toBeUndefined();
  });
  it('external cancellation waits for destruction', async () => {
    behavior = 'wait'; const controller = new AbortController(); waitStarted = () => controller.abort();
    // Abort asynchronously after the injected call installs its listener.
    waitStarted = () => setTimeout(() => controller.abort(), 0);
    await expect(runner().run({ script: 'job.py' }, controller.signal)).rejects.toThrow('aborted');
    expect(active).toBeUndefined(); expect((await ledger()).open).toEqual({});
  });
  it.each(['SIGINT', 'SIGTERM'] as const)('runner %s cancels, destroys and unregisters without changing host exitCode', async signal => {
    behavior = 'wait'; const prior = process.listeners(signal); const exitCode = process.exitCode;
    process.exitCode = 17;
    waitStarted = () => setTimeout(() => {
      for (const listener of process.listeners(signal).filter(l => !prior.includes(l))) listener(signal);
    }, 0);
    try {
      await expect(runner().run({ script: 'job.py' })).rejects.toMatchObject({ name: 'ColabInterruptedError', signal });
      expect(active).toBeUndefined(); expect(process.listeners(signal)).toEqual(prior);
      expect(process.exitCode).toBe(17); expect((await ledger()).open).toEqual({});
    }
    finally { process.exitCode = exitCode; }
  });
  it('cancellation during allocation waits for identity, then stops without uploading', async () => {
    const controller = new AbortController();
    let settled = false;
    const allocating: ColabCli = async (args, options) => {
      if (args[0] === 'new') {
        expect(options?.signal).toBeUndefined();
        controller.abort();
        await new Promise(resolve => setTimeout(resolve, 25));
        settled = true;
      }
      if (args[0] === 'stop') expect(settled).toBe(true);
      return cli(args, options);
    };
    await expect(new ColabRunner({ cli: allocating, projectRoot: root, stateDir: path.join(root, 'state') })
      .run({ script: 'job.py' }, controller.signal)).rejects.toThrow('interrupted');
    expect(calls.filter(c => c[0] === 'new')).toHaveLength(1);
    expect(calls.filter(c => c[0] === 'stop')).toHaveLength(1);
    expect(snapshots).toEqual([]); expect(active).toBeUndefined(); expect((await ledger()).open).toEqual({});
  });
  it('refuses daily ceiling before any CLI call', async () => {
    vi.stubEnv('CODEBUDDY_COLAB_MAX_UNITS_PER_DAY', '0.01');
    await expect(runner().run({ script: 'job.py' })).rejects.toThrow('daily unit ceiling');
    expect(calls).toEqual([]);
  });
  it('refuses jobs crossing UTC budget midnight', async () => {
    const timed = new ColabRunner({ cli, projectRoot: root, stateDir: path.join(root, 'state'), now: () => Date.parse('2026-10-03T23:59:50Z') });
    await expect(timed.run({ script: 'job.py' })).rejects.toThrow('UTC accounting midnight'); expect(calls).toEqual([]);
  });
  it('unexpected account rate stops the VM before uploads or computation', async () => {
    usageRate = 999;
    await expect(runner().run({ script: 'job.py' })).rejects.toThrow('rate exceeds'); expect(active).toBeUndefined(); expect(snapshots).toEqual([]);
  });
  it('persistent consumed units prevent a second allocation', async () => {
    await runner().run({ script: 'job.py' }); calls = [];
    vi.stubEnv('CODEBUDDY_COLAB_MAX_UNITS_PER_DAY', '0.03');
    await expect(runner().run({ script: 'job.py' })).rejects.toThrow('daily unit ceiling'); expect(calls).toEqual([]);
  });
  it('counter corruption fails closed and does not retain lock/listeners', async () => {
    await fs.mkdir(path.join(root, 'state')); await fs.writeFile(path.join(root, 'state/colab-units.json'), '{');
    const prior = process.listeners('SIGINT');
    await expect(runner().run({ script: 'job.py' })).rejects.toThrow('counter corrupt');
    expect(calls).toEqual([]); expect(process.listeners('SIGINT')).toEqual(prior);
    expect(await fs.readdir(path.join(root, 'state'))).toEqual(['colab-units.json']);
  });
  it('concurrent jobs cannot race daily reservations', async () => {
    behavior = 'wait'; let ready!: () => void; const started = new Promise<void>(r => { ready = r; }); waitStarted = ready;
    const controller = new AbortController(); const pending = runner().run({ script: 'job.py' }, controller.signal);
    await started;
    await expect(runner().run({ script: 'job.py' })).rejects.toThrow('counter locked');
    controller.abort(); await expect(pending).rejects.toThrow('aborted');
    expect(calls.filter(c => c[0] === 'new')).toHaveLength(1);
  });
  it('allocation refusal still runs finally destruction', async () => {
    behavior = 'new-error'; await expect(runner().run({ script: 'job.py' })).rejects.toThrow('Allocation refused');
    expect(calls.some(c => c[0] === 'stop')).toBe(true);
  });
  it('H100 refusal falls back to A100 only after cleanup', async () => {
    behavior = 'h100-refused'; expect((await runner().run({ script: 'job.py', gpu: 'H100' })).gpu).toBe('A100');
    expect(calls.filter(c => c[0] === 'new').map(c => c.at(-1))).toEqual(['H100', 'A100']); expect(active).toBeUndefined();
  });
  it.each(allocationErrors.errors.filter(e => e.status === 503))('H100 capacity 503 from public assign() $method falls back after cleanup', async ({ message, method, requests }) => {
    expect(requests.map(r => [r.method, r.status])).toEqual(method === 'GET' ? [['GET', 503]] : [['GET', 200], ['POST', 503]]);
    allocationError = message;
    expect((await runner().run({ script: 'job.py', gpu: 'H100' })).gpu).toBe('A100');
    expect(calls.filter(c => c[0] === 'new').map(c => c.at(-1))).toEqual(['H100', 'A100']);
    const first = calls.findIndex(c => c[0] === 'new');
    const second = calls.findIndex(c => c[0] === 'new' && c.includes('A100'));
    expect(calls.slice(first + 1, second).map(c => c[0])).toEqual(['stop', 'sessions', 'usage']);
    expect(calls.filter(c => c[0] === 'stop')).toHaveLength(2);
    expect(active).toBeUndefined(); expect((await ledger()).open).toEqual({});
  });
  it.each(allocationErrors.terminalErrors.filter(e => e.status === 503))('H100 capacity 503 from Typer stderr $method at $columns columns colored=$colored survives wrapping and truncation', async ({ method, stderr, code, colored }) => {
    expect(code).toBe(1); expect(stderr.length).toBeGreaterThan(2000);
    expect(stderr.includes('\u001b[')).toBe(colored);
    expect(stderr.replace(/\s+/g, ' ')).toContain(`request ${method}`);
    // This goes through call(), including its real stderr tail restriction.
    allocationError = stderr;
    expect((await runner().run({ script: 'job.py', gpu: 'H100' })).gpu).toBe('A100');
    expect(calls.filter(c => c[0] === 'new').map(c => c.at(-1))).toEqual(['H100', 'A100']);
    expect(active).toBeUndefined(); expect((await ledger()).open).toEqual({});
  });
  it.each(allocationErrors.terminalErrors.filter(e => e.status !== 503))('H100 does not fall back for Typer stderr $method $status at $columns columns colored=$colored', async ({ stderr, code, colored }) => {
    expect(code).toBe(1); expect(stderr.includes('\u001b[')).toBe(colored);
    allocationError = stderr;
    await expect(runner().run({ script: 'job.py', gpu: 'H100' })).rejects.toThrow('Colab new failed');
    expect(calls.filter(c => c[0] === 'new').map(c => c.at(-1))).toEqual(['H100']);
    expect(calls.filter(c => c[0] === 'stop')).toHaveLength(1);
    expect(active).toBeUndefined(); expect((await ledger()).open).toEqual({});
  });
  it.each(allocationErrors.errors.filter(e => e.status !== 503))('H100 does not fall back for public assign() $method error $status', async ({ message }) => {
    allocationError = message;
    await expect(runner().run({ script: 'job.py', gpu: 'H100' })).rejects.toThrow(message);
    expect(calls.filter(c => c[0] === 'new').map(c => c.at(-1))).toEqual(['H100']);
    expect(active).toBeUndefined();
  });
  it('H100 network timeout cannot trigger another allocation', async () => {
    allocationError = 'Colab CLI timeout';
    await expect(runner().run({ script: 'job.py', gpu: 'H100' })).rejects.toThrow('Colab CLI timeout');
    expect(calls.filter(c => c[0] === 'new').map(c => c.at(-1))).toEqual(['H100']);
  });
  it.each([
    'https://colab.research.google.com/tun/m/assignments?accelerator=H100',
    'https://colab.research.google.com.invalid/tun/m/assign?accelerator=H100',
    'https://oauth2.googleapis.com/token',
    'https://untrusted@colab.research.google.com/tun/m/assign',
    'not-a-url',
  ])('an unavailable non-allocation URL %s cannot trigger fallback', async url => {
    allocationError = `Failed to issue request GET ${url}: Service Unavailable`;
    await expect(runner().run({ script: 'job.py', gpu: 'H100' })).rejects.toThrow('Service Unavailable');
    expect(calls.filter(c => c[0] === 'new').map(c => c.at(-1))).toEqual(['H100']);
  });
  it('unrecognized DELETE or bare numeric 503 errors cannot trigger fallback', async () => {
    for (const message of [
      allocationErrors.errors[0]!.message.replace('request GET', 'request DELETE'),
      '503 Server Error: Service Unavailable',
    ]) {
      allocationError = message; calls = [];
      await expect(runner().run({ script: 'job.py', gpu: 'H100' })).rejects.toThrow(message);
      expect(calls.filter(c => c[0] === 'new').map(c => c.at(-1))).toEqual(['H100']);
    }
  });
  it('a 503 cannot start A100 when cleanup of the H100 attempt is unverified', async () => {
    allocationError = allocationErrors.errors[0]!.message; behavior = 'stop-error';
    await expect(runner().run({ script: 'job.py', gpu: 'H100' })).rejects.toThrow('cleanup unverified');
    expect(calls.filter(c => c[0] === 'new').map(c => c.at(-1))).toEqual(['H100']);
    expect(Object.keys((await ledger()).open)).toHaveLength(1);
  });
  it('cleanup failures are visible, retain the reservation and block another job', async () => {
    behavior = 'stop-error'; await expect(runner().run({ script: 'job.py' })).rejects.toThrow('cleanup unverified');
    expect(Object.keys((await ledger()).open)).toHaveLength(1);
    behavior = 'ok'; await expect(runner().run({ script: 'job.py' })).rejects.toThrow('Unclosed Colab reservation');
    await runner().stop(active!); expect(active).toBeUndefined();
  });
  it.each(['false-empty', 'auth-stderr', 'meter-fails', 'meter-garbage'] as const)('cleanup %s cannot release the reservation or claim closure', async mode => {
    cleanupMode = mode;
    await expect(runner().run({ script: 'job.py' })).rejects.toThrow('cleanup unverified');
    const retained = await ledger();
    expect(Object.keys(retained.open)).toHaveLength(1);
    expect(retained.days[Object.values(retained.open)[0]!.day].charged).toBe(Object.values(retained.open)[0]!.reserved);
    expect(calls.filter(c => c[0] === 'stop')).toHaveLength(3);
    cleanupMode = 'normal';
    const allocations = calls.filter(c => c[0] === 'new').length;
    await expect(runner().run({ script: 'job.py' })).rejects.toThrow('Unclosed Colab reservation');
    expect(calls.filter(c => c[0] === 'new')).toHaveLength(allocations);
    const session = Object.keys(retained.open)[0]!;
    await runner().stop(session); expect(active).toBeUndefined(); expect((await ledger()).open).toEqual({});
  });
});

describe('Colab transfer and integration guards', () => {
  it.each(['.env', 'token.json', 'key.pem', 'passwords.txt', '../outside.py'])('refuses classified path %s before CLI', async file => {
    await expect(runner().run({ script: 'job.py', inputs: [file] })).rejects.toThrow(/refuses|Invalid/); expect(calls).toEqual([]);
  });
  it('refuses secret content even with operator local-read override', async () => {
    vi.stubEnv('CODEBUDDY_ALLOW_SECRET_FILE_READ', 'true');
    await fs.writeFile(path.join(root, 'notes.txt'), 'ghp_' + 'a'.repeat(36));
    await expect(runner().run({ script: 'job.py', inputs: ['notes.txt'] })).rejects.toThrow('resembling a secret'); expect(calls).toEqual([]);
  });
  it('refuses symlink outside project and hard links', async () => {
    await fs.symlink(os.tmpdir(), path.join(root, 'external'));
    await expect(runner().run({ script: 'job.py', inputs: ['external/anything'] })).rejects.toThrow();
    await fs.link(path.join(root, 'job.py'), path.join(root, 'alias.py'));
    await expect(runner().run({ script: 'alias.py' })).rejects.toThrow('hard links'); expect(calls).toEqual([]);
  });
  it.each(['../escape.txt', '/absolute.txt', 'x/../../escape.txt', 'a\\..\\b'])('rejects output traversal %s and cleans VM', async name => {
    outputName = name; await expect(runner().run({ script: 'job.py' })).rejects.toThrow('Unsafe Colab output'); expect(active).toBeUndefined();
  });
  it('refuses existing deliverables and dependency URLs before allocation', async () => {
    await fs.mkdir(path.join(root, 'results'));
    await expect(runner().run({ script: 'job.py', outputDir: 'results' })).rejects.toThrow('already exists');
    await expect(runner().run({ script: 'job.py', dependencies: ['https://example.org/pkg'] })).rejects.toThrow(); expect(calls).toEqual([]);
  });
  it('refuses downloaded output containing secret material and cleans the VM', async () => {
    outputContent = 'ghp_' + 'b'.repeat(36);
    await expect(runner().run({ script: 'job.py' })).rejects.toThrow('secret content'); expect(active).toBeUndefined();
  });
  it('redacts runtime proxy query credentials in CLI errors', () => {
    expect(sanitizeColabOutput('https://host/api?colab-runtime-proxy-token=not-public&x=1')).toBe('https://host/api?colab-runtime-proxy-token=[REDACTED]&x=1');
  });
  it('requires confirmation and declares paid remote effects', () => {
    const tool = createResearchTools().find(t => t.name === 'colab_run');
    expect(tool?.getMetadata?.()).toMatchObject({ requiresConfirmation: true, effect: 'emission', fleetSafe: false });
    expect(new ColabRunTool().getSchema()).toEqual(COLAB_RUN_TOOL_DEF.function);
  });
  it('CLI routes arguments to the runner and status/explicit stop', async () => {
    const fake = { run: vi.fn().mockResolvedValue({ files: [] }), status: vi.fn().mockResolvedValue({ charged: 0 }), stop: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command(); registerColabCommands(program, fake as unknown as ColabRunner);
    await program.parseAsync(['colab', 'run', 'job.py', '--gpu', 'A100', '--in', 'a.txt', 'b.txt', '--out', 'results', '--timeout', '42'], { from: 'user' });
    expect(fake.run).toHaveBeenCalledWith(expect.objectContaining({ gpu: 'A100', inputs: ['a.txt', 'b.txt'], outputDir: 'results', timeoutSeconds: 42 }));
    await program.parseAsync(['colab', 'status'], { from: 'user' }); expect(fake.status).toHaveBeenCalled();
    await program.parseAsync(['colab', 'stop', 'cb-session'], { from: 'user' }); expect(fake.stop).toHaveBeenCalledWith('cb-session');
  });
  it.each([['SIGINT', 130], ['SIGTERM', 143]] as const)('CLI maps %s to exit %s after runner cleanup', async (signal, code) => {
    const exitCode = process.exitCode;
    const fake = { run: vi.fn().mockRejectedValue(new ColabInterruptedError(signal)) };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const program = new Command(); registerColabCommands(program, fake as unknown as ColabRunner);
    try {
      process.exitCode = undefined;
      await program.parseAsync(['colab', 'run', 'job.py'], { from: 'user' });
      expect(process.exitCode).toBe(code);
    } finally { process.exitCode = exitCode; }
  });
  it('unparseable metering is not interpreted as zero', () => { expect(() => parseColabUsage('not available')).toThrow('unreadable'); });
});
