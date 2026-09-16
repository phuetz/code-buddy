/**
 * Preuve du trou logique : un souvenir écrit puis relu différent.
 *
 * Mécanisme (src/memory/persistent-memory.ts:436-437) :
 * Lors de la relecture d'un souvenir multi-ligne :
 *   if (inMemoryBlock && line.startsWith("  ")) {
 *     currentValue += "\n" + line.trim();
 *   }
 * L'appel à `line.trim()` détruit toute indentation interne (code, YAML, listes).
 * De plus, si le contenu d'un souvenir contient une ligne "  Tags: ...", elle est
 * avalée par le parseur de tags (ligne 426) et supprimée de la valeur du souvenir.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import fs from 'fs-extra';
import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';

describe('Revue G3 — Mémoire persistante : altération au rechargement', () => {
  let tmpDir: string;
  let projectMemoryPath: string;
  let userMemoryPath: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `cb-revue-roundtrip-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.ensureDir(tmpDir);
    projectMemoryPath = path.join(tmpDir, 'project_memory.md');
    userMemoryPath = path.join(tmpDir, 'user_memory.md');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('altère l’indentation d’un souvenir multi-ligne (code, configuration) après un cycle écriture/relecture', async () => {
    const manager1 = new PersistentMemoryManager({
      projectMemoryPath,
      userMemoryPath,
      autoCapture: false,
    });
    await manager1.initialize();

    const indentedCode = [
      'function computeTotal(items) {',
      '  let total = 0;',
      '  for (const item of items) {',
      '    total += item.price;',
      '  }',
      '  return total;',
      '}',
    ].join('\n');

    await manager1.remember('helper-fn', indentedCode, { scope: 'project' });

    // Immédiatement en mémoire, la valeur est intacte
    expect(manager1.recall('helper-fn', 'project')).toBe(indentedCode);

    // Nouveau gestionnaire (redémarrage du processus / relecture disque)
    const manager2 = new PersistentMemoryManager({
      projectMemoryPath,
      userMemoryPath,
      autoCapture: false,
    });
    await manager2.initialize();

    const reloaded = manager2.recall('helper-fn', 'project');

    // Le test exige la fidélité exacte du round-trip : le code ne doit pas être altéré
    expect(reloaded).toBe(indentedCode);
  });

  it('avale une ligne de contenu ressemblant à une balise de métadonnées ("  Tags: ...")', async () => {
    const manager1 = new PersistentMemoryManager({
      projectMemoryPath,
      userMemoryPath,
      autoCapture: false,
    });
    await manager1.initialize();

    const noteWithTagsLine = [
      'Analyse du système :',
      '  Tags: important, critique',
      'Conclusion : opérationnel.',
    ].join('\n');

    await manager1.remember('audit-note', noteWithTagsLine, { scope: 'project' });

    const manager2 = new PersistentMemoryManager({
      projectMemoryPath,
      userMemoryPath,
      autoCapture: false,
    });
    await manager2.initialize();

    const reloaded = manager2.recall('audit-note', 'project');
    expect(reloaded).toBe(noteWithTagsLine);
  });
});
