import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasProtectedGitWorkspace } from '../../src/security/git-secret-process-boundary.js';
import { checkSecretFileAccess } from '../../src/security/secret-files.js';

let root: string;
const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], {
  encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
});
const commit = (repo: string) => {
  git(repo, 'add', '--all');
  git(repo, '-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid',
    'commit', '-qm', 'fixture de sécurité');
};
const repo = (name: string) => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  git(dir, 'init', '-q');
  return dir;
};

beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-ci-fixtures-')); });
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('frontière shell : contenu des .env', () => {
  it('laisse exécuter dans un dépôt avec une fixture suivie explicite', () => {
    const dir = repo('fixture-suivie');
    const env = path.join(dir, '.env');
    fs.writeFileSync(env, 'API_KEY=FAKE-CI-FIXTURE\n');
    commit(dir);
    expect(checkSecretFileAccess(env, 'read').secret).toBe(true);
    expect(hasProtectedGitWorkspace(dir)).toBe(false);
  });

  it('ne bloque pas le dépôt parent à cause du faux jeton créé sous _qa', () => {
    const dir = repo('fixture-qa-parent');
    const env = path.join(dir, '_qa', 'securite-2-3-0', 'work', '.env');
    fs.mkdirSync(path.dirname(env), { recursive: true });
    fs.writeFileSync(env, 'API_KEY=FAKE-OAUTH-TOKEN-qa-securite-2-3-0\n');
    expect(hasProtectedGitWorkspace(dir)).toBe(false);
    expect(checkSecretFileAccess(env, 'read').secret).toBe(true);
  });

  it('laisse exécuter si toutes les versions historiques sont des fixtures explicites', () => {
    const dir = repo('fixture-historique');
    const env = path.join(dir, '.env');
    fs.writeFileSync(env, 'API_KEY=FAKE-OLD-FIXTURE\n');
    commit(dir);
    fs.rmSync(env);
    commit(dir);
    expect(hasProtectedGitWorkspace(dir)).toBe(false);
  });

  it('refuse une valeur plausible dans l’historique même si le fichier courant est une fixture', () => {
    const dir = repo('historique-prive');
    const env = path.join(dir, '.env');
    fs.writeFileSync(env, `API_KEY=${'x7Qp9M2n'.repeat(8)}\n`);
    commit(dir);
    fs.writeFileSync(env, 'API_KEY=FAKE-CURRENT-FIXTURE\n');
    commit(dir);
    expect(hasProtectedGitWorkspace(dir)).toBe(true);
  });

  it('refuse une valeur plausible uniquement dans l’index', () => {
    const dir = repo('index-prive');
    const env = path.join(dir, '.env');
    fs.writeFileSync(env, `API_KEY=${'a9F2kP7z'.repeat(8)}\n`);
    git(dir, 'add', '.env');
    fs.writeFileSync(env, 'API_KEY=FAKE-WORKTREE-FIXTURE\n');
    expect(hasProtectedGitWorkspace(dir)).toBe(true);
  });

  it('refuse un commentaire libre qui pourrait porter un secret', () => {
    const dir = repo('commentaire-prive');
    fs.writeFileSync(path.join(dir, '.env'), '# private note\nAPI_KEY=FAKE-FIXTURE\n');
    expect(hasProtectedGitWorkspace(dir)).toBe(true);
  });

  it.each(['TEST-MODE-AUTH-KEY', 'FAKE-GENERIC-TOKEN', 'FAKE-' + 'A7q2P9v4'.repeat(8) + '-FIXTURE'])(
    'ne classe pas automatiquement une valeur %s comme fixture publique', (value) => {
      const dir = repo(`marqueur-${value.length}-${value.charCodeAt(0)}`);
      fs.writeFileSync(path.join(dir, '.env'), `API_KEY=${value}\n`);
      expect(hasProtectedGitWorkspace(dir)).toBe(true);
    },
  );
});
