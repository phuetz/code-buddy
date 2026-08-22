import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkIntent, drift } from '../../src/intents/intent-checker.js';
import { IntentStore, type Intent } from '../../src/intents/intent-store.js';

function intent(criteria: Intent['criteria']): Intent {
  return {
    id: 'checker-contract',
    title: 'Checker contract',
    status: 'active',
    createdAt: '2026-07-15T10:00:00.000Z',
    files: [],
    criteria,
    body: '',
  };
}

describe('checkIntent', () => {
  it('runs injected sh criteria and ANDs every expected exit code', async () => {
    const result = await checkIntent(intent([
      { desc: 'zero', cmd: 'sh -c "exit 0"', expectExit: 0 },
      { desc: 'one expected', cmd: 'sh -c "exit 1"', expectExit: 1 },
      { desc: 'one unexpected', cmd: 'sh -c "exit 1"', expectExit: 0 },
    ]));

    expect(result.results.map((entry) => entry.ok)).toEqual([true, true, false]);
    expect(result.results.map((entry) => entry.exitCode)).toEqual([0, 1, 1]);
    expect(result.ok).toBe(false);
  });

  it('enforces a mandatory timeout and reports it as a failed gate', async () => {
    const result = await checkIntent(
      intent([{ desc: 'too slow', cmd: 'sh -c "sleep 1"', expectExit: 0 }]),
      { timeoutMs: 20 },
    );

    expect(result.ok).toBe(false);
    expect(result.results[0]).toMatchObject({ timedOut: true, exitCode: null, ok: false });
    expect(result.results[0]?.tail).toContain('timed out');
  });

  it('refuses sudo without starting the criterion', async () => {
    const result = await checkIntent(intent([
      { desc: 'privileged', cmd: 'sudo true', expectExit: 0 },
    ]));
    expect(result.results[0]).toMatchObject({ ok: false, exitCode: null });
    expect(result.results[0]?.tail).toContain('sudo is not allowed');
  });
});

describe('drift', () => {
  let rootDir: string;
  let store: IntentStore;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'intent-drift-'));
    let nextId = 0;
    store = new IntentStore({
      rootDir,
      idFactory: () => `done-${++nextId}`,
    });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('detects a deleted referenced file and a failing criterion on done intents', async () => {
    const removedPath = path.join(rootDir, 'removed.txt');
    const presentPath = path.join(rootDir, 'present.txt');
    await writeFile(removedPath, 'present for now', 'utf8');
    await writeFile(presentPath, 'still here', 'utf8');

    const missingFileIntent = await store.create({
      title: 'File must remain',
      status: 'done',
      files: ['removed.txt'],
      criteria: [{ desc: 'Independent oracle passes', cmd: 'sh -c "exit 0"', expectExit: 0 }],
    });
    const failingCriterionIntent = await store.create({
      title: 'Oracle must remain green',
      status: 'done',
      files: ['present.txt'],
      criteria: [{ desc: 'Now red', cmd: 'sh -c "exit 1"', expectExit: 0 }],
    });
    await unlink(removedPath);

    const result = await drift(store);
    expect(result.map((entry) => entry.id)).toEqual([
      missingFileIntent.id,
      failingCriterionIntent.id,
    ]);
    expect(result[0]?.missingFiles).toEqual(['removed.txt']);
    expect(result[0]?.failedCriteria).toHaveLength(0);
    expect(result[1]?.missingFiles).toHaveLength(0);
    expect(result[1]?.failedCriteria[0]?.criterion.desc).toBe('Now red');

    const events = (await readFile(store.ledgerPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string });
    expect(events.filter((event) => event.type === 'checked')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'drifted')).toHaveLength(2);
  });
});
