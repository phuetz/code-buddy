/**
 * Audit 2026-09-02 — famille « faux succès » (E3b) :
 * une erreur de lecture TRANSITOIRE (EACCES…) au chargement était avalée
 * (« start fresh ») ; la sauvegarde suivante réécrivait le fichier entier
 * depuis l'état vide — amnésie totale silencieuse de la ressource la plus
 * précieuse du compagnon. Attendu : après un échec de load non-ENOENT, le
 * prochain save recharge d'abord le fichier (fusion, RAM prioritaire) ; s'il
 * reste illisible, il REFUSE d'écraser (fail-closed, comme l'archive
 * d'oubli).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe.skipIf(process.platform === 'win32' || isRoot)('mémoire persistante — garde anti-amnésie', () => {
  it('un load en échec transitoire ne conduit pas à écraser le fichier au save suivant', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-amnesia-'));
    const userPath = path.join(dir, 'U.md');
    const cfg = { projectMemoryPath: path.join(dir, 'P.md'), userMemoryPath: userPath };
    try {
      // Un historique précieux existe.
      const seed = new PersistentMemoryManager(cfg);
      await seed.initialize();
      await seed.remember('precieux', 'souvenir historique irremplaçable', { scope: 'user' });

      // Erreur transitoire : fichier illisible au chargement…
      fs.chmodSync(userPath, 0o000);
      const b = new PersistentMemoryManager(cfg);
      await b.initialize();
      // …puis la permission revient (le NFS remonte, le chmod est corrigé…).
      fs.chmodSync(userPath, 0o644);

      await b.remember('nouveau', 'valeur récente', { scope: 'user' });

      const onDisk = fs.readFileSync(userPath, 'utf8');
      expect(onDisk).toContain('souvenir historique irremplaçable');
      expect(onDisk).toContain('valeur récente');
    } finally {
      try { fs.chmodSync(userPath, 0o644); } catch { /* déjà fait */ }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuse d\'écraser un fichier encore illisible même s\'il reste inscriptible', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-amnesia-writable-'));
    const userPath = path.join(dir, 'U.md');
    const cfg = { projectMemoryPath: path.join(dir, 'P.md'), userMemoryPath: userPath };
    try {
      const seed = new PersistentMemoryManager(cfg);
      await seed.initialize();
      await seed.remember('precieux', 'souvenir historique irremplaçable', { scope: 'user' });
      const before = fs.readFileSync(userPath, 'utf8');

      fs.writeFileSync(userPath, 'this is not canonical memory markdown\n');
      const b = new PersistentMemoryManager(cfg);
      await b.initialize();
      await expect(b.remember('nouveau', 'valeur récente', { scope: 'user' })).rejects.toThrow();

      const after = fs.readFileSync(userPath, 'utf8');
      expect(after).toBe('this is not canonical memory markdown\n');
      expect(after).not.toContain('valeur récente');
      expect(before).toContain('souvenir historique irremplaçable');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('si le fichier reste illisible, le save refuse d\'écraser (fail-closed)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-amnesia2-'));
    const userPath = path.join(dir, 'U.md');
    const cfg = { projectMemoryPath: path.join(dir, 'P.md'), userMemoryPath: userPath };
    try {
      const seed = new PersistentMemoryManager(cfg);
      await seed.initialize();
      await seed.remember('precieux', 'souvenir historique irremplaçable', { scope: 'user' });
      const before = fs.readFileSync(userPath, 'utf8');

      fs.chmodSync(userPath, 0o000);
      const b = new PersistentMemoryManager(cfg);
      await b.initialize();
      await b.remember('nouveau', 'valeur récente', { scope: 'user' }).catch(() => {});

      fs.chmodSync(userPath, 0o644);
      const after = fs.readFileSync(userPath, 'utf8');
      expect(after).toContain('souvenir historique irremplaçable');
      // L'historique n'a pas été remplacé par un fichier réduit au seul nouveau souvenir.
      expect(after.length).toBeGreaterThanOrEqual(before.length - 200);
    } finally {
      try { fs.chmodSync(userPath, 0o644); } catch { /* déjà fait */ }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
