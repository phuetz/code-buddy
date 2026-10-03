import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColabRunner, type ColabCli } from '../../src/compute/colab-runner.js';

let root: string;
let wall: number;
let monotonic: number;
let calls: string[];
let duringJob: () => void;
const cli: ColabCli = async (args, options) => {
  calls.push(args[0]!);
  let stdout = '';
  if (args[0] === 'usage') stdout = 'Current balance: 100.00 compute units\nUsage rate: 0.00/hr\nActive assignments: 0';
  if (args[0] === 'sessions') stdout = '[colab] No active sessions found on server.';
  if (args[0] === 'exec' && options?.stdin?.includes('runpy.run_path')) {
    duringJob();
    stdout = options.stdin.match(/print\('(CB_SUCCESS_[^']+)'\)/)![1]!;
  }
  if (args[0] === 'exec' && options?.stdin?.includes('CB_FILES_')) {
    stdout = options.stdin.match(/print\('(CB_FILES_[^']+:)'/)![1]! + '[]';
  }
  return { code: 0, stdout, stderr: '' };
};
function runner() {
  const options = { cli, projectRoot: root, stateDir: path.join(root, 'state'), now: () => wall, monotonicNow: () => monotonic };
  return new ColabRunner(options);
}
async function state() {
  return JSON.parse(await fs.readFile(path.join(root, 'state/colab-units.json'), 'utf8')) as {
    days: Record<string, { charged: number; measured: number }>;
    open: Record<string, unknown>;
  };
}
beforeEach(async () => {
  vi.stubEnv('CODEBUDDY_COLAB', 'true');
  vi.stubEnv('CODEBUDDY_COLAB_MAX_UNITS_PER_DAY', '50');
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'colab-review-'));
  await fs.writeFile(path.join(root, 'job.py'), 'print(42)');
  wall = Date.parse('2026-10-03T12:00:00Z'); monotonic = 100000; calls = []; duringJob = () => {};
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });

describe('Colab independent review regressions (injected CLI only)', () => {
  it('advancing the local date cannot open a fresh quota in another runner', async () => {
    await runner().run({ script: 'job.py' });
    const before = await state(); calls = [];
    vi.stubEnv('CODEBUDDY_COLAB_MAX_UNITS_PER_DAY', '3.70');
    wall += 86400000;
    await expect(runner().run({ script: 'job.py' })).rejects.toThrow(/clock|daily unit ceiling/);
    expect(calls).toEqual([]); expect(await state()).toEqual(before);
    await expect(runner().status()).rejects.toThrow('clock');
  });
  it('lagging balance and a small wall-clock rollback cannot refund elapsed compute', async () => {
    duringJob = () => { wall -= 1000; monotonic += 120000; };
    await runner().run({ script: 'job.py' });
    const ledger = await state();
    expect(ledger.days['2026-10-03']!.charged).toBeCloseTo(0.52);
    expect(ledger.days['2026-10-03']!.measured).toBe(0);
    expect(ledger.open).toEqual({}); expect(calls.filter(c => c === 'stop')).toHaveLength(1);
  });
  it('a large wall-clock rollback during execution closes the VM and keeps the full reservation', async () => {
    let reserved = 0;
    const checkingCli: ColabCli = async (args, options) => {
      if (args[0] === 'new') reserved = (await state()).days['2026-10-03']!.charged;
      return cli(args, options);
    };
    duringJob = () => { wall -= 3600000; monotonic += 120000; };
    await expect(new ColabRunner({ cli: checkingCli, projectRoot: root, stateDir: path.join(root, 'state'), now: () => wall })
      .run({ script: 'job.py' })).rejects.toThrow('clock');
    expect((await state()).days['2026-10-03']!.charged).toBe(reserved);
    expect((await state()).open).toEqual({}); expect(calls.filter(c => c === 'stop')).toHaveLength(1);
  });
  it('a genuine monotonic day transition allows the next daily budget', async () => {
    await runner().run({ script: 'job.py' });
    wall += 86400000; monotonic += 86400000;
    vi.stubEnv('CODEBUDDY_COLAB_MAX_UNITS_PER_DAY', '3.70');
    await runner().run({ script: 'job.py' });
    expect((await state()).days).toEqual({
      '2026-10-03': { charged: expect.closeTo(0.02), measured: 0 },
      '2026-10-04': { charged: expect.closeTo(0.02), measured: 0 },
    });
    expect(calls.filter(c => c === 'new')).toHaveLength(2);
  });
  it('small forward corrections near midnight cannot change the accounting day', async () => {
    wall = Date.parse('2026-10-03T23:50:00Z');
    await runner().run({ script: 'job.py', timeoutSeconds: 1 }); calls = [];
    wall += 601000; monotonic += 599000;
    await expect(runner().run({ script: 'job.py', timeoutSeconds: 1 })).rejects.toThrow('UTC accounting midnight');
    expect(calls).toEqual([]);
  });
  it('a monotonic reset fails closed without discarding consumed units or retaining the lock', async () => {
    await runner().run({ script: 'job.py' }); const before = await state(); calls = [];
    monotonic = 1;
    await expect(runner().run({ script: 'job.py' })).rejects.toThrow('clock');
    expect(calls).toEqual([]); expect(await state()).toEqual(before);
    expect(await fs.readdir(path.join(root, 'state'))).toEqual(['colab-units.json']);
  });
  it('a legacy ledger carries prior charges even when the local date was advanced', async () => {
    await fs.mkdir(path.join(root, 'state'));
    await fs.writeFile(path.join(root, 'state/colab-units.json'), JSON.stringify({ days: { '2026-10-02': { charged: 50, measured: 20 } }, open: {} }));
    await expect(runner().run({ script: 'job.py' })).rejects.toThrow('daily unit ceiling');
    expect(calls).toEqual([]); expect((await state()).days['2026-10-03']).toEqual({ charged: 50, measured: 20 });
  });
  it('credential assignments in the Python script also fail before any CLI call', async () => {
    await fs.writeFile(path.join(root, 'job.py'), 'dbPassword = "a"\nprint(42)');
    await expect(runner().run({ script: 'job.py' })).rejects.toThrow('resembling a secret');
    expect(calls).toEqual([]);
  });
  it('ordinary configuration data remains transferable', async () => {
    await fs.writeFile(path.join(root, 'config.txt'), '{"batchSize":4,"seed":42}');
    await runner().run({ script: 'job.py', inputs: ['config.txt'] });
    expect(calls.filter(c => c === 'upload')).toHaveLength(2);
  });
  it.each([
    'DB_PASS=1234', 'export DB_PASS=1234', 'password = "a"', 'db.password: 7',
    '{"apiKey":"x"}', '{"host":"db","DB_PASS":"1234"}', "client_secret='s'", 'ACCESS_TOKEN: t', 'AUTHORIZATION=Bearer x',
  ])('refuses a renamed configuration containing %s before any CLI call', async content => {
    await fs.writeFile(path.join(root, 'config.txt'), content);
    await expect(runner().run({ script: 'job.py', inputs: ['config.txt'] })).rejects.toThrow('resembling a secret');
    expect(calls).toEqual([]); expect(await fs.readdir(root)).toEqual(['config.txt', 'job.py']);
  });
});
