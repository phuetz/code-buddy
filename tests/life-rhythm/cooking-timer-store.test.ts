import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CookingTimerStore,
  MAX_COOKING_TIMER_DURATION_MS,
  MIN_COOKING_TIMER_DURATION_MS,
} from '../../src/life-rhythm/index.js';

let temporaryDirectory: string;
let filePath: string;

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-cooking-timer-'));
  filePath = path.join(temporaryDirectory, 'private', 'cooking-timers.json');
});

afterEach(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

describe('CookingTimerStore', () => {
  it('starts named timers and lists running/due state without consuming due timers', async () => {
    const now = new Date('2026-07-12T18:00:00.000Z');
    const store = new CookingTimerStore({ filePath, now: () => now });
    const pasta = await store.start(8 * 60_000, '  pâtes  ');
    const sauce = await store.start(3 * 60_000, 'sauce');

    expect(pasta.label).toBe('pâtes');
    expect(pasta.dueAt).toBe('2026-07-12T18:08:00.000Z');
    expect((await store.listActive()).map((timer) => timer.label)).toEqual(['sauce', 'pâtes']);
    expect(await store.due(new Date('2026-07-12T18:02:59.999Z'))).toEqual([]);

    const due = await store.due(new Date('2026-07-12T18:03:00.000Z'));
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ id: sauce.id, label: 'sauce', state: 'due', remainingMs: 0 });
    expect(await store.due(new Date('2026-07-12T18:03:30.000Z'))).toHaveLength(1);
  });

  it('restores stable ids and absolute dueAt after restart', async () => {
    let now = new Date('2026-07-12T18:00:00.000Z');
    const firstProcess = new CookingTimerStore({ filePath, now: () => now });
    const timer = await firstProcess.start(60_000, 'œufs mollets');

    now = new Date('2026-07-12T18:02:00.000Z');
    const restartedProcess = new CookingTimerStore({ filePath, now: () => now });
    const restored = await restartedProcess.listActive();
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      id: timer.id,
      dueAt: '2026-07-12T18:01:00.000Z',
      state: 'due',
    });
  });

  it('requires due state for acknowledge and supports idempotent cancel', async () => {
    const now = new Date('2026-07-12T18:00:00.000Z');
    const store = new CookingTimerStore({ filePath, now: () => now });
    const timer = await store.start(10_000, 'thé');

    expect(await store.acknowledge(timer.id, new Date('2026-07-12T18:00:09.999Z'))).toBeNull();
    expect(await store.acknowledge(timer.id, new Date('2026-07-12T18:00:10.000Z'))).toMatchObject({
      id: timer.id,
    });
    expect(await store.acknowledge(timer.id, new Date('2026-07-12T18:00:11.000Z'))).toBeNull();

    const second = await store.start(20_000, 'four');
    expect(await store.cancel(second.id)).toMatchObject({ id: second.id });
    expect(await store.cancel(second.id)).toBeNull();
    expect(await store.listActive()).toEqual([]);
  });

  it('validates duration bounds and labels', async () => {
    const store = new CookingTimerStore({ filePath });
    await expect(store.start(MIN_COOKING_TIMER_DURATION_MS - 1, 'court')).rejects.toThrow(/between/);
    await expect(store.start(MAX_COOKING_TIMER_DURATION_MS + 1, 'long')).rejects.toThrow(/between/);
    await expect(store.start(1_500.5, 'fraction')).rejects.toThrow(/integer/);
    await expect(store.start(1_000, '   ')).rejects.toThrow(/empty/);
  });

  it('returns no timers for corrupt state instead of inventing an alarm', async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '{"schemaVersion":1,"timers":[{"id":"fabricated"}]}', 'utf8');
    const store = new CookingTimerStore({ filePath });

    expect(await store.listActive()).toEqual([]);
    expect(await store.due()).toEqual([]);
    expect(await store.cancel('fabricated')).toBeNull();
  });

  it('stores timer state with private permissions on POSIX', async () => {
    const store = new CookingTimerStore({ filePath });
    await store.start(1_000, 'test');
    if (process.platform === 'win32') return;

    expect((await fs.stat(path.dirname(filePath))).mode & 0o777).toBe(0o700);
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
  });
});
