/**
 * Ebbinghaus forgetting + recall reinforcement — the companion memory that
 * finally forgets. Pure retention model, metadata round-trip through the
 * markdown file, the recoverable archive-then-delete pass, and the dreaming
 * cadence gate. Real fs (temp dirs), no mocks.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  DEFAULT_FORGETTING_CONFIG,
  decideForgets,
  resolveForgettingConfig,
  retentionOf,
  type ForgettableMemory,
} from '../../src/memory/memory-forgetting.js';
import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';
import { runDreamingPass } from '../../src/sensory/dreaming.js';
import { getSensoryMemory } from '../../src/sensory/sensory-memory.js';

const DAY = 86_400_000;
const daysAgo = (n: number, from: number): Date => new Date(from - n * DAY);

async function makeManager(dir: string): Promise<PersistentMemoryManager> {
  const manager = new PersistentMemoryManager({
    projectMemoryPath: path.join(dir, 'CODEBUDDY_MEMORY.md'),
    userMemoryPath: path.join(dir, 'memory.md'),
    autoCapture: false,
  });
  await manager.initialize();
  return manager;
}

describe('memory-forgetting — pure retention model', () => {
  const cfg = DEFAULT_FORGETTING_CONFIG;
  const now = new Date('2026-07-02T00:00:00Z');
  const entry = (key: string, over: Partial<ForgettableMemory> = {}): ForgettableMemory => ({
    key,
    value: 'v',
    category: 'context',
    createdAt: daysAgo(60, now.getTime()),
    updatedAt: daysAgo(60, now.getTime()),
    accessCount: 0,
    ...over,
  });

  it('retention decays with age and each recall raises stability', () => {
    expect(retentionOf(10, 0, cfg)).toBeGreaterThan(cfg.retentionThreshold);
    expect(retentionOf(50, 0, cfg)).toBeLessThan(cfg.retentionThreshold);
    // Same age, recalled 4× → stability ×5 → survives.
    expect(retentionOf(50, 4, cfg)).toBeGreaterThan(cfg.retentionThreshold);
  });

  it('never-recalled old memory fades; its recalled sibling survives', () => {
    const out = decideForgets([entry('stale'), entry('used', { accessCount: 4 })], now);
    expect(out.map((c) => c.key)).toEqual(['stale']);
    expect(out[0]!.retention).toBeLessThan(cfg.retentionThreshold);
  });

  it('a recent recall restarts the decay clock (lastAccessedAt anchor)', () => {
    const recalled = entry('anchored', {
      createdAt: daysAgo(120, now.getTime()),
      updatedAt: daysAgo(120, now.getTime()),
      lastAccessedAt: daysAgo(2, now.getTime()),
      accessCount: 1,
    });
    expect(decideForgets([recalled], now)).toEqual([]);
  });

  it('protected categories, pinned tag and the grace period never fade', () => {
    const decision = entry('arch', { category: 'decisions', createdAt: daysAgo(400, now.getTime()), updatedAt: daysAgo(400, now.getTime()) });
    const pinned = entry('pin', { tags: ['pinned'], updatedAt: daysAgo(400, now.getTime()) });
    expect(decideForgets([decision, pinned], now)).toEqual([]);
    // Grace period: 6 days old survives even a config that forgets instantly.
    const young = entry('young', { updatedAt: daysAgo(6, now.getTime()) });
    expect(decideForgets([young], now, { baseStabilityDays: 0.1 })).toEqual([]);
  });

  it('resolveForgettingConfig reads env overrides and clamps a runaway threshold', () => {
    const resolved = resolveForgettingConfig({
      CODEBUDDY_MEMORY_FORGET_BASE_DAYS: '30',
      CODEBUDDY_MEMORY_FORGET_THRESHOLD: '2',
      CODEBUDDY_MEMORY_FORGET_MIN_AGE_DAYS: '3',
    } as NodeJS.ProcessEnv);
    expect(resolved.baseStabilityDays).toBe(30);
    expect(resolved.retentionThreshold).toBe(0.9); // clamped — 2 would forget everything
    expect(resolved.minAgeDays).toBe(3);
    expect(resolveForgettingConfig({} as NodeJS.ProcessEnv)).toEqual(DEFAULT_FORGETTING_CONFIG);
  });
});

describe('persistent memory — reinforcement round-trip', () => {
  it('recall reinforcement survives a save/load cycle via the meta comment', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'forget-'));
    const first = await makeManager(dir);
    await first.remember('train-time', 'départ 9h', { category: 'context' });
    await first.remember('untouched', 'jamais rappelée', { category: 'context' });
    first.recall('train-time');
    first.recall('train-time');
    first.recall('train-time');
    await first.flushAccessMetadata();

    const second = await makeManager(dir);
    const byKey = new Map(second.getRecentMemories(10, 'project').map((m) => [m.key, m]));
    expect(byKey.get('train-time')!.accessCount).toBe(3);
    expect(byKey.get('train-time')!.lastAccessedAt).toBeInstanceOf(Date);
    expect(byKey.get('untouched')!.accessCount).toBe(0);
    expect(byKey.get('untouched')!.lastAccessedAt).toBeUndefined();
  });

  it('getRelevantMemories reinforces the returned hits only', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'forget-'));
    const manager = await makeManager(dir);
    await manager.remember('depart-train', 'le train part à 9h', { category: 'context' });
    await manager.remember('meteo', 'il pleut demain', { category: 'context' });

    const hits = manager.getRelevantMemories('train');
    expect(hits.map((m) => m.key)).toEqual(['depart-train']);

    const byKey = new Map(manager.getRecentMemories(10, 'project').map((m) => [m.key, m]));
    expect(byKey.get('depart-train')!.accessCount).toBe(1);
    expect(byKey.get('meteo')!.accessCount).toBe(0);
  });

  it('pre-feature files without meta comments still parse with fresh defaults', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'forget-'));
    const legacy = [
      '# Code Buddy Memory',
      '',
      '## Context',
      '- **legacy-key**: legacy value',
      '',
    ].join('\n');
    await writeFile(path.join(dir, 'CODEBUDDY_MEMORY.md'), legacy);
    const manager = await makeManager(dir);
    expect(manager.recall('legacy-key')).toBe('legacy value');
    const [entry] = manager.getRecentMemories(1, 'project');
    expect(entry!.accessCount).toBe(1); // the recall above
  });
});

describe('persistent memory — applyForgetting (recoverable)', () => {
  it('archives then removes faded memories; reinforced and protected ones survive', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'forget-'));
    const manager = await makeManager(dir);
    await manager.remember('stale-note', 'un détail sans suite', { category: 'context' });
    await manager.remember('used-note', 'rappelée souvent', { category: 'context' });
    await manager.remember('arch-choice', 'on garde ESM', { category: 'decisions' });
    for (let i = 0; i < 10; i++) manager.recall('used-note');

    const events: string[] = [];
    manager.on('memory:forgotten', (e: { key: string }) => events.push(e.key));

    // 60 days later: stale (0 recalls) fades, used (10 recalls) holds, decision is protected.
    const result = await manager.applyForgetting('project', { now: new Date(Date.now() + 60 * DAY) });
    expect(result.forgotten.map((c) => c.key)).toEqual(['stale-note']);
    expect(events).toEqual(['stale-note']);

    const file = await readFile(path.join(dir, 'CODEBUDDY_MEMORY.md'), 'utf8');
    expect(file).not.toContain('stale-note');
    expect(file).toContain('used-note');
    expect(file).toContain('arch-choice');

    // Never rm: the archive holds the full entry, recoverable by hand.
    const archive = await readFile(path.join(dir, 'CODEBUDDY_MEMORY.archive.md'), 'utf8');
    expect(archive).toContain('stale-note');
    expect(archive).toContain('un détail sans suite');

    const reloaded = await makeManager(dir);
    expect(reloaded.recall('stale-note')).toBeNull();
    expect(reloaded.recall('used-note')).toBe('rappelée souvent');
  });

  it('fail-closed: when the archive cannot be written, nothing is deleted', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'forget-'));
    const manager = await makeManager(dir);
    await manager.remember('precious', 'ne jamais perdre', { category: 'context' });
    // A directory at the archive path makes appendFile fail (EISDIR).
    await mkdir(path.join(dir, 'CODEBUDDY_MEMORY.archive.md'));

    const result = await manager.applyForgetting('project', { now: new Date(Date.now() + 365 * DAY) });
    expect(result.forgotten).toEqual([]);
    expect(manager.recall('precious')).toBe('ne jamais perdre');
  });
});

describe('dreaming — forgetting pass wiring', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('runs the injected pass when enabled, skips it under the default env gate', async () => {
    vi.stubEnv('CODEBUDDY_MEMORY_FORGET', '');
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'dream-forget-'));
    const forget = vi.fn(async () => {});

    getSensoryMemory().push({ modality: 'vital', kind: 'heartbeat', salience: 5, receivedAt: 1, payload: {} });
    await runDreamingPass({ cwd: tmp, promote: async () => {}, forget, forgettingEnabled: true });
    expect(forget).toHaveBeenCalledTimes(1);

    getSensoryMemory().push({ modality: 'vital', kind: 'heartbeat', salience: 5, receivedAt: 2, payload: {} });
    await runDreamingPass({ cwd: tmp, promote: async () => {}, forget }); // env off → no pass
    expect(forget).toHaveBeenCalledTimes(1);
  });
});
