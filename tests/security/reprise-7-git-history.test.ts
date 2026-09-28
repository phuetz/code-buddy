import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = vi.hoisted(() => {
  const oldHome = process.env.HOME;
  const root = `${process.cwd()}/_qa/securite-reprise-7`;
  process.env.HOME = `${root}/home`;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { root, home: `${root}/home`, oldHome };
});

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import { findCredentialPathInCommand, validateCommand } from '../../src/tools/bash/command-validator.js';

const tracked = path.join(qa.root, 'tracked');
const spaced = path.join(qa.root, 'other repo with spaces');
const deleted = path.join(qa.root, 'deleted');
const publicEnv = path.join(qa.root, 'public-env');
const publicLocal = path.join(qa.root, 'public-local');
const nested = path.join(qa.root, 'nested');
const fake = 'FAKE-GIT-HISTORY-259';
let deletedSecretBlob: string;
const gitEnv = { ...process.env, HOME: qa.home, GIT_CONFIG_NOSYSTEM: '1' };

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: gitEnv });
}

function commit(repo: string, message: string): void {
  git(repo, 'add', '--all');
  git(repo, '-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid', 'commit', '-qm', message);
}

beforeAll(() => {
  fs.mkdirSync(qa.home, { recursive: true });
  for (const repo of [tracked, deleted, spaced]) {
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q');
    fs.writeFileSync(path.join(repo, '.env'), `API_KEY=${fake}\n`);
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'bonjour\n');
    commit(repo, 'fixture');
  }
  fs.rmSync(path.join(deleted, '.env'));
  fs.writeFileSync(path.join(deleted, 'notes.txt'), 'bonjour encore\n');
  commit(deleted, 'suppression du secret');
  fs.writeFileSync(path.join(deleted, 'notes.txt'), 'bonjour troisième version\n');
  commit(deleted, 'changement ordinaire');
  deletedSecretBlob = git(deleted, 'rev-parse', 'HEAD~2:.env').trim();
  fs.writeFileSync(path.join(tracked, '.env'), `API_KEY=${fake}-STASH\n`);
  git(tracked, 'stash', 'push', '-qm', 'fixture stash');
  fs.writeFileSync(path.join(spaced, '.env'), `API_KEY=${fake}-MODIFIE\n`);
  fs.writeFileSync(path.join(tracked, 'patterns.txt'), 'bonjour\n');

  const fixture = path.join(publicEnv, 'node_modules', 'pkg');
  fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(path.join(fixture, '.env.test'), 'HELLO=world\n');
  fs.writeFileSync(path.join(publicEnv, 'notes.txt'), 'bonjour\n');
  fs.mkdirSync(publicLocal, { recursive: true });
  fs.writeFileSync(path.join(publicLocal, '.env.local'), 'HELLO=world\n');
  fs.writeFileSync(path.join(publicLocal, 'notes.txt'), 'bonjour\n');
  fs.mkdirSync(path.join(nested, 'sub'), { recursive: true });
  git(nested, 'init', '-q');
  fs.writeFileSync(path.join(nested, 'sub', '.env'), `API_KEY=${fake}\n`);
  commit(nested, 'secret dans un sous-dossier');
});

