import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const ledgerScript = path.join(repositoryRoot, 'scripts', 'lane-ledger.sh');
const delegateScript = path.join(repositoryRoot, 'scripts', 'deleguer.sh');
const mergeScript = path.join(repositoryRoot, 'scripts', 'fusionner-lane.sh');
const scratchParent = path.join(repositoryRoot, 'test-scripts');

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(
  script: string,
  args: string[],
  env: Record<string, string | undefined> = {}
): CommandResult {
  const childEnv = { ...process.env, ...env };
  for (const [name, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[name];
  }
  const result = spawnSync(script, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: childEnv,
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function initRepository(root: string): Promise<string> {
  await fs.mkdir(root, { recursive: true });
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'Fleet Test']);
  git(root, ['config', 'user.email', 'fleet-test@example.invalid']);
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ private: true, scripts: { typecheck: 'node -e "process.exit(0)"' } })
  );
  await fs.writeFile(path.join(root, 'base.txt'), 'base\n');
  git(root, ['add', 'package.json', 'base.txt']);
  git(root, ['commit', '-m', 'test: initial state']);
  return git(root, ['rev-parse', 'HEAD']);
}

interface LaneFixture {
  baseHead: string;
  source: string;
  sourceHead: string;
  target: string;
}

async function createLaneFixture(root: string, withTest = false): Promise<LaneFixture> {
  const target = path.join(root, 'target');
  const baseHead = await initRepository(target);
  const source = path.join(root, 'source');
  git(root, ['clone', target, source]);
  git(source, ['config', 'user.name', 'Fleet Test']);
  git(source, ['config', 'user.email', 'fleet-test@example.invalid']);
  git(source, ['checkout', '-b', 'feature/lane']);
  await fs.writeFile(path.join(source, 'feature.txt'), 'lane change\n');
  await fs.writeFile(path.join(source, 'MISSION.md'), '# Synthetic mission\n');
  await fs.writeFile(path.join(source, 'REPARATION-LANE.md'), '# Synthetic report\n');
  const files = ['feature.txt', 'MISSION.md', 'REPARATION-LANE.md'];
  if (withTest) {
    await fs.mkdir(path.join(source, 'tests', 'scripts'), { recursive: true });
    await fs.writeFile(
      path.join(source, 'tests', 'scripts', 'sample.test.ts'),
      "import { expect, it } from 'vitest';\nit('passes', () => expect(true).toBe(true));\n"
    );
    files.push('tests/scripts/sample.test.ts');
  }
  git(source, ['add', ...files]);
  git(source, ['commit', '-m', 'feat: synthetic lane']);
  return { baseHead, source, sourceHead: git(source, ['rev-parse', 'HEAD']), target };
}

async function appendDelegation(
  ledgerDir: string,
  fixture: LaneFixture,
  branch = 'feature/lane'
): Promise<CommandResult> {
  const report = await fs.readFile(path.join(fixture.source, 'REPARATION-LANE.md'));
  const mission = await fs.readFile(path.join(fixture.source, 'MISSION.md'));
  return run(
    ledgerScript,
    [
      'append',
      'delegation',
      '--engine',
      'test-engine',
      '--lane',
      'synthetic-lane',
      '--repository',
      fixture.source,
      '--branch',
      branch,
      '--head-before',
      fixture.baseHead,
      '--head-after',
      fixture.sourceHead,
      '--exit-code',
      '0',
      '--report',
      'REPARATION-LANE.md',
      '--report-sha256',
      sha256(report),
      '--mission-sha256',
      sha256(mission),
      '--json',
    ],
    { CODEBUDDY_DELEGATIONS_DIR: ledgerDir }
  );
}

let scratchRoot: string;

beforeEach(async () => {
  await fs.mkdir(scratchParent, { recursive: true });
  scratchRoot = await fs.mkdtemp(path.join(scratchParent, 'lane-ledger-'));
});

afterEach(async () => {
  await fs.rm(scratchRoot, { recursive: true, force: true });
});

