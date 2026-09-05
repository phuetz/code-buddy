import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/memory/facts-memory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/facts-memory.js')>();
  return {
    ...actual,
    FactsMemoryService: class {
      async isAvailable(): Promise<boolean> {
        return true;
      }

      async reconcileFacts(
        currentFacts: Array<{ category: string; text: string }>,
        newFacts: Array<{ category: string; text: string }>,
      ): Promise<Array<{ category: string; text: string }>> {
        const reconciled = newFacts.map((fact) => fact.text.startsWith('sans-cle: ')
          ? { ...fact, text: 'fait réconcilié sans séparateur de clé' }
          : fact);
        return [...currentFacts, ...reconciled];
      }
    },
  };
});

import {
  getMemoryManager,
  PersistentMemoryManager,
  resetMemoryManagerForTests,
} from '../../src/memory/persistent-memory.js';
import { RememberTool } from '../../src/tools/registry/memory-tools.js';

const testRoot = path.join(process.cwd(), '.r28-tests');

describe('R28 D1/D9 — résultat fidèle de remember', () => {
  let dir: string;

  beforeEach(() => {
    fs.mkdirSync(testRoot, { recursive: true });
    dir = fs.mkdtempSync(path.join(testRoot, 'remember-integrity-'));
    resetMemoryManagerForTests();
  });

  afterEach(() => {
    resetMemoryManagerForTests();
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.rmdirSync(testRoot);
    } catch {
      // Un autre test R28 peut encore utiliser la racine partagée.
    }
  });

  it('D1 : RememberTool rend success:false et la cause quand le magasin reste illisible', async () => {
    const unreadableStore = path.join(dir, 'memory.md');
    fs.mkdirSync(unreadableStore);
    getMemoryManager({
      projectMemoryPath: path.join(dir, 'project.md'),
      userMemoryPath: unreadableStore,
      autoCapture: false,
    });

    const result = await new RememberTool().execute({
      key: 'nouveau',
      value: 'valeur récente',
      scope: 'user',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unreadable|persistence was refused/i);
    expect(fs.statSync(unreadableStore).isDirectory()).toBe(true);
  });

  it('D9 : une clé longue conservée par la réconciliation reste la clé annoncée et lisible', async () => {
    const manager = new PersistentMemoryManager({
      projectMemoryPath: path.join(dir, 'project.md'),
      userMemoryPath: path.join(dir, 'user.md'),
      autoCapture: false,
    });
    await manager.initialize();
    const key = 'user-preferred-typescript-strict-compiler-options-extra-longue';

    const result = await manager.remember(key, 'strict et noUncheckedIndexedAccess', { scope: 'project' });

    expect(result.key).toBe(key);
    expect(manager.get(result.key, 'project')?.value).toBe('strict et noUncheckedIndexedAccess');
  });

  it('D9 : si la réconciliation fabrique une clé, remember rend cette clé réelle', async () => {
    const projectPath = path.join(dir, 'project.md');
    const manager = new PersistentMemoryManager({
      projectMemoryPath: projectPath,
      userMemoryPath: path.join(dir, 'user.md'),
      autoCapture: false,
    });
    await manager.initialize();

    const result = await manager.remember('sans-cle', 'valeur', { scope: 'project' });

    expect(result.key).toMatch(/^fact-/);
    expect(manager.get(result.key, 'project')?.value).toBe('fait réconcilié sans séparateur de clé');
    expect(fs.readFileSync(projectPath, 'utf8')).toContain(`**${result.key}**`);
    expect(result.message).toContain(result.key);
  });
});
