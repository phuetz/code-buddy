import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';

const testRoot = path.join(process.cwd(), '.r28-tests');

describe('R28 D5 — archive illisible', () => {
  let dir: string;

  beforeEach(() => {
    fs.mkdirSync(testRoot, { recursive: true });
    dir = fs.mkdtempSync(path.join(testRoot, 'archive-read-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.rmdirSync(testRoot);
    } catch {
      // Un autre test R28 peut encore utiliser la racine partagée.
    }
  });

  it('distingue une archive absente d’une archive impossible à lire', async () => {
    const livePath = path.join(dir, 'CODEBUDDY_MEMORY.md');
    const archivePath = path.join(dir, 'CODEBUDDY_MEMORY.archive.md');
    const manager = new PersistentMemoryManager({
      projectMemoryPath: livePath,
      userMemoryPath: path.join(dir, 'memory.md'),
      autoCapture: false,
    });
    await manager.initialize();

    await expect(manager.listArchived('project')).resolves.toEqual([]);

    fs.mkdirSync(archivePath);
    await expect(manager.listArchived('project')).rejects.toThrow(/archive.*unreadable|archive.*illisi/i);
    await expect(manager.restoreFromArchive('precieux', 'project')).rejects.toThrow(/archive.*unreadable|archive.*illisi/i);
    expect(fs.statSync(archivePath).isDirectory()).toBe(true);
  });
});
