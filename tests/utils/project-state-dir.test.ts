/**
 * `.codebuddy/` créé par Code Buddy ne doit pas salir `git status` (banc harnais
 * 2026-10-03, mission C : `?? .codebuddy/` sur chaque rejeu, HANDOFF écrit après
 * le dernier tour de l'agent). Vrai dépôt Git temporaire, vrai `git status`.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureSelfIgnoredProjectStateDir } from '../../src/utils/project-state-dir.js';

let repo: string;
const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

/** Écritures représentatives observées dans les rejeux (HANDOFF, tool-results…). */
function writeSessionState(dir: string): void {
  fs.mkdirSync(path.join(dir, '.codebuddy', 'tool-results', 'session-x'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.codebuddy', 'HANDOFF.md'), '# handoff\n');
  fs.writeFileSync(path.join(dir, '.codebuddy', 'tool-results', 'session-x', 'call_1.txt'), 'sortie\n');
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-state-dir-'));
  execFileSync('git', ['init', '-q', repo]);
  fs.writeFileSync(path.join(repo, 'README.md'), 'x\n');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', 'README.md');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('ensureSelfIgnoredProjectStateDir', () => {
  it('garde `git status` vide malgré les écritures d’état de session', () => {
    expect(ensureSelfIgnoredProjectStateDir(repo)).toBe(true);
    writeSessionState(repo);
    expect(git('status', '--porcelain', '--untracked-files=all')).toBe('');
  });

  it('témoin : sans lui, les mêmes écritures salissent le statut', () => {
    writeSessionState(repo);
    expect(git('status', '--porcelain')).toContain('?? .codebuddy/');
  });

  it('ne modifie jamais un .codebuddy/ déjà présent (éventuellement suivi)', () => {
    fs.mkdirSync(path.join(repo, '.codebuddy'));
    fs.writeFileSync(path.join(repo, '.codebuddy', 'settings.json'), '{}\n');
    expect(ensureSelfIgnoredProjectStateDir(repo)).toBe(false);
    expect(fs.existsSync(path.join(repo, '.codebuddy', '.gitignore'))).toBe(false);
    expect(git('status', '--porcelain')).toContain('?? .codebuddy/');
  });

  it('ne crée rien hors de la racine d’un dépôt', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-state-plain-'));
    try {
      expect(ensureSelfIgnoredProjectStateDir(plain)).toBe(false);
      expect(fs.existsSync(path.join(plain, '.codebuddy'))).toBe(false);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it('ne touche pas au .gitignore du projet', () => {
    ensureSelfIgnoredProjectStateDir(repo);
    expect(fs.existsSync(path.join(repo, '.gitignore'))).toBe(false);
  });
});
