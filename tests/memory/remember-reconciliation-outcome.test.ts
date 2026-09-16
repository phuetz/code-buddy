/**
 * Recette slash 2026-09-14 — /remember test_key test_valeur a bien persisté
 * clé et valeur, mais la capture affichait « Failed to reconcile facts » à côté
 * d'un « Remembered » sans nuance. remember() doit distinguer l'écriture
 * primaire (réussie) de la réconciliation (échouée, repli d'écriture directe)
 * et préserver les souvenirs déjà stockés.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mode = vi.hoisted(() => ({ value: 'fail' as 'fail' | 'apply' | 'unavailable' }));

vi.mock('../../src/memory/facts-memory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/facts-memory.js')>();
  return {
    ...actual,
    FactsMemoryService: class {
      async isAvailable(): Promise<boolean> {
        return mode.value !== 'unavailable';
      }

      async reconcileFacts(
        currentFacts: Array<{ category: string; text: string }>,
        newFacts: Array<{ category: string; text: string }>,
      ): Promise<Array<{ category: string; text: string }>> {
        if (mode.value === 'fail') {
          throw new Error('Failed to generate valid JSON after 2 retries: 400 "Incorrect API key provided."');
        }
        return [...currentFacts, ...newFacts];
      }
    },
  };
});

import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';

describe('remember() — issue de la réconciliation séparée de l\'écriture primaire', () => {
  let dir: string;
  let projectPath: string;
  let manager: PersistentMemoryManager;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-remember-outcome-'));
    projectPath = path.join(dir, 'project.md');
    mode.value = 'apply';
    manager = new PersistentMemoryManager({
      projectMemoryPath: projectPath,
      userMemoryPath: path.join(dir, 'user.md'),
      autoCapture: false,
    });
    await manager.initialize();
    await manager.remember('existing', 'deja stocke', { scope: 'project', category: 'custom' });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports a failed reconciliation, still stores the new memory and keeps the existing ones', async () => {
    mode.value = 'fail';

    const result = await manager.remember('test_key', 'test_valeur', { scope: 'project', category: 'custom' });

    expect(result.status).toBe('stored');
    expect(result.key).toBe('test_key');
    expect(result.reconciliation?.status).toBe('failed');
    expect(result.reconciliation?.reason).toContain('Incorrect API key provided');
    expect(manager.get('test_key', 'project')?.value).toBe('test_valeur');
    expect(manager.get('existing', 'project')?.value).toBe('deja stocke');
    const onDisk = fs.readFileSync(projectPath, 'utf8');
    expect(onDisk).toContain('test_valeur');
    expect(onDisk).toContain('deja stocke');
  });

  it('marks an applied reconciliation', async () => {
    const result = await manager.remember('other', 'value', { scope: 'project', category: 'custom' });

    expect(result.reconciliation?.status).toBe('applied');
    expect(manager.get('existing', 'project')?.value).toBe('deja stocke');
  });

  it('marks the reconciliation as skipped when no provider is available', async () => {
    mode.value = 'unavailable';

    const result = await manager.remember('other', 'value', { scope: 'project', category: 'custom' });

    expect(result.reconciliation?.status).toBe('skipped');
    expect(manager.get('other', 'project')?.value).toBe('value');
  });
});
