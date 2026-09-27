/**
 * Audit sécurité 2.3.0 — constat 6 : le repli VFS (isolation désactivée) ne
 * faisait `realpath` que si le FICHIER FINAL existait. `lien/nouveau.txt`, où
 * `lien` pointe hors du projet, passait donc avant une création.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UnifiedVfsRouter } from '../../src/services/vfs/unified-vfs-router.js';
import { getWorkspaceIsolation, resetWorkspaceIsolation } from '../../src/workspace/workspace-isolation.js';

describe('repli VFS sans isolation — lien du parent', () => {
  let base: string;
  let project: string;
  let outside: string;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cb-vfs-repli-')));
    project = path.join(base, 'projet');
    outside = path.join(base, 'dehors');
    fs.mkdirSync(project);
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(project, 'lien'));
    fs.writeFileSync(path.join(project, 'ok.txt'), 'ok');
    resetWorkspaceIsolation();
    getWorkspaceIsolation({ workspaceRoot: project, enabled: false });
  });

  afterEach(() => {
    resetWorkspaceIsolation();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('refuse un fichier à créer sous un lien qui sort du projet', () => {
    const result = UnifiedVfsRouter.Instance.resolvePath(path.join(project, 'lien', 'nouveau.txt'), project, 'write');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/outside project directory/);
  });

  it('accepte toujours un fichier ordinaire du projet, existant ou à créer', () => {
    expect(UnifiedVfsRouter.Instance.resolvePath(path.join(project, 'ok.txt'), project).valid).toBe(true);
    expect(UnifiedVfsRouter.Instance.resolvePath(path.join(project, 'sous', 'neuf.txt'), project, 'write').valid).toBe(true);
  });
});
