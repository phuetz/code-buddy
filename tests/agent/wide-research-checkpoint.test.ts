import { chmod, lstat, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertWideResearchCheckpointCompatible,
  createWideResearchExecutionFingerprint,
  FileWideResearchCheckpointStore,
  parseWideResearchCheckpoint,
  redactWideResearchText,
  resolveWideResearchCheckpointPath,
  WIDE_RESEARCH_CHECKPOINT_KIND,
  WIDE_RESEARCH_CHECKPOINT_VERSION,
  WideResearchCheckpointError,
  type WideResearchCheckpoint,
} from '../../src/agent/wide-research-checkpoint.js';

const tempDirs: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'wide-research-checkpoint-'));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function checkpoint(overrides: Partial<WideResearchCheckpoint> = {}): WideResearchCheckpoint {
  return {
    kind: WIDE_RESEARCH_CHECKPOINT_KIND,
    version: WIDE_RESEARCH_CHECKPOINT_VERSION,
    state: 'running',
    topic: 'durable agents',
    options: {
      workers: 2,
      items: 2,
      concurrency: 2,
      maxRoundsPerWorker: 15,
      workerTimeoutMs: 90_000,
      overallTimeoutMs: 300_000,
      decomposeTimeoutMs: 45_000,
      aggregateTimeoutMs: 60_000,
    },
    executionFingerprint: createWideResearchExecutionFingerprint({ test: true }),
    subtopics: ['storage', 'recovery'],
    workerResults: [
      {
        subtopic: 'storage',
        workerIndex: 0,
        output: 'atomic rename',
        success: true,
        durationMs: 12,
      },
    ],
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:01.000Z',
    ...overrides,
  };
}

