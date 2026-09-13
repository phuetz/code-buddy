import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { registerFleetMissionCommands } from '../../src/commands/cli/fleet-mission-commands.js';
import type { Mission, MissionListPage } from '../../src/harness/mission-store.js';

let root: string;
let workspace: string;
let directory: string;
let manifest: string;
let previousExitCode: typeof process.exitCode;
let logs: MockInstance<typeof console.log>;
let errors: MockInstance<typeof console.error>;

beforeEach(() => {
  previousExitCode = process.exitCode;
  process.exitCode = undefined;
  logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-mission-cli-'));
  workspace = path.join(root, 'workspace');
  directory = path.join(root, 'state');
  manifest = path.join(root, 'manifest.json');
  fs.mkdirSync(workspace);
  fs.writeFileSync(manifest, JSON.stringify({
    workspace: './workspace',
    operations: {
      success: {
        command: process.execPath,
        args: ['-e', 'require("node:fs").appendFileSync("effects.log", "once\\n"); process.stdout.write("done");'],
        timeoutMs: 5000,
      },
      failure: {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("partial"); process.stderr.write("fixture failure"); process.exitCode = 7;'],
        timeoutMs: 5000,
      },
    },
  }));
});

afterEach(() => {
  process.exitCode = previousExitCode;
  logs.mockRestore();
  errors.mockRestore();
  fs.rmSync(root, { recursive: true, force: true });
});

async function invoke<T = Mission>(...args: string[]) {
  // Each parse represents a new CLI invocation, with its own status and output.
  process.exitCode = undefined;
  logs.mockClear();
  errors.mockClear();
  const program = new Command().name('buddy').exitOverride();
  registerFleetMissionCommands(program.command('fleet'));
  await program.parseAsync(['fleet', 'mission', ...args], { from: 'user' });
  return {
    exitCode: process.exitCode,
    error: errors.mock.calls.map(call => call.join(' ')).join('\n'),
    mission: logs.mock.calls.length ? JSON.parse(String(logs.mock.calls[0][0])) as T : undefined,
  };
}

async function succeed(...args: string[]): Promise<Mission> {
  const response = await invoke(...args);
  expect(response.error).toBe('');
  expect(response.exitCode).toBeUndefined();
  expect(response.mission).toBeDefined();
  return response.mission!;
}

function git(...args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args], {
    cwd: workspace,
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'empty-gitconfig') },
  }).trim();
}

async function submittedMission(): Promise<Mission> {
  fs.writeFileSync(path.join(root, 'empty-gitconfig'), '');
  const template = path.join(root, 'git-template');
  fs.mkdirSync(template);
  git('init', '-q', `--template=${template}`);
  git('config', 'user.name', 'Mission CLI Fixture');
  git('config', 'user.email', 'fixture@example.test');
  fs.writeFileSync(path.join(workspace, 'tracked.txt'), 'initial\n');
  git('add', 'tracked.txt');
  git('commit', '-qm', 'fixture');
  await succeed('create', directory, 'review', manifest, 'success');
  const claimed = await succeed('claim', directory, 'review', 'author');
  return succeed('submit', directory, 'review', 'author', claimed.authority!.generation);
}

