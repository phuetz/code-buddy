import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HOME_MODES,
  HomeModeStore,
} from '../../src/life-rhythm/index.js';

let temporaryDirectory: string;
let filePath: string;

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-home-mode-'));
  filePath = path.join(temporaryDirectory, 'private', 'home-mode.json');
});

afterEach(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

describe('HomeModeStore', () => {
  it('round-trips every supported mode through atomic persistence', async () => {
    const store = new HomeModeStore({
      filePath,
      now: () => new Date('2026-07-12T20:00:00.000Z'),
    });
    for (const mode of HOME_MODES) {
      await store.setMode(mode);
      expect((await store.getCurrent()).mode).toBe(mode);
    }
    const files = await fs.readdir(path.dirname(filePath));
    expect(files).toEqual(['home-mode.json']);
  });

  it('resets an expired temporary mode to normal and persists that reset', async () => {
    let now = new Date('2026-07-12T20:00:00.000Z');
    const store = new HomeModeStore({ filePath, now: () => now });
    const focus = await store.setMode('focus', { durationMs: 60_000 });
    expect(focus.expiresAt).toBe('2026-07-12T20:01:00.000Z');
    expect((await store.getCurrent()).mode).toBe('focus');

    now = new Date('2026-07-12T20:02:00.000Z');
    const expired = await store.getCurrent();
    expect(expired).toMatchObject({
      mode: 'normal',
      source: 'expired',
      previousMode: 'focus',
    });
    const persisted = JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>;
    expect(persisted.mode).toBe('normal');
    expect(persisted.expiresAt).toBeUndefined();
    expect((await store.getCurrent()).source).toBe('stored');
  });

  it('uses private directory and file permissions on POSIX', async () => {
    const store = new HomeModeStore({ filePath });
    await store.setMode('silent');
    if (process.platform === 'win32') return;

    const directoryMode = (await fs.stat(path.dirname(filePath))).mode & 0o777;
    const fileMode = (await fs.stat(filePath)).mode & 0o777;
    expect(directoryMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });

  it('fails soft to normal for missing or corrupt state', async () => {
    const store = new HomeModeStore({
      filePath,
      now: () => new Date('2026-07-12T20:00:00.000Z'),
    });
    expect(await store.getCurrent()).toMatchObject({ mode: 'normal', source: 'default' });
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '{bad json', 'utf8');
    expect(await store.getCurrent()).toMatchObject({ mode: 'normal', source: 'default' });
  });
});
