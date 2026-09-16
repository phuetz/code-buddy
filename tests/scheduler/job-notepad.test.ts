import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  JobNotepadStore,
  JobNotepadBusyError,
  MAX_JOB_TOTAL_BYTES,
  MAX_KEY_CHARS,
  MAX_LAST_OUTPUT_BYTES,
  MAX_VALUE_BYTES,
  isContinuityEnabled,
  persistableContinuity,
  sanitizeJobId,
  utf8ByteLength,
  validateContinuity,
} from '../../src/scheduler/job-notepad.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QA_HOME = path.join(REPO_ROOT, '_qa', 'home');

describe('JobNotepadStore', () => {
  let previousHome: string | undefined;
  let previousCronHome: string | undefined;
  let tmpDir: string;
  let store: JobNotepadStore;

  beforeEach(() => {
    previousHome = process.env.HOME;
    previousCronHome = process.env.CODEBUDDY_CRON_HOME;
    mkdirSync(QA_HOME, { recursive: true, mode: 0o700 });
    process.env.HOME = QA_HOME;
    tmpDir = mkdtempSync(path.join(QA_HOME, 'notepad-'));
    process.env.CODEBUDDY_CRON_HOME = tmpDir;
    store = new JobNotepadStore(path.join(tmpDir, 'notepads'));
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousCronHome === undefined) delete process.env.CODEBUDDY_CRON_HOME;
    else process.env.CODEBUDDY_CRON_HOME = previousCronHome;
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('keeps jobs isolated and durable across store restart', async () => {
    await store.setNote('job-alpha', 'cursor', 'page-1');
    await store.setNote('job-beta', 'cursor', 'other');
    await store.saveLastSuccessfulOutput('job-alpha', 'alpha-ok');

    expect(await store.getNote('job-alpha', 'cursor')).toBe('page-1');
    expect(await store.getNote('job-beta', 'cursor')).toBe('other');
    expect(existsSync(store.fileFor('job-alpha'))).toBe(true);
    expect(store.fileFor('job-alpha')).not.toBe(store.fileFor('job-beta'));

    const reloaded = new JobNotepadStore(path.join(tmpDir, 'notepads'));
    expect(await reloaded.getNote('job-alpha', 'cursor')).toBe('page-1');
    expect(await reloaded.getNote('job-beta', 'cursor')).toBe('other');
    const alpha = await reloaded.load('job-alpha');
    expect(alpha.lastSuccessfulOutput).toBe('alpha-ok');
    expect((await reloaded.load('job-beta')).lastSuccessfulOutput).toBeUndefined();
  });

  it('renders an empty notepad as an empty string', async () => {
    expect(await store.renderSection('job-empty')).toBe('');
    expect(existsSync(store.fileFor('job-empty'))).toBe(false);
  });

  it('renders notes and last successful output together', async () => {
    await store.replaceNotes('job-render', { watermark: '42', cursor: 'abc' });
    await store.saveLastSuccessfulOutput('job-render', 'processed 3 items');
    const section = await store.renderSection('job-render');
    expect(section).toContain('## Job notepad (persistent across runs)');
    expect(section).toContain('- cursor: abc');
    expect(section).toContain('- watermark: 42');
    expect(section).toContain('## Last successful output');
    expect(section).toContain('processed 3 items');
  });

  it('rejects oversized writes and leaves the previous file untouched', async () => {
    await store.setNote('job-caps', 'keep', 'small');

    await expect(
      store.setNote('job-caps', 'x'.repeat(MAX_KEY_CHARS + 1), 'v'),
    ).rejects.toThrow(/key too long/);
    await expect(
      store.setNote('job-caps', 'huge', 'y'.repeat(MAX_VALUE_BYTES + 1)),
    ).rejects.toThrow(/value too large/);
    expect(await store.getNote('job-caps', 'keep')).toBe('small');
    expect(await store.getNote('job-caps', 'huge')).toBeUndefined();

    const filler = 'z'.repeat(MAX_VALUE_BYTES);
    await store.setNote('job-caps', 'n1', filler);
    await store.setNote('job-caps', 'n2', filler);
    await store.setNote('job-caps', 'n3', filler);
    await expect(store.setNote('job-caps', 'n4', filler)).rejects.toThrow(/notepad full/);
    expect(await store.getNote('job-caps', 'n3')).toBe(filler);
    expect(await store.getNote('job-caps', 'n4')).toBeUndefined();
  });

  it('truncates last successful output to the byte cap', async () => {
    const oversized = 'n'.repeat(MAX_LAST_OUTPUT_BYTES + 2048);
    await store.saveLastSuccessfulOutput('job-out', oversized);
    const loaded = await store.load('job-out');
    expect(utf8ByteLength(loaded.lastSuccessfulOutput ?? '')).toBe(MAX_LAST_OUTPUT_BYTES);
  });

  it('does not clobber last successful output with an empty save', async () => {
    await store.saveLastSuccessfulOutput('job-keep', 'kept');
    await store.saveLastSuccessfulOutput('job-keep', '');
    expect((await store.load('job-keep')).lastSuccessfulOutput).toBe('kept');
    expect(await store.renderSection('job-keep')).toContain('last non-empty result');
  });

  it('clears a job notepad and no-ops when the file is missing', async () => {
    await store.clear('missing');
    expect(existsSync(path.dirname(store.fileFor('missing')))).toBe(false);
    await store.setNote('job-clear', 'k', 'v');
    await store.clear('job-clear');
    expect(existsSync(store.fileFor('job-clear'))).toBe(false);
    await expect(store.clear('job-clear')).resolves.toBeUndefined();
    expect(await store.renderSection('job-clear')).toBe('');
  });

  it('rejects path-traversal job ids', () => {
    expect(() => sanitizeJobId('../etc/passwd')).toThrow(/invalid job id/);
    expect(() => store.fileFor('a/b')).toThrow(/invalid job id/);
    expect(() => store.fileFor('')).toThrow(/invalid job id/);
  });

  it('writes owner-only notepad files', async () => {
    await store.setNote('job-mode', 'k', 'v');
    if (process.platform !== 'win32') {
      const { statSync } = await import('node:fs');
      expect(statSync(store.fileFor('job-mode')).mode & 0o777).toBe(0o600);
    } else {
      expect(existsSync(store.fileFor('job-mode'))).toBe(true);
    }
  });

  it('treats continuity as opt-in', () => {
    expect(isContinuityEnabled(undefined)).toBe(false);
    expect(isContinuityEnabled(false)).toBe(false);
    expect(isContinuityEnabled(true)).toBe(true);
    expect(isContinuityEnabled({ enabled: false })).toBe(false);
    expect(isContinuityEnabled({ enabled: true, notes: { a: '1' } })).toBe(true);
    expect(isContinuityEnabled({ notes: { a: '1' } })).toBe(true);
    expect(persistableContinuity({ enabled: true, notes: { a: '1' } })).toEqual({ enabled: true });
  });

  it('keeps combined notes + last output within the job budget', async () => {
    const filler = 'q'.repeat(MAX_VALUE_BYTES);
    await store.setNote('job-budget', 'n1', filler);
    await store.setNote('job-budget', 'n2', filler);
    await store.setNote('job-budget', 'n3', filler);
    await store.saveLastSuccessfulOutput('job-budget', 'hello');
    await expect(store.setNote('job-budget', 'n4', filler)).rejects.toThrow(/notepad full/);
    expect(await store.getNote('job-budget', 'n4')).toBeUndefined();
    expect((await store.load('job-budget')).lastSuccessfulOutput).toBe('hello');
  });

  it.each([null, [], 'yes', 1, { enabled: 'yes' }, { notes: [] }, { notes: 'abc' }, { notes: null }, { notes: { k: 1 } }, { unexpected: true }])(
    'rejects malformed continuity input %j', value => {
      expect(() => validateContinuity(value)).toThrow();
    },
  );

  it('validates serialized note bounds and snapshots caller input', () => {
    expect(() => validateContinuity({ notes: { escaped: '\0'.repeat(MAX_VALUE_BYTES) } })).toThrow('notepad full');
    const input = { enabled: true, notes: { cursor: 'before' } };
    const validated = validateContinuity(input);
    input.notes.cursor = 'after';
    expect(validated).toEqual({ enabled: true, notes: { cursor: 'before' } });
  });

  it('preserves prototype-named notes and never exposes inherited properties', async () => {
    await store.setNote('special', '__proto__', 'cursor');
    await store.setNote('special', 'constructor', 'saved');
    const reloaded = new JobNotepadStore(path.dirname(store.fileFor('special')));
    expect(await reloaded.getNote('special', '__proto__')).toBe('cursor');
    expect(await reloaded.getNote('special', 'constructor')).toBe('saved');
    expect(await reloaded.getNote('special', 'toString')).toBeUndefined();
    expect(await reloaded.deleteNote('special', 'toString')).toBe(false);
    expect(await reloaded.deleteNote('special', '__proto__')).toBe(true);
    expect(await reloaded.getNote('special', '__proto__')).toBeUndefined();
    expect(await reloaded.listNotes('special')).toEqual([{ key: 'constructor', value: 'saved' }]);
  });

  it.each([
    '', '{broken',
    JSON.stringify({ notes: { key: 9 }, updatedAt: '2026-09-13T12:00:00.000Z' }),
    JSON.stringify({ notes: {}, updatedAt: 'invalid' }),
    JSON.stringify({ notes: [], updatedAt: '2026-09-13T12:00:00.000Z' }),
    ' '.repeat(MAX_JOB_TOTAL_BYTES + 1),
  ])('preserves corrupt record bytes when reads or updates fail (case %#)', async bytes => {
    const file = store.fileFor('corrupt');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    await expect(store.load('corrupt')).rejects.toThrow();
    await expect(store.setNote('corrupt', 'new', 'value')).rejects.toThrow();
    await expect(store.saveLastSuccessfulOutput('corrupt', 'output')).rejects.toThrow();
    expect(readFileSync(file, 'utf8')).toBe(bytes);
    expect(existsSync(`${file}.lock`)).toBe(false);
  });

  it('bounds the serialized file including JSON escaping and preserves rejected writes', async () => {
    await store.setNote('escaped', 'keep', 'original');
    const file = store.fileFor('escaped');
    const before = readFileSync(file, 'utf8');
    await expect(store.setNote('escaped', 'huge', '\0'.repeat(MAX_VALUE_BYTES))).rejects.toThrow('notepad full');
    expect(readFileSync(file, 'utf8')).toBe(before);
    await store.saveLastSuccessfulOutput('escaped', '\0'.repeat(MAX_LAST_OUTPUT_BYTES));
    const output = (await store.load('escaped')).lastSuccessfulOutput!;
    expect(output.length).toBeGreaterThan(0);
    expect(output.length).toBeLessThan(MAX_LAST_OUTPUT_BYTES);
    expect(statSync(file).size).toBeLessThanOrEqual(MAX_JOB_TOTAL_BYTES);
    expect(await store.getNote('escaped', 'keep')).toBe('original');
  });

  it('excludes concurrent stores and another process for the whole read-modify-write transaction', async () => {
    await store.setNote('race', 'initial', 'kept');
    const other = new JobNotepadStore(path.dirname(store.fileFor('race')));
    const originalLoad = store.load.bind(store);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const acquired = new Promise<void>(resolve => { entered = resolve; });
    const read = vi.spyOn(store, 'load').mockImplementationOnce(async id => {
      entered();
      await gate;
      return originalLoad(id);
    });
    const first = store.setNote('race', 'first', 'saved');
    try {
      await acquired;
      await expect(other.saveLastSuccessfulOutput('race', 'result')).rejects.toBeInstanceOf(JobNotepadBusyError);
      await expect(other.setNote('race', 'second', 'saved')).rejects.toBeInstanceOf(JobNotepadBusyError);
      const source = pathToFileURL(path.join(REPO_ROOT, 'src/scheduler/job-notepad.ts')).href;
      const script = `import {JobNotepadStore} from ${JSON.stringify(source)}; try { await new JobNotepadStore(${JSON.stringify(path.dirname(store.fileFor('race')))}).setNote('race','child','unexpected'); console.log('unexpected success'); } catch (error) { console.log(error.name); }`;
      expect(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
        cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000,
      }).trim()).toBe('JobNotepadBusyError');
    } finally {
      release();
      await first;
      read.mockRestore();
    }
    await other.setNote('race', 'second', 'saved');
    await other.saveLastSuccessfulOutput('race', 'result');
    expect(await other.load('race')).toMatchObject({
      notes: { initial: 'kept', first: 'saved', second: 'saved' }, lastSuccessfulOutput: 'result',
    });
    expect(await other.getNote('race', 'child')).toBeUndefined();
  });

  it('never steals an abandoned lock or changes the stored record through it', async () => {
    await store.setNote('orphan', 'kept', 'value');
    const file = store.fileFor('orphan');
    const before = readFileSync(file, 'utf8');
    writeFileSync(`${file}.lock`, 'operator inspection required');
    await expect(store.setNote('orphan', 'new', 'value')).rejects.toBeInstanceOf(JobNotepadBusyError);
    await expect(store.saveLastSuccessfulOutput('orphan', 'result')).rejects.toBeInstanceOf(JobNotepadBusyError);
    await expect(store.clear('orphan')).rejects.toBeInstanceOf(JobNotepadBusyError);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(readFileSync(`${file}.lock`, 'utf8')).toBe('operator inspection required');
  });
});
