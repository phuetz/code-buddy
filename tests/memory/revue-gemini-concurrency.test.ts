/**
 * Preuve du trou logique : une course entre deux processus sur le même fichier de mémoire persistante.
 *
 * Mécanisme (src/memory/persistent-memory.ts:1320-1325) :
 * `saveMemories` effectue une écriture directe sans verrou de fichier ni renommage atomique :
 *   await fs.ensureDir(path.dirname(filePath));
 *   await fs.writeFile(filePath, content);
 *
 * Contrairement à d'autres modules (ex: `session-store.ts` avec `withSessionLock`),
 * si deux processus (ex: serveur compagnon 24/7 et commande CLI ponctuelle, ou deux
 * sous-agents) manipulent simultanément le même fichier de mémoire, les écritures
 * s'écrasent (last-writer-wins sans rechargement préalable ni fusion atomique).
 * Le souvenir écrit par le premier processus est silencieusement pulvérisé par le second.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import fs from 'fs-extra';
import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';

describe('Revue G3 — Mémoire persistante : course concurrente sans verrouillage de fichier', () => {
  let tmpDir: string;
  let projectMemoryPath: string;
  let userMemoryPath: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `cb-revue-race-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.ensureDir(tmpDir);
    projectMemoryPath = path.join(tmpDir, 'project_memory.md');
    userMemoryPath = path.join(tmpDir, 'user_memory.md');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('perd un souvenir lorsqu’un second processus écrit en parallèle sans verrouiller le fichier', async () => {
    // Processus A (ex: CLI code-buddy)
    const procA = new PersistentMemoryManager({
      projectMemoryPath,
      userMemoryPath,
      autoCapture: false,
    });
    await procA.initialize();

    // Processus B (ex: démon buddy server toujours actif)
    const procB = new PersistentMemoryManager({
      projectMemoryPath,
      userMemoryPath,
      autoCapture: false,
    });
    await procB.initialize();

    // Le processus A enregistre une information importante
    await procA.remember('fact-from-proc-A', 'Token de session critique', { scope: 'project' });
    await (procA as any).saveMemories('project');

    // Simultanément ou juste après, le processus B écrit sans avoir rechargé le disque
    await procB.remember('fact-from-proc-B', 'Port de déploiement 8080', { scope: 'project' });
    await (procB as any).saveMemories('project');

    // Un troisième processus arbitre relit le fichier disque
    const procVerifier = new PersistentMemoryManager({
      projectMemoryPath,
      userMemoryPath,
      autoCapture: false,
    });
    await procVerifier.initialize();

    const valueA = procVerifier.recall('fact-from-proc-A', 'project');
    const valueB = procVerifier.recall('fact-from-proc-B', 'project');

    // Dans un système concurrent sain, AUCUN souvenir ne doit être écrasé ou perdu
    expect(valueA).toBe('Token de session critique');
    expect(valueB).toBe('Port de déploiement 8080');
  });
});