describe('lane ledger', () => {
  it('appends canonical signed entries and verifies the hash chain', async () => {
    const ledgerDir = path.join(scratchRoot, 'delegations');
    const fixture = await createLaneFixture(scratchRoot);
    const first = await appendDelegation(ledgerDir, fixture);
    expect(first.status).toBe(0);
    expect(first.stderr).toBe('');
    expect(JSON.parse(first.stdout)).toMatchObject({ ok: true, line: 1 });

    const second = run(
      ledgerScript,
      [
        'append',
        'approval',
        '--approved-by',
        'reviewer',
        '--repository',
        fixture.source,
        '--target-repository',
        fixture.target,
        '--branch',
        'feature/lane',
        '--head',
        fixture.sourceHead,
        '--tests-command',
        'npm run typecheck',
        '--tests-result',
        'passed',
        '--tests-exit-code',
        '0',
        '--json',
      ],
      { CODEBUDDY_DELEGATIONS_DIR: ledgerDir }
    );
    expect(second.status).toBe(0);

    const rawLines = (await fs.readFile(path.join(ledgerDir, 'ledger.jsonl'), 'utf8'))
      .trimEnd()
      .split('\n');
    const entries = rawLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rawLines).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      type: 'delegation',
      engine: 'test-engine',
      lane: 'synthetic-lane',
      branch: 'feature/lane',
      exit_code: 0,
    });
    expect(entries[1]).toMatchObject({
      type: 'approval',
      signer: 'approval',
      approved_by: 'reviewer',
      tests_result: 'passed',
    });
    expect(entries[1]?.prev_hash).toBe(sha256(rawLines[0] ?? ''));
    expect(JSON.stringify(entries[0])).toBe(rawLines[0]);
    expect(JSON.stringify(entries[1])).toBe(rawLines[1]);
    expect(rawLines.join('\n')).not.toContain('PRIVATE KEY');

    for (const keyName of ['test-engine.key', 'test-engine.pub', 'approval.key', 'approval.pub']) {
      const keyStat = await fs.stat(path.join(ledgerDir, 'keys', keyName));
      expect(keyStat.mode & 0o777).toBe(0o600);
    }

    const verifyHuman = run(ledgerScript, ['verify'], {
      CODEBUDDY_DELEGATIONS_DIR: ledgerDir,
    });
    expect(verifyHuman.status).toBe(0);
    expect(verifyHuman.stdout).toContain('Chaîne intacte (2 entrées)');

    const listed = run(ledgerScript, ['list', '--json'], {
      CODEBUDDY_DELEGATIONS_DIR: ledgerDir,
    });
    expect(listed.status).toBe(0);
    expect(listed.stderr).toBe('');
    expect(JSON.parse(listed.stdout)).toMatchObject({ ok: true, count: 2 });
    expect(JSON.parse(listed.stdout).entries).toHaveLength(2);
  });

  it('reports the exact broken line with structured JSON', async () => {
    const ledgerDir = path.join(scratchRoot, 'delegations');
    const fixture = await createLaneFixture(scratchRoot);
    expect((await appendDelegation(ledgerDir, fixture)).status).toBe(0);
    const ledgerPath = path.join(ledgerDir, 'ledger.jsonl');
    const entry = JSON.parse((await fs.readFile(ledgerPath, 'utf8')).trim()) as Record<
      string,
      unknown
    >;
    entry.lane = 'tampered';
    await fs.writeFile(ledgerPath, `${JSON.stringify(entry)}\n`);

    const verified = run(ledgerScript, ['verify', '--json'], {
      CODEBUDDY_DELEGATIONS_DIR: ledgerDir,
    });
    expect(verified.status).toBe(3);
    expect(verified.stdout).toBe('');
    expect(JSON.parse(verified.stderr)).toMatchObject({
      ok: false,
      error: 'chain_broken',
      line: 1,
      exit_code: 3,
    });

    const human = run(ledgerScript, ['verify'], {
      CODEBUDDY_DELEGATIONS_DIR: ledgerDir,
    });
    expect(human.status).toBe(3);
    expect(human.stderr).toContain('Chaîne cassée à la ligne 1');
  });

  it('rejects an altered Ed25519 signature', async () => {
    const ledgerDir = path.join(scratchRoot, 'delegations');
    const fixture = await createLaneFixture(scratchRoot);
    expect((await appendDelegation(ledgerDir, fixture)).status).toBe(0);
    const ledgerPath = path.join(ledgerDir, 'ledger.jsonl');
    const entry = JSON.parse((await fs.readFile(ledgerPath, 'utf8')).trim()) as Record<
      string,
      unknown
    >;
    const signature = entry.signature as string;
    entry.signature = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
    await fs.writeFile(ledgerPath, `${JSON.stringify(entry)}\n`);

    const verified = run(ledgerScript, ['verify', '--json'], {
      CODEBUDDY_DELEGATIONS_DIR: ledgerDir,
    });
    expect(verified.status).toBe(3);
    expect(JSON.parse(verified.stderr)).toMatchObject({
      error: 'chain_broken',
      line: 1,
    });
  });
});

