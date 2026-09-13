import { it, vi, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { MissionStore } from '../../src/harness/mission-store.js';
import * as fitness from '../../src/agent/self-improvement/evolution/variant-fitness.js';
import { runMission } from '../../src/harness/mission-runner.js';

let root: string;
let now: number;
let store: MissionStore;
const op = () => ({ command: process.execPath, args: ['-e', 'process.stdout.write("done")'], workspace: root, timeoutMs: 1000 });
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-missions-')); now = 10000; store = new MissionStore(path.join(root, 'state'), () => now); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const missionFile = (id: string) => `${createHash('sha256').update(id).digest('hex')}.json`;

it('lists an absent store without creating directories or files', () => {
  expect(store.list()).toEqual({ missions: [], errors: [] });
  expect(fs.existsSync(store.directory)).toBe(false);
});

it('lists only whitelisted metadata without output, command, handoff or authority tokens', () => {
  const operation = { ...op(), command: 'PRIVATE_COMMAND', args: ['PRIVATE_ARGUMENT'], workspace: path.join(root, 'PRIVATE_WORKSPACE') };
  store.create('done', operation);
  const first = store.claim('done', 'first-owner').authority!;
  store.handoff('done', first, {
    succeeded: ['PRIVATE_SUCCEEDED'], failed: ['PRIVATE_FAILED'], keyFiles: ['PRIVATE_KEY_FILE'],
    deadEnds: ['PRIVATE_DEAD_END'], nextAction: 'PRIVATE_NEXT_ACTION',
  });
  const owner = store.claim('done', 'worker').authority!;
  store.start('done', owner);
  store.complete('done', owner, { success: true, stdout: 'PRIVATE_STDOUT'.repeat(5000), stderr: 'PRIVATE_STDERR', exitCode: 0 });
  store.submit('done', owner, 'a'.repeat(40));
  const done = store.acknowledge('done', 'PRIVATE_ACK_CONSUMER');
  store.create('waiting', operation);
  const waiting = store.claim('waiting', 'next-worker', 1000);
  now += 1000;
  const page = store.list();
  expect(page.errors).toEqual([]);
  expect(page.missions.find(m => m.id === 'done')).toEqual({
    id: 'done', revision: done.revision, status: 'completed', updatedAt: done.updatedAt,
    owner: 'worker', success: true, acknowledged: true,
  });
  expect(page.missions.find(m => m.id === 'waiting')).toEqual({
    id: 'waiting', revision: waiting.revision, status: 'claimed', updatedAt: waiting.updatedAt,
    owner: 'next-worker', expiresAt: waiting.expiresAt, leaseExpired: true, acknowledged: false,
  });
  const serialized = JSON.stringify(page);
  for (const secret of ['PRIVATE_', root, first.generation, owner.generation, waiting.authority!.generation, 'stdout', 'stderr', 'handoff', 'generation', 'command', 'workspace', 'review']) {
    expect(serialized).not.toContain(secret);
  }
  expect(serialized.length).toBeLessThan(1024);
  expect(store.get('waiting').revision).toBe(waiting.revision);
});

it('paginates deterministically across valid and corrupt files while ignoring temporary state', () => {
  const ids = Array.from({ length: 6 }, (_, index) => `page-${index}`);
  for (const id of ids) store.create(id, op());
  const badFile = `${'f'.repeat(64)}.json`;
  fs.writeFileSync(path.join(store.directory, badFile), '{PRIVATE_CORRUPTION');
  fs.writeFileSync(path.join(store.directory, `${missionFile(ids[0]!)}.lock`), 'private generation');
  fs.writeFileSync(path.join(store.directory, `${missionFile(ids[0]!)}.temporary.tmp`), 'private output');
  fs.writeFileSync(path.join(store.directory, 'unrelated.json'), 'not a mission');
  const seenIds: string[] = [];
  const seenErrors: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = store.list({ limit: 2, cursor });
    expect(page.missions.length + page.errors.length).toBeLessThanOrEqual(2);
    seenIds.push(...page.missions.map(m => m.id));
    seenErrors.push(...page.errors.map(error => error.file));
    if (page.nextCursor) expect(page.nextCursor > (cursor ?? '')).toBe(true);
    cursor = page.nextCursor;
    pages++;
    expect(pages).toBeLessThanOrEqual(4);
  } while (cursor);
  expect(seenIds).toEqual([...ids].sort((a, b) => missionFile(a).localeCompare(missionFile(b))));
  expect(seenErrors).toEqual([badFile]);
  expect(pages).toBe(4);
  expect(fs.readFileSync(path.join(store.directory, badFile), 'utf8')).toBe('{PRIVATE_CORRUPTION');
});

