import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = vi.hoisted(() => {
  const root = `${process.cwd()}/_qa/securite-reprise-16`;
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
import { findCredentialPathInCommand } from '../../src/tools/bash/command-validator.js';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { checkSecretFileAccess } from '../../src/security/secret-files.js';

const clean = path.join(qa.root, 'clean');
const probe = path.join(qa.root, 'probe');
const protectedRepo = path.join(qa.root, 'protected');
const secretDependency = path.join(qa.root, 'secret-dependency');
const numericDependency = path.join(qa.root, 'numeric-dependency');
const trackedDependency = path.join(qa.root, 'tracked-dependency');
const token = 'FAKE-VOISIN-REPRISE-16';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-C', cwd, ...args], {
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeAll(() => {
  fs.mkdirSync(path.join(qa.root, 'home'), { recursive: true });
  for (const repo of [clean, probe, protectedRepo, secretDependency, numericDependency, trackedDependency]) {
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q');
    write(path.join(repo, '.gitignore'), 'node_modules/\n');
    write(path.join(repo, 'notes.txt'), 'public\n');
    if (repo === protectedRepo) write(path.join(repo, '.env'), `TOKEN=${token}\n`);
    git(repo, 'add', '--all');
    git(repo, '-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid',
      'commit', '-qm', 'fixture factice');
  }
  write(path.join(clean, 'node_modules', 'bottleneck', '.env'),
    'REDIS_HOST=127.0.0.1\nREDIS_PORT=6379\n');
  write(path.join(clean, 'node_modules', 'nerf-dart', '.npmrc'),
    '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n');
  write(path.join(secretDependency, 'node_modules', 'evil', '.env'),
    `TOKEN=${token}\n`);
  write(path.join(numericDependency, 'node_modules', 'evil', '.env'),
    'AWS_ACCESS_ID=1234\n');
  write(path.join(trackedDependency, 'node_modules', 'bottleneck', '.env'),
    'REDIS_HOST=127.0.0.1\nREDIS_PORT=6379\n');
  git(trackedDependency, 'add', '-f', 'node_modules/bottleneck/.env');
  ConfirmationService.getInstance().setSessionFlag('bashCommands', true);
});

afterAll(() => {
  ConfirmationService.getInstance().setSessionFlag('bashCommands', false);
  fs.rmSync(qa.root, { recursive: true, force: true });
  if (qa.previous.home === undefined) delete process.env.HOME;
  else process.env.HOME = qa.previous.home;
  if (qa.previous.profile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = qa.previous.profile;
});

describe('B15 — dépendances et dépôt voisin', () => {
  it('laisse utiliser Bash avec les seuls exemples publics de dépendances', () => {
    expect(hasProtectedGitWorkspace(clean)).toBe(false);
    expect(runProtectedWorkspaceCommand('echo public', clean)).toBeNull();
    expect(checkSecretFileAccess(path.join(clean, 'node_modules', 'bottleneck', '.env'), 'read').secret).toBe(true);
    expect(checkSecretFileAccess(path.join(clean, 'node_modules', 'nerf-dart', '.npmrc'), 'read').secret).toBe(true);
  });

  it('conserve la frontière pour une vraie valeur de jeton dans une dépendance', () => {
    expect(hasProtectedGitWorkspace(secretDependency)).toBe(true);
  });

  it('ne présume pas publique une valeur numérique sous une clé inconnue', () => {
    expect(hasProtectedGitWorkspace(numericDependency)).toBe(true);
  });

  it('ne contourne pas la frontière pour un fichier de dépendance suivi', () => {
    expect(hasProtectedGitWorkspace(trackedDependency)).toBe(true);
  });

  it('conserve la frontière pour le secret suivi du dépôt voisin', () => {
    expect(hasProtectedGitWorkspace(probe)).toBe(false);
    expect(hasProtectedGitWorkspace(protectedRepo)).toBe(true);
  });

  const commands = [
    'cd ../protected && git show HEAD:.env',
    'git -C ../protected show HEAD:.env',
    'git --git-dir=../protected/.git show HEAD:.env',
    'GIT_DIR=../protected/.git git show HEAD:.env',
    'cd ../protected && git show HEAD',
    'git -C ../protected show HEAD',
    'git --git-dir=../protected/.git show HEAD',
    'GIT_DIR=../protected/.git git show HEAD',
  ];
  it.each(commands)('refuse depuis un dépôt propre : %s', async (command) => {
    expect(findCredentialPathInCommand(command, process.platform, probe)).not.toBeNull();
    if (process.platform === 'win32' && command.startsWith('GIT_DIR=')) return;
    const bash = new BashTool();
    try {
      const result = await bash.execute(command, 3000, probe);
      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).not.toContain(token);
    } finally { bash.dispose(); }
  });

  it('autorise cd vers le voisin, puis refuse sa lecture au tour suivant', async () => {
    const bash = new BashTool();
    const moved = await bash.execute('cd ../protected', 3000, probe);
    expect(moved.success).toBe(true);
    const result = await bash.execute('git show HEAD:.env', 3000);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(token);
    bash.dispose();
  });

  it('refuse un GIT_DIR hérité vers le dépôt voisin', async () => {
    const previous = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(protectedRepo, '.git');
    const bash = new BashTool();
    try {
      const result = await bash.execute('git show HEAD', 3000, probe);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/credential\/secret/);
      expect(JSON.stringify(result)).not.toContain(token);
    } finally {
      bash.dispose();
      if (previous === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previous;
    }
  });
});
