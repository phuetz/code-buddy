/**
 * Ebbinghaus archive restore — listArchived / restoreFromArchive + the
 * /memory archived|restore slash surface. Real files in a temp dir; the
 * archive is produced by the REAL applyForgetting pass (no hand-forged
 * archive content except the multi-version case, which reuses the pass twice).
 *
 * Completes the "recoverable archive" promise: applyForgetting archives
 * before deleting; this proves the way BACK.
 */
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';

const DAY = 86_400_000;

async function makeManager(dir: string): Promise<PersistentMemoryManager> {
  const manager = new PersistentMemoryManager({
    projectMemoryPath: path.join(dir, 'CODEBUDDY_MEMORY.md'),
    userMemoryPath: path.join(dir, 'memory.md'),
    autoCapture: false,
  });
  await manager.initialize();
  return manager;
}

describe('archive restore (recoverable forgetting)', () => {
  let dir: string;
  let manager: PersistentMemoryManager;
  const archiveFile = (): string => path.join(dir, 'CODEBUDDY_MEMORY.archive.md');

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-restore-'));
    manager = await makeManager(dir);
  });

  afterEach(async () => {
    await fs.remove(dir);
  });

  /** Store an entry then let the REAL forgetting pass archive it. */
  async function forget(key: string, value: string, tags?: string[]): Promise<void> {
    await manager.remember(key, value, { scope: 'project', category: 'context', ...(tags ? { tags } : {}) });
    const { forgotten } = await manager.applyForgetting('project', { now: new Date(Date.now() + 365 * DAY) });
    expect(forgotten.map((f) => f.key)).toContain(key);
  }

  it('listArchived surfaces what the forgetting pass archived (with tags), newest first', async () => {
    await forget('old-fact', 'the build takes twelve minutes', ['build', 'perf']);

    const archived = await manager.listArchived();
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({
      key: 'old-fact',
      value: 'the build takes twelve minutes',
      category: 'context',
      tags: ['build', 'perf'],
      scope: 'project',
    });
    expect(archived[0]!.forgottenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // And the entry is really gone from live memory.
    expect(manager.get('old-fact')).toBeUndefined();
  });

  it('restoreFromArchive brings the entry back live and cleans the archive', async () => {
    await forget('revive-me', 'value worth keeping');

    const restored = await manager.restoreFromArchive('revive-me');
    expect(restored?.result.status).toBe('stored');
    expect(restored?.restored.scope).toBe('project');

    // Live again — in memory AND on disk.
    expect(manager.get('revive-me')?.value).toBe('value worth keeping');
    expect(await fs.readFile(path.join(dir, 'CODEBUDDY_MEMORY.md'), 'utf-8')).toContain('revive-me');

    // The archive no longer lists it (line removed, empty section dropped).
    expect(await manager.listArchived()).toHaveLength(0);
    const raw = await fs.readFile(archiveFile(), 'utf-8');
    expect(raw).not.toContain('revive-me');
    expect(raw).not.toContain('## Forgotten');

    // A fresh manager on the same files agrees (persistence, not in-process state).
    const fresh = await makeManager(dir);
    expect(fresh.get('revive-me')?.value).toBe('value worth keeping');
  });

  it('round-trips a multiline value through forget, archive listing, and restore', async () => {
    const value = 'first line\nsecond line with literal \\n marker\nthird line';
    await forget('multiline', value);

    const archived = await manager.listArchived('project');
    expect(archived).toHaveLength(1);
    expect(archived[0]!.value).toBe(value);

    const restored = await manager.restoreFromArchive('multiline', 'project');
    expect(restored?.result.status).toBe('stored');
    expect(restored?.restored.value).toBe(value);
    expect(manager.get('multiline')?.value).toBe(value);
    expect(await manager.listArchived('project')).toHaveLength(0);
  });

  it('returns null for a key that was never archived', async () => {
    expect(await manager.restoreFromArchive('never-forgotten')).toBeNull();
  });

  it('restores the LATEST archived version when a key was forgotten twice', async () => {
    await forget('versioned', 'v1 of the fact');
    await forget('versioned', 'v2 of the fact');

    const restored = await manager.restoreFromArchive('versioned');
    expect(restored?.restored.value).toBe('v2 of the fact');
    expect(manager.get('versioned')?.value).toBe('v2 of the fact');
    // v1 stays archived (only the restored line was removed).
    const remaining = await manager.listArchived();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.value).toBe('v1 of the fact');
  });

  it('leaves the archive untouched when the key is already live with the same content', async () => {
    await forget('duplicated', 'same content');
    // Re-learn it manually before restoring.
    await manager.remember('duplicated', 'same content', { scope: 'project', category: 'context' });

    const restored = await manager.restoreFromArchive('duplicated');
    expect(restored?.result.status).toBe('duplicate');
    // Archive keeps its audit line — nothing was removed.
    expect(await manager.listArchived()).toHaveLength(1);
  });

  it('the /memory archived and /memory restore slash actions drive the real manager', async () => {
    const { getMemoryManager, resetMemoryManagerForTests } = await import('../../src/memory/persistent-memory.js');
    resetMemoryManagerForTests();
    const singleton = getMemoryManager({
      projectMemoryPath: path.join(dir, 'CODEBUDDY_MEMORY.md'),
      userMemoryPath: path.join(dir, 'memory.md'),
      autoCapture: false,
    });
    await singleton.initialize();
    await singleton.remember('slash-fact', 'restorable over slash', { scope: 'project', category: 'context' });
    await singleton.applyForgetting('project', { now: new Date(Date.now() + 365 * DAY) });

    const { handleMemory } = await import('../../src/commands/handlers/memory-handlers.js');
    const text = (r: { entry?: { content?: unknown } }): string => String(r.entry?.content ?? '');
    const listed = await handleMemory(['archived']);
    expect(text(listed)).toContain('slash-fact');

    const restored = await handleMemory(['restore', 'slash-fact']);
    expect(text(restored)).toContain('Restored "slash-fact"');
    expect(singleton.get('slash-fact')?.value).toBe('restorable over slash');

    const empty = await handleMemory(['archived']);
    expect(text(empty)).toContain('Archive is empty');
    resetMemoryManagerForTests();
  });
});
