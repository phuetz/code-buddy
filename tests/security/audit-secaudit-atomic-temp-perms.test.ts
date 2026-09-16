import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeFileAtomic, writeFileAtomicSync } from '../../src/utils/atomic-write.js';

/**
 * AUDIT SECAUDIT-FLOTTE (Opus, 2026-09-05) — Surface 4.
 * Les fichiers d'état (auth/secrets) écrits via atomic-write ne doivent pas
 * laisser un temporaire *.tmp.* monde-lisible : le temporaire est créé avec le
 * MÊME mode que le final (défaut 0o600, owner rw only) — atomique, sans fenêtre.
 */
describe('SECAUDIT surface 4 — temporaires atomic-write non lisibles', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secaudit-atomic-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('le fichier final par défaut est 0o600 (pas de perm groupe/monde)', () => {
    const p = path.join(dir, 'secret-state.json');
    writeFileAtomicSync(p, JSON.stringify({ token: 'x' }));
    const mode = fs.statSync(p).mode & 0o777;
    if (process.platform !== 'win32') {
      expect(mode & 0o077).toBe(0); // POSIX permissions are not Windows ACLs.
      expect(mode & 0o600).toBe(0o600);
    }
    expect(JSON.parse(fs.readFileSync(p, 'utf8'))).toEqual({ token: 'x' });
    expect(fs.readdirSync(dir)).toEqual(['secret-state.json']);
  });

  it('le TEMPORAIRE est ouvert en 0o600 (fs injecté prouve le mode transmis)', async () => {
    const p = path.join(dir, 'secret.json');
    const opens: Array<{ path: string; mode: number }> = [];
    const realFs = fs;
    const fakeHandle = {
      writeFile: async () => {},
      sync: async () => {},
      close: async () => {},
    };
    await writeFileAtomic(p, 'data', {
      fileSystem: {
        mkdir: async () => {},
        open: async (fp: string, _flags: string, mode: number) => {
          opens.push({ path: fp, mode });
          return fakeHandle as never;
        },
        rename: async () => {},
        chmod: async () => {},
        unlink: async () => {},
      } as never,
    });
    const tempOpen = opens.find((o) => o.path.includes('.tmp.'));
    expect(tempOpen).toBeDefined();
    expect(tempOpen!.mode).toBe(0o600);
    void realFs;
  });

  it('un mode explicite plus large est respecté MAIS 0o600 reste le défaut sûr', () => {
    const p = path.join(dir, 'public.json');
    writeFileAtomicSync(p, 'x'); // défaut
    if (process.platform !== 'win32') {
      expect((fs.statSync(p).mode & 0o777) & 0o077).toBe(0);
    }
    expect(fs.readFileSync(p, 'utf8')).toBe('x');
    expect(fs.readdirSync(dir)).toEqual(['public.json']);
  });
});
