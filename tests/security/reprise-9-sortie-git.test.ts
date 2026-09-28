import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = vi.hoisted(() => {
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  const root = `${process.cwd()}/_qa/securite-reprise-9`;
  process.env.HOME = `${root}/home`;
  process.env.USERPROFILE = `${root}/home`;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { root, home: `${root}/home`, oldHome, oldUserProfile };
});

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { validateCommand } from '../../src/tools/bash/command-validator.js';
import { redactTrackedGitOutput, redactTrackedGitResult } from '../../src/security/tracked-git-output-redactor.js';
import { ViewFileTool } from '../../src/tools/registry/text-editor-tools.js';

function findGitExecutable(): string {
  const names = process.platform === 'win32' ? ['git.exe'] : ['git'];
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* Try the next PATH directory. */ }
    }
  }
  throw new Error('Git executable not found in the test runner PATH');
}

const gitExecutable = findGitExecutable();
const previousPath = process.env.PATH;
// BashTool uses PowerShell on Windows; these are POSIX-shell attack spellings.
// The direct shellFreeExec and fingerprint tests below still run on Windows.
const posixShell = process.platform !== 'win32';
const repo = path.join(qa.root, 'tracked');
const deletedRepo = path.join(qa.root, 'deleted');
const emptyRepo = path.join(qa.root, 'empty');
const mutableRepo = path.join(qa.root, 'mutable');
const older = 'FAKE-GIT-OLD-SECRET-259';
const current = 'FAKE-GIT-NEW-SECRET-259';
const stashed = 'FAKE-GIT-STASH-SECRET-259';

function git(...args: string[]): string {
  return execFileSync(gitExecutable, ['-C', repo, ...args], {
    encoding: 'utf8', env: { ...process.env, HOME: qa.home, GIT_CONFIG_NOSYSTEM: '1' },
  });
}

function gitIn(where: string, ...args: string[]): string {
  return execFileSync(gitExecutable, ['-C', where, ...args], {
    encoding: 'utf8', env: { ...process.env, HOME: qa.home, GIT_CONFIG_NOSYSTEM: '1' },
  });
}

function commit(message: string): void {
  git('add', '--all');
  git('-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid', 'commit', '-qm', message);
}

beforeAll(() => {
  // BashTool and the output inventory launch `git` by name. CI may give the
  // shell a narrower PATH than the process that found the executable.
  process.env.PATH = [path.dirname(gitExecutable), previousPath].filter(Boolean).join(path.delimiter);
  fs.mkdirSync(qa.home, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  git('init', '-q');
  fs.writeFileSync(path.join(repo, '.env'), `API_KEY=${older}\n`);
  fs.writeFileSync(path.join(repo, 'credentials.json'), JSON.stringify({ token: older }));
  fs.writeFileSync(path.join(repo, '.npmrc'), 'engine-strict=false\n');
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'bonjour\n');
  commit('secret ancien');
  fs.writeFileSync(path.join(repo, '.env'), `API_KEY=${current}\n`);
  fs.writeFileSync(path.join(repo, 'credentials.json'), JSON.stringify({ token: current }));
  commit('secret nouveau');
  fs.writeFileSync(path.join(repo, '.env'), `API_KEY=${stashed}\n`);
  git('stash', 'push', '-qm', 'secret temporaire');
  fs.mkdirSync(deletedRepo, { recursive: true });
  gitIn(deletedRepo, 'init', '-q');
  fs.writeFileSync(path.join(deletedRepo, '.env'), `API_KEY=${older}\n`);
  gitIn(deletedRepo, 'add', '.env');
  gitIn(deletedRepo, '-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid', 'commit', '-qm', 'avant suppression');
  fs.rmSync(path.join(deletedRepo, '.env'));
  gitIn(deletedRepo, 'add', '--all');
  gitIn(deletedRepo, '-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid', 'commit', '-qm', 'suppression');
  fs.mkdirSync(emptyRepo, { recursive: true });
  gitIn(emptyRepo, 'init', '-q');
  fs.mkdirSync(mutableRepo, { recursive: true });
  gitIn(mutableRepo, 'init', '-q');
  fs.writeFileSync(path.join(mutableRepo, 'notes.txt'), 'bonjour\n');
  gitIn(mutableRepo, 'add', 'notes.txt');
  gitIn(mutableRepo, '-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid', 'commit', '-qm', 'départ');
  ConfirmationService.getInstance().setSessionFlag('bashCommands', true);
});

