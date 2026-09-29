import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = vi.hoisted(() => {
  const oldHome = process.env.HOME;
  const root = `${process.cwd()}/_qa/securite-reprise-8`;
  process.env.HOME = `${root}/home`;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { root, home: `${root}/home`, oldHome };
});

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import { validateCommand } from '../../src/tools/bash/command-validator.js';

const secretRepo = path.join(qa.root, 'tracked');
const safeRepo = path.join(qa.root, 'ordinary');
const fake = 'FAKE-GIT-GLOBAL-259';

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', env: { ...process.env, HOME: qa.home, GIT_CONFIG_NOSYSTEM: '1' },
  });
}

function commit(repo: string, message: string): void {
  git(repo, 'add', '--all');
  git(repo, '-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid', 'commit', '-qm', message);
}

beforeAll(() => {
  fs.mkdirSync(qa.home, { recursive: true });
  for (const repo of [secretRepo, safeRepo]) {
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q');
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'bonjour\n');
    if (repo === secretRepo) fs.writeFileSync(path.join(repo, '.env'), `API_KEY=${fake}\n`);
    commit(repo, 'premier commit');
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'bonjour encore\n');
    if (repo === secretRepo) fs.writeFileSync(path.join(repo, '.env'), `API_KEY=${fake}-MODIFIE\n`);
    commit(repo, 'second commit');
  }
});

afterAll(() => {
  fs.rmSync(qa.root, { recursive: true, force: true });
  if (qa.oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.oldHome;
});

describe('grammaire des options globales Git avant la sous-commande', () => {
  it.each([
    'git -p show', 'git --paginate show', 'git -P show', 'git --no-pager show',
    'git --namespace=x show', 'git --namespace x show',
    'git --literal-pathspecs show', 'git --glob-pathspecs show',
    'git --noglob-pathspecs show', 'git --icase-pathspecs show',
    'git --no-replace-objects show', 'git --no-optional-locks show',
    'git --exec-path=. show', 'git --exec-path . show',
    'git -C . show', 'git -C. show',
    'git -c core.pager=cat show', 'git -ccore.pager=cat show',
    'git --git-dir=.git show', 'git --git-dir .git show',
    'git --work-tree=. show', 'git --work-tree . show',
    'git --config-env=core.pager=TEST_PAGER show',
    'git --config-env core.pager=TEST_PAGER show',
    'git --bare show',
  ])('refuse %s sur le secret suivi', (command) => {
    expect(validateCommand(command, undefined, secretRepo).valid).toBe(false);
  });

  it.each([
    'git -p log -p -1', 'git -p grep API_KEY',
    'git --namespace=x diff HEAD~1 HEAD',
    'git --no-replace-objects stash show -p',
  ])('garde la sous-commande %s après le préfixe global', (command) => {
    expect(validateCommand(command, undefined, secretRepo).valid).toBe(false);
  });

  it.each(['git --option-inventee show', 'git --option-inventee=valeur status'])(
    'refuse une option globale inconnue même sans secret : %s', (command) => {
      expect(validateCommand(command, undefined, safeRepo).valid).toBe(false);
    },
  );

  it('conserve les options -c légitimes pour une sous-commande sans contenu', () => {
    expect(validateCommand('git -c user.name=Essai status', undefined, safeRepo).valid).toBe(true);
    expect(validateCommand('git -c core.fsmonitor=/tmp/outil show', undefined, safeRepo).valid).toBe(false);
  });

  it.each(['git --version', 'git -v', 'git --help', 'git --html-path', 'git --list-cmds=main'])(
    'préserve une option globale purement informative : %s', (command) => {
      expect(validateCommand(command, undefined, safeRepo).valid).toBe(true);
    },
  );

  it('contrôle le dépôt réellement désigné par --git-dir et --work-tree', () => {
    const gitDir = path.join(secretRepo, '.git');
    expect(validateCommand(`git --git-dir="${gitDir}" --work-tree="${secretRepo}" show`, undefined, safeRepo).valid).toBe(false);
    expect(validateCommand(`git --git-dir "${gitDir}" --work-tree "${secretRepo}" show`, undefined, safeRepo).valid).toBe(false);
  });

  it.each([
    'git archive HEAD', 'git format-patch -1 --stdout',
    'git whatchanged -p', 'git diff-tree -p HEAD~1 HEAD',
  ])('refuse la sortie de contenu %s', (command) => {
    expect(validateCommand(command, undefined, secretRepo).valid).toBe(false);
  });

  it.each([
    'git -p show', 'git --namespace=x show', 'git archive HEAD',
    'git format-patch -1 --stdout',
  ])('le vrai BashTool ne restitue aucun jeton avec %s', async (command) => {
    const result = await new BashTool().execute(command, 1_000, secretRepo);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(fake);
  });

  it.each([
    'git -p show', 'git --namespace=x show', 'git archive HEAD',
    'git format-patch -1 --stdout', 'git whatchanged -p',
    'git diff-tree -p HEAD~1 HEAD',
  ])('laisse passer %s lorsque seuls des fichiers ordinaires sont concernés', (command) => {
    expect(validateCommand(command, undefined, safeRepo).valid).toBe(true);
  });
});
