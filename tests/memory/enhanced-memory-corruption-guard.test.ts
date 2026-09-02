import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const homeHolder = vi.hoisted(() => ({ dir: '' }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => homeHolder.dir,
    default: { ...actual, homedir: () => homeHolder.dir },
  };
});

import { EnhancedMemory } from '../../src/memory/enhanced-memory.js';

const testRoot = path.join(process.cwd(), '.r28-tests');

describe('R28 D6/D8 — EnhancedMemory refuse un état non chargé', () => {
  let home: string;
  let memory: EnhancedMemory | null;

  beforeEach(() => {
    fs.mkdirSync(testRoot, { recursive: true });
    home = fs.mkdtempSync(path.join(testRoot, 'enhanced-corrupt-'));
    homeHolder.dir = home;
    memory = null;
  });

  afterEach(async () => {
    memory?.dispose();
    try {
      await memory?.flush();
    } catch {
      // L’état corrompu doit précisément interdire ce flush.
    }
    memory = null;
    fs.rmSync(home, { recursive: true, force: true });
    try {
      fs.rmdirSync(testRoot);
    } catch {
      // Un autre test R28 peut encore utiliser la racine partagée.
    }
  });

  it('D6 : un index JSON corrompu fait échouer store sans écraser le fichier', async () => {
    const dataDir = path.join(home, '.codebuddy', 'memory');
    fs.mkdirSync(path.join(dataDir, 'projects'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'memories'), { recursive: true });
    const indexPath = path.join(dataDir, 'memory-index.json');
    const corrupt = '{"ancien":';
    fs.writeFileSync(indexPath, corrupt);

    memory = new EnhancedMemory({ useSQLite: false, embeddingEnabled: false });
    let failure: unknown;
    try {
      await memory.store({ type: 'fact', content: 'nouveau souvenir' });
    } catch (err) {
      failure = err;
    }

    expect(fs.readFileSync(indexPath, 'utf8')).toBe(corrupt);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/memory-index|JSON|initialize/i);
  });

  it('D8 : un initialize incomplet rejette whenReady/store et préserve l’index existant', async () => {
    const dataDir = path.join(home, '.codebuddy', 'memory');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'projects'), 'bloque mkdir');
    const indexPath = path.join(dataDir, 'memory-index.json');
    const oldIndex = JSON.stringify([{ id: 'ancien', content: 'historique précieux' }]);
    fs.writeFileSync(indexPath, oldIndex);

    memory = new EnhancedMemory({ useSQLite: false, embeddingEnabled: false });

    await expect(memory.whenReady()).rejects.toThrow();
    await expect(memory.store({ type: 'fact', content: 'nouveau souvenir' })).rejects.toThrow();
    expect(fs.readFileSync(indexPath, 'utf8')).toBe(oldIndex);
  });
});
