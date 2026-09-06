/**
 * Audit 2026-09-02 — famille « perte silencieuse » :
 * 1) une valeur multi-ligne doit survivre à un save + reload (avant correctif,
 *    seules les lignes indentées de 2 espaces étaient refondues ; le writer
 *    n'indentait pas → tout sauf la 1re ligne était perdu au redémarrage) ;
 * 2) les tags écrits (`  Tags: …`) doivent être re-parsés (avant correctif,
 *    aucune branche Tags dans le parseur → repliés dans la valeur puis détruits
 *    au cycle suivant — `pinned` ne protégeait plus rien après restart).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';

function tmpPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-rt-'));
  return {
    dir,
    cfg: {
      projectMemoryPath: path.join(dir, 'P.md'),
      userMemoryPath: path.join(dir, 'U.md'),
    },
  };
}

describe('mémoire persistante — round-trip multi-ligne et tags', () => {
  it('restitue une valeur multi-ligne à l\'identique après reload', async () => {
    const { dir, cfg } = tmpPaths();
    try {
      const a = new PersistentMemoryManager(cfg);
      await a.initialize();
      const value = 'ligne 1 importante\nligne 2 CRUCIALE\nligne 3 fin';
      await a.remember('note-medicale', value, { scope: 'user' });

      const b = new PersistentMemoryManager(cfg);
      await b.initialize();
      expect(b.recall('note-medicale', 'user')).toBe(value);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('restitue les tags (dont pinned) après reload, hors de la valeur', async () => {
    const { dir, cfg } = tmpPaths();
    try {
      const a = new PersistentMemoryManager(cfg);
      await a.initialize();
      await a.remember('langue', 'répondre en français', {
        scope: 'user',
        tags: ['pinned', 'langue'],
      });

      const b = new PersistentMemoryManager(cfg);
      await b.initialize();
      const entry = (b as any).userMemories.get('langue');
      expect(entry?.value).toBe('répondre en français');
      expect(entry?.tags).toEqual(['pinned', 'langue']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
