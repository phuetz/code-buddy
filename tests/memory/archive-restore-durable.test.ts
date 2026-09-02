import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';

const DAY = 86_400_000;
const testRoot = path.join(process.cwd(), '.r28-tests');

describe('R28 D3 — restauration durable depuis l’archive', () => {
  let dir: string;
  let livePath: string;
  let archivePath: string;

  beforeEach(() => {
    fs.mkdirSync(testRoot, { recursive: true });
    dir = fs.mkdtempSync(path.join(testRoot, 'archive-durable-'));
    livePath = path.join(dir, 'CODEBUDDY_MEMORY.md');
    archivePath = path.join(dir, 'CODEBUDDY_MEMORY.archive.md');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.rmdirSync(testRoot);
    } catch {
      // Un autre test R28 peut encore utiliser la racine partagée.
    }
  });

  it('conserve l’archive si la sauvegarde live résout sans avoir écrit le souvenir', async () => {
    const manager = new PersistentMemoryManager({
      projectMemoryPath: livePath,
      userMemoryPath: path.join(dir, 'memory.md'),
      autoCapture: false,
    });
    await manager.initialize();
    await manager.remember('revive-me', 'souvenir irremplaçable', { scope: 'project' });
    await manager.applyForgetting('project', { now: new Date(Date.now() + 365 * DAY) });

    const archiveBefore = fs.readFileSync(archivePath, 'utf8');
    const liveBefore = fs.readFileSync(livePath, 'utf8');

    // Reproduit un stockage qui annonce sa résolution sans rendre l’écriture
    // visible : restoreFromArchive doit relire le live avant de nettoyer.
    const writable = manager as unknown as {
      saveMemories(scope: 'project' | 'user'): Promise<void>;
    };
    vi.spyOn(writable, 'saveMemories').mockResolvedValue(undefined);

    await expect(manager.restoreFromArchive('revive-me', 'project')).rejects.toThrow(
      /not durably persisted|pas été persisté/i,
    );
    expect(fs.readFileSync(archivePath, 'utf8')).toBe(archiveBefore);
    expect(fs.readFileSync(livePath, 'utf8')).toBe(liveBefore);
    expect(fs.readFileSync(archivePath, 'utf8')).toContain('revive-me');
  });
});