describe('Wide Research checkpoint schema and atomic store', () => {
  it('atomically replaces a checkpoint with a closed, versioned JSON document', async () => {
    const directory = await tempDirectory();
    const file = join(directory, 'run.json');
    const store = new FileWideResearchCheckpointStore();
    await store.save(file, checkpoint({ state: 'decomposed' }));
    await expect(store.assertCreatable(file)).rejects.toThrow(/use --resume/);

    const value = checkpoint() as WideResearchCheckpoint & {
      apiKey?: string;
      providerConfig?: { baseURL: string };
    };
    value.apiKey = 'sk-checkpoint-must-not-leak';
    value.providerConfig = { baseURL: 'https://secret-provider.invalid' };
    value.workerResults[0]!.output = 'OPENROUTER_API_KEY=sk-or-v1-abcdefghijklmnop';
    await store.save(file, value);

    const raw = await readFile(file, 'utf8');
    const parsed = parseWideResearchCheckpoint(raw);
    expect(parsed.kind).toBe(WIDE_RESEARCH_CHECKPOINT_KIND);
    expect(parsed.version).toBe(1);
    expect(raw).not.toContain('sk-checkpoint-must-not-leak');
    expect(raw).not.toContain('secret-provider.invalid');
    expect(raw).not.toContain('abcdefghijklmnop');
    expect(await readdir(directory)).toEqual(['run.json']);
    expect((await lstat(file)).mode & 0o777).toBe(0o600);
  });

  it('refuses to overwrite an unrelated existing file', async () => {
    const directory = await tempDirectory();
    const file = join(directory, 'settings.json');
    const store = new FileWideResearchCheckpointStore();
    await writeFile(file, '{"important":true}\n', 'utf8');
    const before = await readFile(file, 'utf8');

    await expect(store.save(file, checkpoint())).rejects.toMatchObject({
      code: 'WRITE_FAILED',
    });
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('preserves the previous checkpoint and removes the temp file when atomic rename fails', async () => {
    const directory = await tempDirectory();
    const file = join(directory, 'run.json');
    const store = new FileWideResearchCheckpointStore();
    await store.save(file, checkpoint({ state: 'decomposed' }));
    const before = await readFile(file, 'utf8');
    const failingStore = new FileWideResearchCheckpointStore({
      rename: vi.fn(async () => {
        throw new Error('injected rename failure');
      }),
    });

    await expect(
      failingStore.save(file, checkpoint({ state: 'completed' })),
    ).rejects.toMatchObject({ code: 'WRITE_FAILED' });
    expect(await readFile(file, 'utf8')).toBe(before);
    expect(await readdir(directory)).toEqual(['run.json']);
  });

  it('rejects malformed and unsupported checkpoints without rewriting them', async () => {
    const directory = await tempDirectory();
    const file = join(directory, 'bad.json');
    const store = new FileWideResearchCheckpointStore();
    await writeFile(file, '{broken', 'utf8');
    await chmod(file, 0o600);
    const before = await readFile(file, 'utf8');

    await expect(store.load(file)).rejects.toMatchObject({
      code: 'INVALID_CHECKPOINT',
    });
    expect(await readFile(file, 'utf8')).toBe(before);

    const unsupported = { ...checkpoint(), version: 99 };
    await writeFile(file, JSON.stringify(unsupported), 'utf8');
    await expect(store.load(file)).rejects.toMatchObject({
      code: 'UNSUPPORTED_VERSION',
    });
  });

  it('resolves relative paths and rejects directory or symlink targets', async () => {
    const directory = await tempDirectory();
    const resolved = resolveWideResearchCheckpointPath('nested/run.json', directory);
    expect(resolved).toBe(join(directory, 'nested', 'run.json'));

    const store = new FileWideResearchCheckpointStore();
    const targetDirectory = join(directory, 'directory-target');
    await mkdir(targetDirectory);
    await expect(store.save(targetDirectory, checkpoint())).rejects.toBeInstanceOf(
      WideResearchCheckpointError,
    );

    const real = join(directory, 'real.json');
    const link = join(directory, 'link.json');
    await writeFile(real, JSON.stringify(checkpoint()), 'utf8');
    await symlink(real, link);
    await expect(store.load(link)).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('refuses a real checkpoint path that crosses a symlinked parent', async () => {
    const directory = await tempDirectory();
    const realParent = join(directory, 'real-parent');
    const aliasedParent = join(directory, 'aliased-parent');
    await mkdir(realParent);
    await symlink(realParent, aliasedParent);
    const store = new FileWideResearchCheckpointStore();

    await expect(
      store.save(join(aliasedParent, 'run.json'), checkpoint()),
    ).rejects.toMatchObject({
      code: 'INVALID_PATH',
      message: expect.stringMatching(/symbolic-link parent/),
    });
    expect(await readdir(realParent)).toEqual([]);
  });

  it('requires private checkpoint permissions before resume on POSIX', async () => {
    if (process.platform === 'win32') return;
    const directory = await tempDirectory();
    const file = join(directory, 'shared.json');
    const store = new FileWideResearchCheckpointStore();
    await writeFile(file, `${JSON.stringify(checkpoint())}\n`, { mode: 0o666 });
    await chmod(file, 0o666);

    await expect(store.load(file)).rejects.toThrow(/chmod 600/);
  });

  it('reports topic, options and execution fingerprint mismatches explicitly', () => {
    const value = checkpoint();
    expect(() =>
      assertWideResearchCheckpointCompatible(value, {
        topic: 'different topic',
        options: { ...value.options, items: 3 },
        executionFingerprint: 'f'.repeat(64),
      }),
    ).toThrow(/topic, options\.items, execution fingerprint/);
  });

  it('rejects impossible completed-zero and over-capacity checkpoint states', () => {
    expect(() =>
      parseWideResearchCheckpoint(JSON.stringify(checkpoint({
        state: 'completed',
        subtopics: [],
        workerResults: [],
      }))),
    ).toThrow(/subtopics are invalid/);

    expect(() =>
      parseWideResearchCheckpoint(JSON.stringify(checkpoint({
        options: { ...checkpoint().options, workers: 1, items: 1, concurrency: 1 },
      }))),
    ).toThrow(/subtopics are invalid/);
  });

  it('reads legacy checkpoints as equal item/concurrency runs', () => {
    const legacy = checkpoint();
    const options = { ...legacy.options } as Partial<typeof legacy.options>;
    delete options.items;
    delete options.concurrency;
    const parsed = parseWideResearchCheckpoint(JSON.stringify({ ...legacy, options }));

    expect(parsed.options).toMatchObject({ workers: 2, items: 2, concurrency: 2 });
  });

  it('scrubs exact secrets, credential assignments, bearer tokens and known key shapes', () => {
    const redacted = redactWideResearchText(
      'exact-value Authorization: Bearer cloud-token ' +
        'OPENROUTER_API_KEY=sk-or-v1-abcdefghijklmnop password="two word passphrase"',
      ['exact-value'],
    );

    expect(redacted).not.toContain('exact-value');
    expect(redacted).not.toContain('cloud-token');
    expect(redacted).not.toContain('abcdefghijklmnop');
    expect(redacted).not.toContain('two word passphrase');
    expect(redacted).toContain('[REDACTED]');
  });
});