describe('deleguer.sh ledger opt-in', () => {
  async function prepareDelegation(): Promise<{
    bin: string;
    ledgerDir: string;
    mission: string;
    repository: string;
    tmpDir: string;
  }> {
    const repository = path.join(scratchRoot, 'delegated-repository');
    await initRepository(repository);
    const mission = path.join(scratchRoot, 'MISSION-DEMO.md');
    await fs.writeFile(mission, '# Produce REPARATION-DEMO.md\n');
    const bin = path.join(scratchRoot, 'bin');
    await fs.mkdir(bin);
    const fakeOllama = path.join(bin, 'ollama');
    await fs.writeFile(
      fakeOllama,
      "#!/usr/bin/env bash\nprintf '# Synthetic report\\n' > REPARATION-DEMO.md\nexit 0\n"
    );
    await fs.chmod(fakeOllama, 0o700);
    const tmpDir = path.join(scratchRoot, 'tmp');
    await fs.mkdir(tmpDir);
    return {
      bin,
      ledgerDir: path.join(scratchRoot, 'delegations'),
      mission,
      repository,
      tmpDir,
    };
  }

  it('keeps the default behavior ledger-free', async () => {
    const fixture = await prepareDelegation();
    const result = run(delegateScript, [fixture.repository, fixture.mission, 'local'], {
      CODEBUDDY_DELEGATIONS_DIR: fixture.ledgerDir,
      CODEBUDDY_LANE_LEDGER: undefined,
      HOME: scratchRoot,
      PATH: `${fixture.bin}:${process.env.PATH ?? ''}`,
      TMPDIR: fixture.tmpDir,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('journal de lane');
    await expect(fs.stat(path.join(fixture.ledgerDir, 'ledger.jsonl'))).rejects.toThrow();
  });

  it('records the completed lane only when CODEBUDDY_LANE_LEDGER=1', async () => {
    const fixture = await prepareDelegation();
    const before = git(fixture.repository, ['rev-parse', 'HEAD']);
    const result = run(delegateScript, [fixture.repository, fixture.mission, 'local'], {
      CODEBUDDY_DELEGATIONS_DIR: fixture.ledgerDir,
      CODEBUDDY_LANE_LEDGER: '1',
      HOME: scratchRoot,
      PATH: `${fixture.bin}:${process.env.PATH ?? ''}`,
      TMPDIR: fixture.tmpDir,
    });
    expect(result.status).toBe(0);
    const listed = run(ledgerScript, ['list', '--json'], {
      CODEBUDDY_DELEGATIONS_DIR: fixture.ledgerDir,
    });
    const body = JSON.parse(listed.stdout) as {
      entries: Array<Record<string, unknown>>;
    };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      type: 'delegation',
      lane: 'MISSION-DEMO',
      repository: fixture.repository,
      branch: 'main',
      head_before: before,
      head_after: before,
      engine: 'local',
      exit_code: 0,
      report: 'REPARATION-DEMO.md',
    });
    expect(body.entries[0]?.report_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(body.entries[0]?.mission_sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('fusionner-lane.sh approval gate', () => {
  it('runs typecheck and a supplied test command, records approval, then fast-forwards', async () => {
    const ledgerDir = path.join(scratchRoot, 'delegations');
    const fixture = await createLaneFixture(scratchRoot);
    expect((await appendDelegation(ledgerDir, fixture)).status).toBe(0);

    const result = run(
      mergeScript,
      [
        fixture.source,
        'feature/lane',
        fixture.target,
        '--approuve-par',
        'reviewer',
        '--tests',
        'node -e "process.exit(0)"',
        '--json',
      ],
      { CODEBUDDY_DELEGATIONS_DIR: ledgerDir }
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      mode: 'ff-only',
      branch: 'feature/lane',
      head: fixture.sourceHead,
    });
    expect(git(fixture.target, ['rev-parse', 'HEAD'])).toBe(fixture.sourceHead);

    const listed = run(ledgerScript, ['list', '--json'], {
      CODEBUDDY_DELEGATIONS_DIR: ledgerDir,
    });
    const entries = (JSON.parse(listed.stdout) as { entries: Array<Record<string, unknown>> })
      .entries;
    expect(entries.at(-1)).toMatchObject({
      type: 'approval',
      approved_by: 'reviewer',
      tests_result: 'passed',
      tests_exit_code: 0,
      head: fixture.sourceHead,
    });
  });

  it('detects touched test files when --tests is omitted', async () => {
    const ledgerDir = path.join(scratchRoot, 'delegations');
    const fixture = await createLaneFixture(scratchRoot, true);
    expect((await appendDelegation(ledgerDir, fixture)).status).toBe(0);
    const bin = path.join(scratchRoot, 'bin');
    const invocationLog = path.join(scratchRoot, 'npx-args.txt');
    await fs.mkdir(bin);
    await fs.writeFile(
      path.join(bin, 'npx'),
      '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" > "$FAKE_NPX_LOG"\n'
    );
    await fs.chmod(path.join(bin, 'npx'), 0o700);

    const result = run(
      mergeScript,
      [
        fixture.source,
        'feature/lane',
        fixture.target,
        '--approuve-par',
        'reviewer',
        '--json',
      ],
      {
        CODEBUDDY_DELEGATIONS_DIR: ledgerDir,
        FAKE_NPX_LOG: invocationLog,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
      }
    );
    expect(result.status).toBe(0);
    expect(await fs.readFile(invocationLog, 'utf8')).toContain(
      'vitest run tests/scripts/sample.test.ts'
    );
  });

  it('refuses a branch without a matching verified successful lane entry', async () => {
    const ledgerDir = path.join(scratchRoot, 'delegations');
    const fixture = await createLaneFixture(scratchRoot);
    expect((await appendDelegation(ledgerDir, fixture, 'feature/other')).status).toBe(0);

    const result = run(
      mergeScript,
      [
        fixture.source,
        'feature/lane',
        fixture.target,
        '--approuve-par',
        'reviewer',
        '--tests',
        'node -e "process.exit(0)"',
        '--json',
      ],
      { CODEBUDDY_DELEGATIONS_DIR: ledgerDir }
    );
    expect(result.status).toBe(3);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      error: 'ledger_entry_missing',
      exit_code: 3,
    });
    expect(git(fixture.target, ['rev-parse', 'HEAD'])).toBe(fixture.baseHead);
  });

  it('records failed tests and refuses to merge', async () => {
    const ledgerDir = path.join(scratchRoot, 'delegations');
    const fixture = await createLaneFixture(scratchRoot);
    expect((await appendDelegation(ledgerDir, fixture)).status).toBe(0);

    const result = run(
      mergeScript,
      [
        fixture.source,
        'feature/lane',
        fixture.target,
        '--approuve-par',
        'reviewer',
        '--tests',
        'node -e "process.exit(7)"',
        '--json',
      ],
      { CODEBUDDY_DELEGATIONS_DIR: ledgerDir }
    );
    expect(result.status).toBe(4);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      error: 'tests_failed',
      exit_code: 4,
    });
    expect(git(fixture.target, ['rev-parse', 'HEAD'])).toBe(fixture.baseHead);

    const listed = run(ledgerScript, ['list', '--json'], {
      CODEBUDDY_DELEGATIONS_DIR: ledgerDir,
    });
    const entries = (JSON.parse(listed.stdout) as { entries: Array<Record<string, unknown>> })
      .entries;
    expect(entries.at(-1)).toMatchObject({
      type: 'approval',
      tests_result: 'failed',
      tests_exit_code: 7,
    });
  });

  it('requires --merge for divergent histories', async () => {
    const ledgerDir = path.join(scratchRoot, 'delegations');
    const fixture = await createLaneFixture(scratchRoot);
    await fs.writeFile(path.join(fixture.target, 'target.txt'), 'target change\n');
    git(fixture.target, ['add', 'target.txt']);
    git(fixture.target, ['commit', '-m', 'feat: target divergence']);
    expect((await appendDelegation(ledgerDir, fixture)).status).toBe(0);
    const commonArgs = [
      fixture.source,
      'feature/lane',
      fixture.target,
      '--approuve-par',
      'reviewer',
      '--tests',
      'node -e "process.exit(0)"',
      '--json',
    ];

    const refused = run(mergeScript, commonArgs, {
      CODEBUDDY_DELEGATIONS_DIR: ledgerDir,
    });
    expect(refused.status).toBe(5);
    expect(JSON.parse(refused.stderr)).toMatchObject({
      ok: false,
      error: 'merge_failed',
      exit_code: 5,
    });

    const merged = run(mergeScript, [...commonArgs.slice(0, -1), '--merge', '--json'], {
      CODEBUDDY_DELEGATIONS_DIR: ledgerDir,
    });
    expect(merged.status).toBe(0);
    expect(JSON.parse(merged.stdout)).toMatchObject({ ok: true, mode: 'merge' });
    expect(git(fixture.target, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ')).toHaveLength(
      3
    );
  });
});
