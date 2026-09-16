/**
 * Preuve du trou logique : l'oubli d'Ebbinghaus qui archive une préférence épinglée ou décision.
 *
 * Mécanismes prouvés :
 * 1. src/memory/persistent-memory.ts:508-535 & src/memory/facts-memory.ts:
 *    Lors de la réconciliation de faits par FactsMemoryService, la catégorie
 *    est typée 'Preferences' (majuscule issue de FactCategorySchema) et stockée
 *    telle quelle dans la mémoire.
 *    Or DEFAULT_FORGETTING_CONFIG (src/memory/memory-forgetting.ts:46) protège
 *    uniquement 'preferences' (minuscule).
 *    De surcroît, les tags sont écrasés par `action.fact.source ? [action.fact.source] : tags`
 *    (ex: ['reconciliation']), supprimant le tag 'pinned'.
 *    Résultat : `cfg.protectedCategories.has('Preferences')` vaut `false`,
 *    `cfg.protectedTags.has('pinned')` vaut `false`, et la préférence épinglée
 *    est archivée par l'oubli d'Ebbinghaus.
 * 2. src/memory/persistent-memory.ts:1197-1215 (`forgetOlderThan`) :
 *    `forgetOlderThan(days, scope)` supprime inconditionnellement les mémoires
 *    plus vieilles que le cutoff, ignorant totalement les catégories protégées
 *    ('preferences', 'decisions') et les tags protégés ('pinned').
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import fs from 'fs-extra';
import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';

describe('Revue G3 — Oubli d’Ebbinghaus : archivage de préférences épinglées et décisions', () => {
  let tmpDir: string;
  let projectMemoryPath: string;
  let userMemoryPath: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `cb-revue-forget-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.ensureDir(tmpDir);
    projectMemoryPath = path.join(tmpDir, 'project_memory.md');
    userMemoryPath = path.join(tmpDir, 'user_memory.md');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('archive une préférence épinglée dont la casse de catégorie ("Preferences") ou les tags ont été altérés par la réconciliation', async () => {
    const manager = new PersistentMemoryManager({
      projectMemoryPath,
      userMemoryPath,
      autoCapture: false,
    });
    await manager.initialize();

    // Simulation d'une préférence réconciliée par FactsMemoryService avec 'Preferences' majuscule
    // et source écrasée en 'reconciliation' au lieu de conserver 'pinned'
    (manager as any).setMemoryDirect(
      (manager as any).userMemories,
      'user-color-pref',
      'dark mode only',
      'Preferences' as any, // Casse issue de FactCategorySchema
      ['reconciliation'], // Tag 'pinned' perdu lors de la réconciliation
    );

    const memory = manager.get('user-color-pref', 'user');
    expect(memory).not.toBeNull();

    // 60 jours plus tard sans accès : l'algorithme d'Ebbinghaus ne doit JAMAIS archiver une préférence
    const now60d = new Date(Date.now() + 60 * 86_400_000);
    const result = await manager.applyForgetting('user', { now: now60d });

    // Le test exige que la préférence soit préservée (non archivée)
    expect(result.forgotten.map((f) => f.key)).not.toContain('user-color-pref');
    expect(manager.recall('user-color-pref', 'user')).toBe('dark mode only');
  });

  it('forgetOlderThan supprime brutalement les préférences épinglées sans respecter les catégories et tags protégés', async () => {
    const manager = new PersistentMemoryManager({
      projectMemoryPath,
      userMemoryPath,
      autoCapture: false,
    });
    await manager.initialize();

    await manager.remember('pinned-preference', 'keep this forever', {
      scope: 'project',
      category: 'preferences',
      tags: ['pinned'],
    });

    // Vieillir artificiellement le souvenir de 100 jours
    const memory = (manager as any).projectMemories.get('pinned-preference');
    memory.updatedAt = new Date(Date.now() - 100 * 86_400_000);

    // Exécuter l'oubli basé sur l'âge
    await manager.forgetOlderThan(30, 'project');

    // Une préférence marquée 'pinned' ne doit JAMAIS être purgée par l'oubli
    expect(manager.recall('pinned-preference', 'project')).toBe('keep this forever');
  });
});