describe('fleet mission Commander commands', () => {
  it('lists an unknown store without creating it', async () => {
    const response = await invoke<MissionListPage>('list', directory);
    expect(response).toEqual({ exitCode: undefined, error: '', mission: { missions: [], errors: [] } });
    expect(fs.existsSync(directory)).toBe(false);
  });

  it('discovers completed and claimed missions without returning private fields', async () => {
    await succeed('create', directory, 'completed', manifest, 'success');
    const claim = await succeed('claim', directory, 'completed', 'pilot');
    await succeed('run', directory, 'completed', 'pilot', claim.authority!.generation);
    await succeed('create', directory, 'pending', manifest, 'failure');
    const pending = await succeed('claim', directory, 'pending', 'worker');
    const response = await invoke<MissionListPage>('list', directory);
    expect(response.exitCode).toBeUndefined();
    expect(response.error).toBe('');
    expect(response.mission?.missions).toHaveLength(2);
    expect(response.mission?.missions.find(m => m.id === 'completed')).toMatchObject({ status: 'completed', owner: 'pilot', success: true });
    expect(response.mission?.missions.find(m => m.id === 'pending')).toMatchObject({ status: 'claimed', owner: 'worker', leaseExpired: false });
    const output = JSON.stringify(response.mission);
    for (const privateValue of [workspace, process.execPath, claim.authority!.generation, pending.authority!.generation, 'effects.log', 'stdout', 'stderr', 'command', 'args', 'handoff']) {
      expect(output).not.toContain(privateValue);
    }
  });

  it('accepts pagination options and surfaces corrupt records without parser details', async () => {
    await succeed('create', directory, 'only', manifest, 'success');
    const validHash = createHash('sha256').update('only').digest('hex');
    const corruptHash = 'f'.repeat(64);
    fs.writeFileSync(path.join(directory, `${corruptHash}.json`), '{PRIVATE_CORRUPT_CONTENT');
    const first = await invoke<MissionListPage>('list', directory, '--limit', '1');
    expect(first.mission?.missions.map(m => m.id)).toEqual(['only']);
    expect(first.mission?.nextCursor).toBe(validHash);
    const second = await invoke<MissionListPage>('list', directory, '--limit', '1', '--cursor', first.mission!.nextCursor!);
    expect(second.exitCode).toBeUndefined();
    expect(second.mission).toEqual({ missions: [], errors: [{ file: `${corruptHash}.json`, error: 'Invalid or unreadable mission record' }] });
    expect(JSON.stringify(second)).not.toContain('PRIVATE_CORRUPT_CONTENT');
  });

  it.each([['--limit', '0'], ['--limit', '101'], ['--limit', 'invalid'], ['--cursor', '../outside']])(
    'rejects invalid listing option %s %s', async (option, value) => {
      const response = await invoke<MissionListPage>('list', directory, option, value);
      expect(response.exitCode).toBe(1);
      expect(response.mission).toBeUndefined();
      expect(response.error).toMatch(/limit|cursor/);
      expect(fs.existsSync(directory)).toBe(false);
    },
  );

  it('creates, claims, executes, reads and acknowledges a durable result exactly once', async () => {
    const created = await succeed('create', directory, 'job/a', manifest, 'success');
    expect(created).toMatchObject({ status: 'ready', operation: { workspace, command: process.execPath } });
    const claimed = await succeed('claim', directory, 'job/a', 'pilot');
    expect(claimed.authority?.owner).toBe('pilot');
    const listeners = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const completed = await succeed('run', directory, 'job/a', 'pilot', claimed.authority!.generation);
    expect(completed).toMatchObject({ status: 'completed', result: { success: true, stdout: 'done', stderr: '', exitCode: 0 } });
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(listeners);
    expect((await succeed('show', directory, 'job/a')).result).toEqual(completed.result);
    expect(await succeed('ack', directory, 'job/a', 'consumer')).toMatchObject({ acknowledgedBy: 'consumer', result: completed.result });
    expect((await succeed('show', directory, 'job/a')).acknowledgedBy).toBe('consumer');
    const repeat = await invoke('run', directory, 'job/a', 'pilot', claimed.authority!.generation);
    expect(repeat.exitCode).toBe(1);
    expect(repeat.mission).toBeUndefined();
    expect(fs.readFileSync(path.join(workspace, 'effects.log'), 'utf8')).toBe('once\n');
  });

  it('preserves a handoff for the next claimant and refuses the old owner before execution', async () => {
    await succeed('create', directory, 'handoff', manifest, 'success');
    const first = await succeed('claim', directory, 'handoff', 'first');
    const capsule = {
      succeeded: ['inspection'], failed: [], keyFiles: ['tracked.txt'], deadEnds: ['old approach'], nextAction: 'Run the fixed operation',
    };
    const capsulePath = path.join(root, 'capsule.json');
    fs.writeFileSync(capsulePath, JSON.stringify(capsule));
    const handoff = await succeed('handoff', directory, 'handoff', 'first', first.authority!.generation, capsulePath);
    expect(handoff.status).toBe('handoff');
    expect(handoff.authority).toBeUndefined();
    const second = await succeed('claim', directory, 'handoff', 'second');
    expect(second.handoff).toEqual(capsule);
    expect(second.authority!.generation).not.toBe(first.authority!.generation);
    for (const action of ['renew', 'run']) {
      const stale = await invoke(action, directory, 'handoff', 'first', first.authority!.generation);
      expect(stale.exitCode).toBe(1);
      expect(stale.error).toContain('Stale');
      expect(stale.mission).toBeUndefined();
    }
    expect(fs.existsSync(path.join(workspace, 'effects.log'))).toBe(false);
    expect((await succeed('show', directory, 'handoff')).authority).toEqual(second.authority);
    expect((await succeed('run', directory, 'handoff', 'second', second.authority!.generation)).result?.success).toBe(true);
  });

  it('returns a failing CLI status while persisting the child exit code and output', async () => {
    await succeed('create', directory, 'failed', manifest, 'failure');
    const claimed = await succeed('claim', directory, 'failed', 'pilot');
    const response = await invoke('run', directory, 'failed', 'pilot', claimed.authority!.generation);
    expect(response.exitCode).toBe(1);
    expect(response.error).toBe('');
    expect(response.mission).toMatchObject({
      status: 'completed', result: { success: false, exitCode: 7, stdout: 'partial', stderr: 'fixture failure' },
    });
    expect((await succeed('show', directory, 'failed')).result).toEqual(response.mission!.result);
  });

  it('accepts an independent exact-SHA review and rejects self-review or a changed HEAD', async () => {
    const submitted = await submittedMission();
    const sha = git('rev-parse', 'HEAD');
    expect(submitted.review).toEqual({ commit: sha, author: 'author' });
    const self = await invoke('approve', directory, 'review', 'author', sha);
    expect(self.exitCode).toBe(1);
    expect(self.error).toContain('independent reviewer');
    const approved = await succeed('approve', directory, 'review', 'reviewer', sha);
    expect(approved.review).toEqual({ commit: sha, author: 'author', reviewer: 'reviewer' });
    git('commit', '--allow-empty', '-qm', 'new head');
    expect(git('rev-parse', 'HEAD')).not.toBe(sha);
    const changed = await invoke('approve', directory, 'review', 'reviewer', sha);
    expect(changed.exitCode).toBe(1);
    expect(changed.error).toContain('unchanged commit');
    expect(changed.mission).toBeUndefined();
  });

  it.each(['tracked.txt', 'untracked.txt'])('rejects review with dirty workspace file %s', async filename => {
    const submitted = await submittedMission();
    fs.writeFileSync(path.join(workspace, filename), 'unreviewed change\n');
    const response = await invoke('approve', directory, 'review', 'reviewer', submitted.review!.commit);
    expect(response.exitCode).toBe(1);
    expect(response.error).toContain('clean worktree');
    expect(response.mission).toBeUndefined();
    expect((await succeed('show', directory, 'review')).review?.reviewer).toBeUndefined();
  });
});
