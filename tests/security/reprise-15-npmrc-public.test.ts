import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = vi.hoisted(() => {
  const root = `${process.cwd()}/_qa/securite-reprise-15`;
  const previous = { home: process.env.HOME, profile: process.env.USERPROFILE };
  process.env.HOME = `${root}/home`;
  process.env.USERPROFILE = `${root}/home`;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { root, previous };
});

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { hasProtectedGitWorkspace, runProtectedWorkspaceCommand } from '../../src/security/git-secret-process-boundary.js';
import { checkSecretFileAccess } from '../../src/security/secret-files.js';

const publicRepo = path.join(qa.root, 'public');
const oldSecretRepo = path.join(qa.root, 'old-secret');
const indexSecretRepo = path.join(qa.root, 'index-secret');
const tracked = path.join(publicRepo, 'cowork', '.npmrc');
const untracked = path.join(publicRepo, 'scratch', '.npmrc');
const publicSettings = '# Cross-platform collaboration settings\nengine-strict=false\n' +
  '# Prevent accidental package-lock.json changes during development\npackage-lock=true\n' +
  'save-exact=true\nlegacy-peer-deps=false\n';
const fakeToken = 'FAKE-NPMRC-REPRISE-15';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
  });
}

function commit(cwd: string, message: string): void {
  git(cwd, 'add', '--all');
  git(cwd, '-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid',
    'commit', '-qm', message);
}

beforeAll(() => {
  fs.mkdirSync(path.join(qa.root, 'home'), { recursive: true });
  for (const root of [publicRepo, oldSecretRepo, indexSecretRepo]) {
    fs.mkdirSync(root, { recursive: true });
    git(root, 'init', '-q');
  }
  fs.mkdirSync(path.dirname(tracked), { recursive: true });
  fs.writeFileSync(tracked, publicSettings);
  commit(publicRepo, 'configuration publique');
  fs.mkdirSync(path.dirname(untracked), { recursive: true });
  fs.writeFileSync(untracked, publicSettings);
  const historical = path.join(oldSecretRepo, '.npmrc');
  fs.writeFileSync(historical, `//registry.npmjs.org/:_authToken=${fakeToken}\n`);
  commit(oldSecretRepo, 'ancien jeton factice');
  fs.writeFileSync(historical, publicSettings);
  commit(oldSecretRepo, 'configuration publique actuelle');
  const staged = path.join(indexSecretRepo, '.npmrc');
  fs.writeFileSync(staged, `//registry.npmjs.org/:_authToken=${fakeToken}\n`);
  git(indexSecretRepo, 'add', '.npmrc');
  fs.writeFileSync(staged, publicSettings);
});

afterAll(() => {
  fs.rmSync(qa.root, { recursive: true, force: true });
  if (qa.previous.home === undefined) delete process.env.HOME;
  else process.env.HOME = qa.previous.home;
  if (qa.previous.profile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = qa.previous.profile;
});

describe('B14 — .npmrc public et frontière des processus', () => {
  it('laisse lancer un shell dans un dépôt avec .npmrc public suivi et non suivi', () => {
    expect(hasProtectedGitWorkspace(publicRepo)).toBe(false);
    expect(runProtectedWorkspaceCommand('echo public', publicRepo)).toBeNull();
  });

  it('conserve le refus de lecture directe du .npmrc public', () => {
    expect(checkSecretFileAccess(tracked, 'read').secret).toBe(true);
    expect(checkSecretFileAccess(untracked, 'read').secret).toBe(true);
  });

  it('protège un .npmrc courant qui contient un jeton', () => {
    fs.writeFileSync(untracked, `//registry.npmjs.org/:_authToken=${fakeToken}\n`);
    try { expect(hasProtectedGitWorkspace(publicRepo)).toBe(true); }
    finally { fs.writeFileSync(untracked, publicSettings); }
  });

  it('protège un ancien jeton Git malgré un .npmrc courant public', () => {
    expect(hasProtectedGitWorkspace(oldSecretRepo)).toBe(true);
    expect(runProtectedWorkspaceCommand('echo secret', oldSecretRepo)).toMatchObject({ success: false });
  });

  it('protège un jeton dans l’index malgré un .npmrc courant public', () => {
    expect(hasProtectedGitWorkspace(indexSecretRepo)).toBe(true);
  });

});