it('reads only the selected page and never reports an unvalidated filename identity', () => {
  store.create('valid', op());
  const validFile = path.join(store.directory, missionFile('valid'));
  const copied = path.join(store.directory, `${'e'.repeat(64)}.json`);
  fs.copyFileSync(validFile, copied);
  fs.mkdirSync(path.join(store.directory, `${'d'.repeat(64)}.json`));
  const reads = vi.spyOn(fs, 'readFileSync');
  try {
    const page = store.list({ limit: 1 });
    expect(page.nextCursor).toBeDefined();
    expect(reads.mock.calls.length).toBeLessThanOrEqual(1);
  } finally { reads.mockRestore(); }
  const page = store.list();
  expect(page.missions.map(m => m.id)).toEqual(['valid']);
  expect(page.errors).toEqual([
    { file: `${'d'.repeat(64)}.json`, error: 'Invalid or unreadable mission record' },
    { file: `${'e'.repeat(64)}.json`, error: 'Invalid or unreadable mission record' },
  ]);
  expect(fs.readFileSync(copied, 'utf8')).toBe(fs.readFileSync(validFile, 'utf8'));
});

it('reports malformed and oversized records without exposing parser or validation contents', () => {
  fs.mkdirSync(store.directory);
  const malformed = `${'a'.repeat(64)}.json`;
  const oversized = `${'b'.repeat(64)}.json`;
  fs.writeFileSync(path.join(store.directory, malformed), '{"PRIVATE_PARSER_DETAIL":notjson}');
  fs.writeFileSync(path.join(store.directory, oversized), 'PRIVATE_OVERSIZED'.repeat(200000));
  const page = store.list({ limit: 1 });
  expect(page).toEqual({
    missions: [], errors: [{ file: malformed, error: 'Invalid or unreadable mission record' }], nextCursor: 'a'.repeat(64),
  });
  const next = store.list({ limit: 1, cursor: page.nextCursor });
  expect(next).toEqual({ missions: [], errors: [{ file: oversized, error: 'Invalid or unreadable mission record' }] });
  expect(JSON.stringify([page, next])).not.toContain('PRIVATE_');
});

it('rejects invalid pagination arguments before touching an absent store', () => {
  for (const limit of [0, -1, 101, 1.5, NaN, Infinity]) expect(() => store.list({ limit })).toThrow('limit');
  for (const cursor of ['', '../outside', 'A'.repeat(64), 'a'.repeat(63)]) expect(() => store.list({ cursor })).toThrow('cursor');
  expect(fs.existsSync(store.directory)).toBe(false);
});

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
  store.create('completed-review', op()); const done = store.claim('completed-review', 'codex').authority!;
  store.start('completed-review', done);
  store.complete('completed-review', done, { success: true, stdout: 'verified', stderr: '', exitCode: 0 });
  const current = git('rev-parse', 'HEAD'); store.submit('completed-review', done, current);
  expect(store.approve('completed-review', 'fable', current).review?.reviewer).toBe('fable');
});

it('bounds escaped and unicode outputs before persisting a successful effect', () => {
  store.create('large', op()); const a = store.claim('large', 'codex').authority!; store.start('large', a);
  const result = store.complete('large', a, { success: true, stdout: '\n'.repeat(800000), stderr: '界'.repeat(800000), exitCode: 0 });
  expect(result.status).toBe('completed');
  expect(new MissionStore(store.directory).get('large').result).toMatchObject({ truncated: true, success: true });
});

it('renews a running lease and persists cancellation without leaving its timer alive', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  let finish: ((value: { code: number; stdout: string; stderr: string; timedOut: boolean }) => void) | undefined;
  const proc = vi.spyOn(fitness, 'runProc').mockImplementation((_cmd, _args, ctx) => new Promise(resolve => {
    finish = resolve;
    ctx.signal?.addEventListener('abort', () => resolve({ code: 130, stdout: '', stderr: 'Cancelled', timedOut: false }));
  }));
  try {
    store = new MissionStore(store.directory);
    store.create('renewal', op()); const a = store.claim('renewal', 'codex').authority!;
    const controller = new AbortController();
    const pending = runMission(store, 'renewal', a, controller.signal);
    const expiry = store.get('renewal').expiresAt!;
    await vi.advanceTimersByTimeAsync(15000);
    expect(store.get('renewal').expiresAt).toBeGreaterThan(expiry);
    controller.abort();
    expect((await pending).result).toMatchObject({ success: false, exitCode: 130 });
    expect(vi.getTimerCount()).toBe(0);
  } finally { finish?.({ code: 130, stdout: '', stderr: '', timedOut: false }); proc.mockRestore(); vi.useRealTimers(); }
});