afterAll(() => {
  fs.rmSync(qa.root, { recursive: true, force: true });
  if (qa.oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.oldHome;
  if (qa.oldUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = qa.oldUserProfile;
  if (previousPath === undefined) delete process.env.PATH;
  else process.env.PATH = previousPath;
});

describe('seconde barrière sur la sortie shell', () => {
  it.skipIf(!posixShell)('refuse une redirection Git enveloppée avant la création d’un fichier lisible', async () => {
    const leak = path.join(repo, '_leak.txt');
    fs.rmSync(leak, { force: true });
    const command = 'env git show > _leak.txt';
    expect(validateCommand(command, undefined, repo).valid).toBe(false);
    const result = await new BashTool().execute(command, 3_000, repo);
    expect(result.success).toBe(false);
    expect(fs.existsSync(leak)).toBe(false);
    fs.writeFileSync(leak, 'texte ordinaire\n');
    const readable = await new ViewFileTool().execute({ path: leak });
    expect(readable.success).toBe(true);
    expect(JSON.stringify(readable)).toContain('texte ordinaire');
    fs.rmSync(leak, { force: true });
  });

  it.each([
    'env git show > _leak.txt',
    'env git show | tee _leak.txt > /dev/null',
    'env git show | sed -n "w _leak.txt"',
    'nice git show > _leak.txt',
    'nice -n 5 git show > _leak.txt',
    'timeout 5 git show > _leak.txt',
    'stdbuf -o0 git show > _leak.txt',
    'command git show > _leak.txt',
    'nohup git show > _leak.txt',
    'exec git show > _leak.txt',
    'exec -a alias git show > _leak.txt',
    'printf "show\\n" | xargs git > _leak.txt',
    'env git show | base64 > _leak.txt',
    'env sh -c "git show > _leak.txt"',
    'env -C . git show > _leak.txt',
    'env --chdir=. git show > _leak.txt',
    'env GIT_DIR=.git git show > _leak.txt',
    'GIT_DIR=.git git show > _leak.txt',
    '\\git show > _leak.txt',
  ])('refuse Git suivi derrière un préfixe avant toute écriture : %s', (command) => {
    expect(validateCommand(command, undefined, repo).valid).toBe(false);
  });

  it.each([
    'env git status', 'nice git status', 'nice -n 5 git status', 'timeout 5 git status',
    'stdbuf -o0 git status', 'command git status', 'nohup git status',
    'exec git status', 'env sh -c "git status"',
    'env --unknown echo bonjour', 'env -S node --version',
  ])('préserve un Git de métadonnées enveloppé : %s', (command) => {
    expect(validateCommand(command, undefined, repo).valid).toBe(true);
  });

  it.each([
    'env -C tracked git show > _leak.txt',
    'env --chdir=tracked git show > _leak.txt',
    'env GIT_DIR=tracked/.git git show > _leak.txt',
    'GIT_DIR=tracked/.git git show > _leak.txt',
  ])('refuse un dépôt désigné depuis son parent : %s', (command) => {
    expect(validateCommand(command, undefined, qa.root).valid).toBe(false);
  });

  it('préserve git status après env -C depuis le parent', () => {
    expect(validateCommand('env -C tracked git status', undefined, qa.root).valid).toBe(true);
  });

  it('garde le HOME fictif et le Git réel accessibles aux sous-processus', () => {
    expect(process.env.USERPROFILE).toBe(qa.home);
    expect(process.env.PATH?.split(path.delimiter)).toContain(path.dirname(gitExecutable));
  });

  it.skipIf(!posixShell).each([
    'env git show', 'nice git show', 'timeout 5 git show',
    'stdbuf -o0 git show', 'nohup git show', '\\git show',
    'env GIT_DIR=.git git show', 'env sh -c "git show"',
    'env git show HEAD~1', 'env git show HEAD~1:.env',
    'env git show HEAD:credentials.json',
    'command git show', 'exec git show',
    'printf "show\\n" | xargs git',
    'env git log -p -1', 'env git grep API_KEY',
    'env git archive HEAD', 'env git format-patch -1 --stdout',
    'env git whatchanged -p', 'env git diff-tree -p HEAD~1 HEAD',
    'env git stash show -p',
  ])('masque les valeurs suivies, indépendamment du préfixe : %s', async (command) => {
    // The CI Docker fallback uses node:22-slim, which has no Git. Run the
    // actual host Git through BashTool's protected direct subprocess path.
    const result = await new BashTool().shellFreeExec(['bash', '-c', command], 3_000, repo);
    expect(result.success).toBe(true);
    expect(JSON.stringify(result)).toContain('[REDACTED]');
    expect(JSON.stringify(result)).not.toContain(older);
    expect(JSON.stringify(result)).not.toContain(current);
    expect(JSON.stringify(result)).not.toContain(stashed);
  });

  it.each([
    'git -p show', 'git --paginate log -p -1',
    'git --namespace=essai show', 'git --literal-pathspecs show',
    'git --no-replace-objects show', 'git --exec-path=. show',
    'git -C . show', 'git -c core.pager=cat show',
  ])('masque les valeurs suivies, indépendamment du préfixe : %s', async (command) => {
    expect(validateCommand(command, undefined, repo).valid).toBe(false);
    const result = await new BashTool().execute(command, 3_000, repo);
    expect(JSON.stringify(result)).not.toContain(older);
    expect(JSON.stringify(result)).not.toContain(current);
    expect(JSON.stringify(result)).not.toContain(stashed);
  });

  it.skipIf(!posixShell)('laisse passer une commande enveloppée et masque sa sortie', async () => {
    const command = `env sh -c "printf ${current}"`;
    expect(validateCommand(command, undefined, repo).valid).toBe(true);
    const result = await new BashTool().execute(command, 3_000, repo);
    expect(result.success).toBe(true);
    expect(result.output).toContain('[REDACTED]');
    expect(result.output).not.toContain(current);
  });

  it.skipIf(!posixShell)('masque aussi les événements de sortie et le résultat final en flux', async () => {
    const stream = new BashTool().executeStreaming(`env sh -c "printf ${current}"`, 3_000, repo);
    const chunks: string[] = [];
    let result = await stream.next();
    while (!result.done) {
      chunks.push(result.value);
      result = await stream.next();
    }
    const visible = JSON.stringify({ chunks, result: result.value });
    expect(visible).toContain('[REDACTED]');
    expect(visible).not.toContain(current);
    expect(visible).not.toContain(older);
    expect(visible).not.toContain(stashed);
  });

  it('conserve une sortie ordinaire et le mot clef sans sa valeur', async () => {
    const result = await new BashTool().shellFreeExec(['git', 'show'], 3_000, repo);
    expect(result.output).toContain('API_KEY=');
    expect(result.output).toContain('diff --git a/.env b/.env');
  });

  it('masque la valeur historique après suppression du fichier de travail', async () => {
    const result = await new BashTool().shellFreeExec(['git', 'show', 'HEAD~1'], 3_000, deletedRepo);
    expect(result.success).toBe(true);
    expect(result.output).toContain('[REDACTED]');
    expect(result.output).not.toContain(older);
  });

  it.skipIf(!posixShell)('l’enveloppe sh -c avec un chemin explicite ne rend pas la valeur', async () => {
    const result = await new BashTool().execute('sh -c "git show HEAD:.env"', 3_000, repo);
    expect(JSON.stringify(result)).not.toContain(current);
  });

  it('masque le blob lu par hash avec git cat-file sur toutes les plateformes', async () => {
    const oid = git('rev-parse', 'HEAD:.env').trim();
    const result = await new BashTool().shellFreeExec(['git', 'cat-file', '-p', oid], 3_000, repo);
    expect(result.success).toBe(true);
    expect(result.output).toBe('API_KEY=[REDACTED]');
  });

  it.skipIf(!posixShell)('masque git cat-file préfixé par env', async () => {
    const oid = git('rev-parse', 'HEAD:.env').trim();
    const command = `env git cat-file -p ${oid}`;
    expect(validateCommand(command, undefined, repo).valid).toBe(true);
    const result = await new BashTool().shellFreeExec(['bash', '-c', command], 3_000, repo);
    expect(result.success).toBe(true);
    expect(result.output).toBe('API_KEY=[REDACTED]');
  });

  it('repère le dossier Git nommé dans la commande depuis un parent', () => {
    expect(redactTrackedGitOutput(current, qa.root, 'GIT_DIR=tracked/.git git show'))
      .toBe('[REDACTED]');
  });

  it.skipIf(!posixShell)('masque un chemin de projet composé au moment de l’exécution', async () => {
    const command = 'Z=; cat .en${Z}v';
    expect(validateCommand(command, undefined, repo).valid).toBe(true);
    const result = await new BashTool().shellFreeExec(['bash', '-c', command], 3_000, repo);
    expect(result.success).toBe(true);
    expect(result.output).toBe('API_KEY=[REDACTED]');
  });

  it('préserve la sortie dans un dépôt Git neuf sans secret suivi', () => {
    expect(redactTrackedGitOutput('bonjour', emptyRepo)).toBe('bonjour');
  });

  it('ne masque pas une valeur publique du .npmrc suivi', () => {
    expect(redactTrackedGitOutput('false', repo)).toBe('false');
  });

  it.skipIf(!posixShell)('masque une valeur répartie entre deux émissions du processus', async () => {
    const stream = new BashTool().executeStreaming(
      'env sh -c "printf FAKE-GIT-NEW-; sleep 0.1; printf SECRET-259"', 3_000, repo,
    );
    const chunks: string[] = [];
    let step = await stream.next();
    while (!step.done) {
      chunks.push(step.value);
      step = await stream.next();
    }
    expect(chunks.join('')).toContain('[REDACTED]');
    expect(chunks.join('')).not.toContain(current);
  });

  it('masque aussi le champ error du résultat', () => {
    const result = redactTrackedGitResult({ success: false, error: `échec: ${current}` }, repo);
    expect(result.error).toBe('échec: [REDACTED]');
  });

  it('actualise les empreintes après un nouveau commit', () => {
    expect(redactTrackedGitResult({ success: true, output: 'bonjour' }, mutableRepo).output).toBe('bonjour');
    const value = 'FAKE-GIT-AJOUT-259';
    fs.writeFileSync(path.join(mutableRepo, '.env'), `API_KEY=${value}\n`);
    gitIn(mutableRepo, 'add', '.env');
    gitIn(mutableRepo, '-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid', 'commit', '-qm', 'nouveau secret');
    expect(redactTrackedGitResult({ success: true, output: value }, mutableRepo).output).toBe('[REDACTED]');
  });

  it.skipIf(!posixShell)('masque GIT_DIR même si le répertoire de lancement est hors du dépôt', async () => {
    const result = await new BashTool().shellFreeExec(['bash', '-c', 'env GIT_DIR=tracked/.git git show'], 3_000, qa.root);
    expect(result.success).toBe(true);
    expect(result.output).toContain('[REDACTED]');
    expect(result.output).not.toContain(current);
  });

  it.skipIf(!posixShell).each([
    'env -C tracked git show',
    'env --chdir=tracked git show',
    'env GIT_DIR=tracked/.git GIT_WORK_TREE=tracked git show',
  ])('masque aussi un dépôt désigné depuis un répertoire parent : %s', async (command) => {
    const result = await new BashTool().shellFreeExec(['bash', '-c', command], 3_000, qa.root);
    expect(result.success).toBe(true);
    expect(result.output).toContain('[REDACTED]');
    expect(result.output).not.toContain(current);
  });

  it('masque aussi la sortie du chemin shellFreeExec', async () => {
    const result = await new BashTool().shellFreeExec(['git', 'show'], 3_000, repo);
    expect(result.success).toBe(true);
    expect(result.output).toContain('[REDACTED]');
    expect(result.output).not.toContain(current);
  });

  it('masque la sortie du ripgrep direct de BashTool', async () => {
    const bash = new BashTool();
    await bash.execute('cd ' + repo, 3_000, repo);
    const result = await bash.grep('FAKE-GIT', 'credentials.json');
    expect(result.success).toBe(true);
    expect(result.output).toContain('[REDACTED]');
    expect(result.output).not.toContain(current);
  });

  it('retient une sortie trop volumineuse', () => {
    expect(redactTrackedGitOutput('x'.repeat(2 * 1024 * 1024 + 1), repo))
      .toContain('tracked secret inventory incomplete');
  });

  it('retient la sortie si un secret suivi dépasse la limite d’inventaire', () => {
    fs.writeFileSync(path.join(mutableRepo, '.env'), 'API_KEY=' + 'x'.repeat(256 * 1024));
    gitIn(mutableRepo, 'add', '.env');
    expect(redactTrackedGitOutput('bonjour', mutableRepo))
      .toContain('tracked secret inventory incomplete');
  });
});
