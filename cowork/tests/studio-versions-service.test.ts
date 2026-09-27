/**
 * Versions locales d'App Studio — tests RÉELS : vrai `git`, vrai dossier
 * temporaire (aucun mock). Vérifie l'instantané sans doublon, la liste avec
 * statuts, la restauration réversible (fichiers créés depuis retirés), la
 * remise en l'état de chemins (verrous / mode discussion), les verrous
 * persistés et le confinement des chemins.
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, realpathSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  StudioVersionsService,
  isSafeRelativePath,
  parseVersionLog,
} from '../src/main/studio/studio-versions-service';

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasGit())('StudioVersionsService (git réel)', () => {
  let root: string;
  const service = new StudioVersionsService();

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'studio-versions-')));
    mkdirSync(path.join(root, 'src'), { recursive: true });
    writeFileSync(path.join(root, 'src', 'App.tsx'), 'export const v = 1;\n');
    writeFileSync(path.join(root, 'package.json'), '{"name":"demo"}\n');
    mkdirSync(path.join(root, 'node_modules', 'react'), { recursive: true });
    writeFileSync(path.join(root, 'node_modules', 'react', 'index.js'), 'module.exports = 1;\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('prend une version, sans doublon quand rien ne change, et ignore node_modules', async () => {
    const first = await service.snapshot(root, 'État de départ');
    expect(first.ok && first.data.changed).toBe(true);
    const again = await service.snapshot(root, 'Tour : rien');
    expect(again.ok && again.data.changed).toBe(false);
    expect(again.ok && first.ok && again.data.id).toBe(first.ok ? first.data.id : '');

    const list = await service.list(root);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.data).toHaveLength(1);
    expect(list.data[0]?.label).toBe('État de départ');
    expect(list.data[0]?.files.sort()).toEqual(['package.json', 'src/App.tsx']);
    // Le .git de l'utilisateur n'est jamais créé : le dépôt vit sous .codebuddy/.
    expect(existsSync(path.join(root, '.git'))).toBe(false);
    expect(existsSync(path.join(root, '.codebuddy', 'studio-versions.git', 'HEAD'))).toBe(true);
  });

  it('liste les versions avec le statut de chaque fichier', async () => {
    await service.snapshot(root, 'v1');
    writeFileSync(path.join(root, 'src', 'App.tsx'), 'export const v = 2;\n');
    writeFileSync(path.join(root, 'src', 'New.tsx'), 'export const n = 1;\n');
    rmSync(path.join(root, 'package.json'));
    await service.snapshot(root, 'Tour : ajout');
    const list = await service.list(root);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.data.map((v) => v.label)).toEqual(['Tour : ajout', 'v1']);
    const changes = [...(list.data[0]?.changes ?? [])].sort((a, b) => a.path.localeCompare(b.path));
    expect(changes).toEqual([
      { path: 'package.json', status: 'deleted' },
      { path: 'src/App.tsx', status: 'modified' },
      { path: 'src/New.tsx', status: 'added' },
    ]);
  });

  it('restaure une version, retire les fichiers créés depuis, et reste annulable', async () => {
    const v1 = await service.snapshot(root, 'v1');
    if (!v1.ok) throw new Error(v1.error);
    writeFileSync(path.join(root, 'src', 'App.tsx'), 'export const v = 2;\n');
    writeFileSync(path.join(root, 'src', 'Extra.tsx'), 'export const e = 1;\n');
    await service.snapshot(root, 'v2');

    const restored = await service.restore(root, v1.data.id);
    expect(restored.ok).toBe(true);
    expect(readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8')).toBe('export const v = 1;\n');
    expect(existsSync(path.join(root, 'src', 'Extra.tsx'))).toBe(false);
    // node_modules (ignoré) n'est pas touché par la restauration.
    expect(existsSync(path.join(root, 'node_modules', 'react', 'index.js'))).toBe(true);

    // Annuler la restauration = restaurer la version « v2 ».
    const list = await service.list(root);
    if (!list.ok) throw new Error(list.error);
    const v2 = list.data.find((v) => v.label === 'v2');
    expect(v2).toBeDefined();
    const back = await service.restore(root, v2!.id);
    expect(back.ok).toBe(true);
    expect(readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8')).toBe('export const v = 2;\n');
    expect(existsSync(path.join(root, 'src', 'Extra.tsx'))).toBe(true);
  });

  it('remet des chemins dans leur état d’une version (verrou / discussion)', async () => {
    const pre = await service.snapshot(root, 'avant le tour');
    if (!pre.ok) throw new Error(pre.error);
    writeFileSync(path.join(root, 'src', 'App.tsx'), 'export const v = 99;\n');
    writeFileSync(path.join(root, 'src', 'Created.tsx'), 'x\n');
    writeFileSync(path.join(root, 'package.json'), '{"name":"changed"}\n');

    const changed = await service.changedSince(root, pre.data.id);
    expect(changed.ok && [...changed.data].sort()).toEqual(['package.json', 'src/App.tsx', 'src/Created.tsx']);

    const reverted = await service.revertPaths(root, pre.data.id, ['src/App.tsx', 'src/Created.tsx']);
    expect(reverted.ok && [...reverted.data].sort()).toEqual(['src/App.tsx', 'src/Created.tsx']);
    expect(readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8')).toBe('export const v = 1;\n');
    expect(existsSync(path.join(root, 'src', 'Created.tsx'))).toBe(false);
    // Un chemin non demandé reste tel quel.
    expect(readFileSync(path.join(root, 'package.json'), 'utf8')).toBe('{"name":"changed"}\n');
    // Un chemin déjà identique n'est pas compté.
    const again = await service.revertPaths(root, pre.data.id, ['src/App.tsx']);
    expect(again.ok && again.data).toEqual([]);
  });

  it('refuse les chemins qui sortent du projet', async () => {
    const pre = await service.snapshot(root, 'v1');
    if (!pre.ok) throw new Error(pre.error);
    const outside = path.join(path.dirname(root), 'hors-projet.txt');
    writeFileSync(outside, 'intact\n');
    const res = await service.revertPaths(root, pre.data.id, ['../hors-projet.txt', '/etc/passwd']);
    expect(res.ok && res.data).toEqual([]);
    expect(readFileSync(outside, 'utf8')).toBe('intact\n');
    rmSync(outside, { force: true });
    expect((await service.snapshot('relatif/pas/absolu', 'x')).ok).toBe(false);
    expect((await service.restore(root, 'pas-un-id; rm -rf /')).ok).toBe(false);
  });

  it('persiste les verrous, triés et sans doublon', async () => {
    expect(await service.getLocks(root)).toEqual({ ok: true, data: [] });
    const set = await service.setLocks(root, ['src/App.tsx', 'package.json', 'src/App.tsx', '../evil']);
    expect(set).toEqual({ ok: true, data: ['package.json', 'src/App.tsx'] });
    expect(await service.getLocks(root)).toEqual({ ok: true, data: ['package.json', 'src/App.tsx'] });
  });
});

describe('fonctions pures', () => {
  it('isSafeRelativePath', () => {
    expect(isSafeRelativePath('src/App.tsx')).toBe(true);
    expect(isSafeRelativePath('../x')).toBe(false);
    expect(isSafeRelativePath('a/../../x')).toBe(false);
    expect(isSafeRelativePath('/abs')).toBe(false);
    expect(isSafeRelativePath('C:\\x')).toBe(false);
    expect(isSafeRelativePath('')).toBe(false);
  });

  it('parseVersionLog lit ajouts, modifs, suppressions et renommages', () => {
    const out = parseVersionLog(
      '@@abc\x1f1700000000\x1fTour : x\n\nA\tsrc/New.tsx\nM\tsrc/App.tsx\nD\told.css\nR100\ta.ts\tb.ts\n@@def\x1f1690000000\x1fv1\n\nA\tindex.html\n',
    );
    expect(out).toEqual([
      {
        id: 'abc',
        createdAt: 1700000000000,
        label: 'Tour : x',
        files: ['src/New.tsx', 'src/App.tsx', 'old.css', 'b.ts'],
        changes: [
          { path: 'src/New.tsx', status: 'added' },
          { path: 'src/App.tsx', status: 'modified' },
          { path: 'old.css', status: 'deleted' },
          { path: 'b.ts', status: 'modified' },
        ],
      },
      { id: 'def', createdAt: 1690000000000, label: 'v1', files: ['index.html'], changes: [{ path: 'index.html', status: 'added' }] },
    ]);
  });
});
