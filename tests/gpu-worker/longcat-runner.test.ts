import { execFile, spawn } from 'child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { promisify } from 'util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const RUNNER = resolve('scripts/gpu-runners/longcat-runner.py');
const LOWMEM_UNIT = resolve('tests/gpu-worker/longcat-lowmem-unit.py');
const SETUP = resolve('scripts/gpu-runners/setup-longcat-env.sh');
const DARKSTAR_START = resolve('scripts/gpu-runners/start-darkstar-worker.ps1');
const created: string[] = [];

async function git(...args: string[]): Promise<string> {
  return (await execFileAsync('git', args)).stdout.trim();
}

async function sourceFixture(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), 'codebuddy-longcat-source-'));
  created.push(root);
  await mkdir(join(root, 'longcat_video'));
  await writeFile(join(root, 'longcat_video', '__init__.py'), '# fixture\n');
  await git('-C', root, 'init', '--quiet');
  await git('-C', root, 'config', 'user.email', 'tests@codebuddy.invalid');
  await git('-C', root, 'config', 'user.name', 'Code Buddy Tests');
  await git('-C', root, 'add', 'longcat_video');
  await git('-C', root, 'commit', '--quiet', '-m', 'fixture');
  return { root, head: await git('-C', root, 'rev-parse', 'HEAD') };
}

async function verifySource(root: string, head: string): Promise<void> {
  const code = [
    'import importlib.util, pathlib, sys',
    'spec = importlib.util.spec_from_file_location("longcat_runner", pathlib.Path(sys.argv[1]))',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'module.UPSTREAM_COMMIT = sys.argv[3]',
    'module.verify_upstream(pathlib.Path(sys.argv[2]))',
  ].join('\n');
  await execFileAsync('python3', ['-c', code, RUNNER, root, head]);
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('LongCat GPU runner hardening', () => {
  it('runs dependency-free checkpoint and layerwise INT8 unit tests', async () => {
    const { stderr } = await execFileAsync('python3', [LOWMEM_UNIT]);
    expect(stderr).toContain('OK');
  });

  it('pins the required runtime dependencies', async () => {
    const setup = await readFile(SETUP, 'utf8');
    expect(setup).toContain("'pyloudnorm==0.1.1'");
    expect(setup).toContain("'torchao==0.10.0'");
    expect(setup).toContain("'gcc_linux-64=11.2.0'");
    expect(setup).toContain("'gxx_linux-64=11.2.0'");
    expect(setup).toContain('quantize_(linear, int8_weight_only())');
  });

  it('keeps the Darkstar readiness gate aligned with runner version 2', async () => {
    const [runner, launcher] = await Promise.all([
      readFile(RUNNER, 'utf8'),
      readFile(DARKSTAR_START, 'utf8'),
    ]);
    expect(runner).toContain('RUNNER_VERSION = "2"');
    expect(launcher).toContain("$longcatReady.runnerVersion -ne '2'");
    expect(launcher).toContain('Get-NetIPAddress -IPAddress $BindHost');
    expect(launcher).toContain('[int]$BindWaitSeconds = 120');
  });

  it('accepts exactly the pinned clean source tree', async () => {
    const fixture = await sourceFixture();
    await expect(verifySource(fixture.root, fixture.head)).resolves.toBeUndefined();
    await expect(verifySource(fixture.root, '0'.repeat(40))).rejects.toMatchObject({
      stderr: expect.stringContaining('expected'),
    });
  });

  it('rejects tracked and untracked changes below longcat_video', async () => {
    const fixture = await sourceFixture();
    await writeFile(join(fixture.root, 'longcat_video', 'untracked.py'), 'unsafe = True\n');
    await expect(verifySource(fixture.root, fixture.head)).rejects.toMatchObject({
      stderr: expect.stringContaining('differs from the pinned commit'),
    });
    await rm(join(fixture.root, 'longcat_video', 'untracked.py'));
    await writeFile(join(fixture.root, 'longcat_video', '__init__.py'), '# changed\n');
    await expect(verifySource(fixture.root, fixture.head)).rejects.toMatchObject({
      stderr: expect.stringContaining('differs from the pinned commit'),
    });
  });

  it('forwards SIGTERM to the complete inference process group', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codebuddy-longcat-signal-'));
    created.push(root);
    const childPidPath = join(root, 'child.pid');
    const code = [
      'import importlib.util, pathlib, sys',
      'spec = importlib.util.spec_from_file_location("longcat_runner", pathlib.Path(sys.argv[1]))',
      'module = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(module)',
      'child = "import os, pathlib, sys, time; pathlib.Path(sys.argv[1]).write_text(str(os.getpid())); print(\\"READY\\", flush=True); time.sleep(60)"',
      'try:',
      '    module.stream_inference([sys.executable, "-c", child, sys.argv[2]], temperature_reader=lambda: 70)',
      'except module.RunnerError as error:',
      '    print(error, flush=True)',
      '    raise SystemExit(23)',
    ].join('\n');
    const process = spawn('python3', ['-c', code, RUNNER, childPidPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let signalSent = false;
    process.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (!signalSent && stdout.includes('READY')) {
        signalSent = true;
        process.kill('SIGTERM');
      }
    });
    process.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const exitCode = await new Promise<number | null>((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error(`signal test timed out: ${stdout}${stderr}`)), 8_000);
      process.once('error', reject);
      process.once('close', (codeValue) => {
        clearTimeout(timeout);
        resolvePromise(codeValue);
      });
    });
    expect(exitCode).toBe(23);
    expect(stdout).toContain('LongCat inference was cancelled');
    const childPid = Number((await readFile(childPidPath, 'utf8')).trim());
    expect(() => globalThis.process.kill(childPid, 0)).toThrow();
  });

  it('fails closed and kills inference after two over-temperature samples', async () => {
    const code = [
      'import importlib.util, pathlib, sys, time',
      'spec = importlib.util.spec_from_file_location("longcat_runner", pathlib.Path(sys.argv[1]))',
      'module = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(module)',
      'child = [sys.executable, "-c", "import time; time.sleep(60)"]',
      'temperatures = iter([70, 89, 89])',
      'try:',
      '    module.stream_inference(child, temperature_reader=lambda: next(temperatures), thermal_limit_c=88, thermal_poll_seconds=0.02)',
      'except module.RunnerError as error:',
      '    print(error, flush=True)',
      '    raise SystemExit(24)',
    ].join('\n');
    await expect(execFileAsync('python3', ['-c', code, RUNNER], { timeout: 3_000 })).rejects.toMatchObject({
      code: 24,
      stdout: expect.stringContaining('thermal guard stopped inference at 89 C'),
    });
  });
});
