import { it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { MissionStore } from '../../src/harness/mission-store.js';
import { runMission } from '../../src/harness/mission-runner.js';

let root: string;
let now: number;
let store: MissionStore;
const op = () => ({ command: process.execPath, args: ['-e', 'process.stdout.write("done")'], workspace: root, timeoutMs: 1000 });
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-missions-')); now = 10000; store = new MissionStore(path.join(root, 'state'), () => now); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
it('fences expired owners across store instances and preserves a compact handoff', () => {
  store.create('job/a', op());
  const first = store.claim('job/a', 'codex', 1000).authority!;
  expect(() => store.claim('job/a', 'fable')).toThrow('already claimed');
  now += 1001;
  const next = new MissionStore(store.directory, () => now).claim('job/a', 'fable').authority!;
  expect(() => store.start('job/a', first)).toThrow('Stale');
  const capsule = { succeeded: ['tests'], failed: [], keyFiles: ['a.ts'], deadEnds: ['old approach'], nextAction: 'Review commit' };
  store.handoff('job/a', next, capsule);
  expect(store.claim('job/a', 'codex').handoff).toEqual(capsule);
});
it('never retries an expired running operation implicitly', () => {
  store.create('job', op()); const a = store.claim('job', 'codex', 1000).authority!;
  store.start('job', a); now += 1001;
  expect(() => store.claim('job', 'fable')).toThrow('reconciliation');
  expect(() => store.reconcile('job', 'wrong', 'retry', 'checked')).toThrow();
  store.reconcile('job', a.generation, 'retry', 'Confirmed process stopped and no effect');
  const b = store.claim('job', 'fable').authority!;
  expect(b.generation).not.toBe(a.generation);
  expect(() => store.complete('job', a, { success: true, stdout: '', stderr: '', exitCode: 0 })).toThrow('Stale');
});
it('persists results until acknowledged without re-execution', async () => {
  store = new MissionStore(store.directory);
  store.create('job', op()); const a = store.claim('job', 'codex').authority!;
  const result = await runMission(store, 'job', a);
  expect(result.result).toMatchObject({ success: true, stdout: 'done' });
  const reopened = new MissionStore(store.directory);
  expect(reopened.acknowledge('job', 'fable').result).toEqual(result.result);
  expect(() => reopened.claim('job', 'codex')).toThrow('completed');
});
it('preserves malformed records instead of resetting them', () => {
  store.create('job', op());
  const file = path.join(store.directory, fs.readdirSync(store.directory)[0]!);
  fs.writeFileSync(file, '{broken');
  expect(() => store.claim('job', 'codex')).toThrow();
  expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
});
it('refuses malformed completion and leaves the mission running', () => {
  store.create('job', op()); const a = store.claim('job', 'codex').authority!; store.start('job', a);
  expect(() => store.complete('job', a, { success: true, stdout: '', stderr: '', exitCode: NaN })).toThrow('Invalid mission result');
  expect(store.get('job').status).toBe('running');
});
it('permits exactly one claimant in independent processes', async () => {
  store.create('race', op());
  const source = path.resolve('src/harness/mission-store.ts');
  const attempt = (owner: string) => new Promise<number | null>((resolve, reject) => {
    const code = `import {MissionStore} from ${JSON.stringify(source)}; try { new MissionStore(${JSON.stringify(store.directory)}).claim('race',${JSON.stringify(owner)}); } catch { process.exitCode=2; }`;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { stdio: 'ignore' });
    child.once('error', reject); child.once('exit', resolve);
  });
  expect((await Promise.all([attempt('codex'), attempt('fable')])).sort()).toEqual([0, 2]);
});
it('binds review to a clean exact commit and clears it on handoff', () => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test');
  fs.writeFileSync(path.join(root, '.gitignore'), 'state/\n'); git('add', '.gitignore'); git('commit', '-qm', 'initial');
  const sha = git('rev-parse', 'HEAD'); store.create('review', op()); const a = store.claim('review', 'codex').authority!;
  store.submit('review', a, sha);
  expect(() => store.approve('review', 'codex', sha)).toThrow('independent');
  expect(store.approve('review', 'fable', sha).review?.reviewer).toBe('fable');
  git('commit', '--allow-empty', '-qm', 'changed');
  expect(() => store.approve('review', 'fable', sha)).toThrow('unchanged');
  store.handoff('review', a, { succeeded: [], failed: [], keyFiles: [], deadEnds: [], nextAction: 'Review new HEAD' });
  expect(store.get('review').review).toBeUndefined();
});

it('bounds escaped and unicode outputs before persisting a successful effect', () => {
  store.create('large', op()); const a = store.claim('large', 'codex').authority!; store.start('large', a);
  const result = store.complete('large', a, { success: true, stdout: '\n'.repeat(800000), stderr: '界'.repeat(800000), exitCode: 0 });
  expect(result.status).toBe('completed');
  expect(new MissionStore(store.directory).get('large').result).toMatchObject({ truncated: true, success: true });
});