afterAll(() => {
  fs.rmSync(qa.root, { recursive: true, force: true });
  if (qa.oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.oldHome;
});

describe('B8 — contenu de secrets suivis par Git', () => {
  it.each([
    'git show', 'git show HEAD', 'git log -p -1', 'git log --all -p',
    'git grep API_KEY', 'git grep -h API_KEY', 'git grep --cached API_KEY',
    'git stash show -p',
  ])('refuse %s quand la sortie inclut un .env suivi', (command) => {
    expect(findCredentialPathInCommand(command, process.platform, tracked)).not.toBeNull();
    expect(validateCommand(command, undefined, tracked).valid).toBe(false);
  });

  it.each([
    'git show HEAD~1', 'git show HEAD~2:.env', 'git log --all -p',
    'git grep API_KEY HEAD~2',
  ])('refuse %s après suppression du fichier du disque', (command) => {
    expect(findCredentialPathInCommand(command, process.platform, deleted)).not.toBeNull();
    expect(validateCommand(command, undefined, deleted).valid).toBe(false);
  });

  it('le vrai BashTool ne restitue pas le secret suivi', async () => {
    const result = await new BashTool().execute('git show', 1_000, tracked);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(fake);
  });

  it('résout le dépôt explicite et le cd avant un lecteur Git', () => {
    expect(validateCommand(`git -C ${tracked} show`, undefined, publicEnv).valid).toBe(false);
    expect(validateCommand(`cd ${tracked} && git show`, undefined, publicEnv).valid).toBe(false);
    expect(validateCommand('git -c core.pager=cat show', undefined, tracked).valid).toBe(false);
    expect(validateCommand(`git -C "${spaced}" show`, undefined, publicEnv).valid).toBe(false);
    expect(validateCommand(`cd "${spaced}" && git show`, undefined, publicEnv).valid).toBe(false);
    expect(validateCommand(`git -C "${spaced}" diff`, undefined, publicEnv).valid).toBe(false);
    expect(validateCommand(`cd "${spaced}" && git diff`, undefined, publicEnv).valid).toBe(false);
  });

  it('refuse aussi un blob secret désigné seulement par son empreinte', () => {
    expect(validateCommand(`git show ${deletedSecretBlob}`, undefined, deleted).valid).toBe(false);
    expect(validateCommand(`git show --stat ${deletedSecretBlob}`, undefined, deleted).valid).toBe(false);
  });

  it.each([
    ['git show', deleted], ['git show HEAD:notes.txt', deleted],
    ['git show --stat HEAD~1', deleted], ['git log --oneline --all', deleted],
    ['git log -p -- notes.txt', deleted], ['git grep API_KEY -- notes.txt', tracked],
    ['git grep -f patterns.txt', tracked],
  ])('préserve %s sur le chemin ordinaire', (command, repo) => {
    expect(validateCommand(command, undefined, repo).valid).toBe(true);
  });

  it('refuse un fichier secret utilisé comme motifs de git grep', () => {
    expect(validateCommand('git grep -f .env notes.txt', undefined, tracked).valid).toBe(false);
    expect(validateCommand('git grep --file=.env notes.txt', undefined, tracked).valid).toBe(false);
  });

  it('refuse git grep lancé depuis un sous-dossier du dépôt', () => {
    expect(findCredentialPathInCommand('git grep API_KEY', process.platform, path.join(nested, 'sub'))).toBe('.env');
    expect(validateCommand('git grep API_KEY', undefined, path.join(nested, 'sub')).valid).toBe(false);
    expect(validateCommand('git grep API_KEY HEAD', undefined, path.join(nested, 'sub')).valid).toBe(false);
  });
});

describe('réserve — fixture .env.test publique', () => {
  it('permet la recherche récursive sans divulguer un .env.test porteur de jeton', () => {
    expect(validateCommand('grep -r bonjour .', undefined, publicEnv).valid).toBe(true);
    expect(validateCommand('cat node_modules/pkg/.env.test', undefined, publicEnv).valid).toBe(false);
    fs.writeFileSync(path.join(publicEnv, 'node_modules', 'pkg', '.env.test'), `API_KEY=${fake}\n`);
    expect(validateCommand('grep -r bonjour .', undefined, publicEnv).valid).toBe(false);
  });

  it('distingue un .env.local public d’un .env.local à jeton', () => {
    expect(validateCommand('grep -r bonjour .', undefined, publicLocal).valid).toBe(true);
    expect(validateCommand('cat .env.local', undefined, publicLocal).valid).toBe(false);
    fs.writeFileSync(path.join(publicLocal, '.env.local'), `API_KEY=${fake}\n`);
    expect(validateCommand('grep -r bonjour .', undefined, publicLocal).valid).toBe(false);
  });
});
