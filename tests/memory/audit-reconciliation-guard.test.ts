import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';
import { FactsMemoryService } from '../../src/memory/facts-memory.js';

let dir: string;
let manager: PersistentMemoryManager;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-reconcile-guard-'));
  manager = new PersistentMemoryManager({ projectMemoryPath: path.join(dir, 'project.md'), userMemoryPath: path.join(dir, 'user.md'), autoCapture: true });
  await manager.initialize();
  await manager.remember('protected', 'keep this', { tags: ['pinned'], category: 'preferences' });
  await manager.remember('obsolete', 'recover this', { category: 'context' });
  vi.spyOn(FactsMemoryService.prototype, 'isAvailable').mockResolvedValue(true);
  vi.spyOn(FactsMemoryService.prototype, 'reconcileFacts').mockImplementation(async (_old, added) => added);
  vi.spyOn(FactsMemoryService.prototype, 'extractFacts').mockResolvedValue([{ category: 'Projet', text: 'new: new note' }]);
});
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(dir, { recursive: true, force: true }); });

it.each(['remember', 'autoCapture'] as const)('%s protects pinned memories and archives removed ordinary memories', async (method) => {
  if (method === 'remember') await manager.remember('new', 'new note');
  else await manager.autoCapture('a new fact', 'noted');
  expect(manager.get('protected', 'project')?.value).toBe('keep this');
  expect(manager.get('obsolete', 'project')).toBeUndefined();
  expect(await fs.readFile(path.join(dir, 'project.archive.md'), 'utf8')).toContain('recover this');
  expect(await fs.readFile(path.join(dir, 'project.md'), 'utf8')).toContain('keep this');
});

it('keeps old memory in RAM and on disk if archiving fails', async () => {
  await fs.mkdir(path.join(dir, 'project.archive.md'));
  await manager.remember('new', 'new note');
  expect(manager.get('obsolete', 'project')?.value).toBe('recover this');
  expect(await fs.readFile(path.join(dir, 'project.md'), 'utf8')).toContain('recover this');
});

it('does not let an automatic UPDATE remove protection or replace a pinned fact', async () => {
  vi.mocked(FactsMemoryService.prototype.reconcileFacts).mockResolvedValue([
    { category: 'Projet', text: 'protected: different value' },
    { category: 'Projet', text: 'new: new note' },
  ]);
  await manager.remember('new', 'new note');
  expect(manager.get('protected', 'project')).toMatchObject({ value: 'keep this', category: 'preferences', tags: ['pinned'] });
});

it('restores an automatically archived fact through the normal archive API', async () => {
  await manager.remember('new', 'new note');
  vi.mocked(FactsMemoryService.prototype.isAvailable).mockResolvedValue(false);
  expect((await manager.listArchived('project')).find(entry => entry.key === 'obsolete')?.value).toBe('recover this');
  await manager.restoreFromArchive('obsolete', 'project');
  expect(manager.get('obsolete', 'project')?.value).toBe('recover this');
  expect((await manager.listArchived('project')).some(entry => entry.key === 'obsolete')).toBe(false);
});

it('rolls back autoCapture when the archive cannot be written', async () => {
  await fs.mkdir(path.join(dir, 'project.archive.md'));
  await manager.autoCapture('a new fact', 'noted');
  expect(manager.get('obsolete', 'project')?.value).toBe('recover this');
  expect(await fs.readFile(path.join(dir, 'project.md'), 'utf8')).toContain('recover this');
});
