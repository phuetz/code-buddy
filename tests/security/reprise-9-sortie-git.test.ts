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
import { redactTrackedGitOutput, redactTrackedGitResult, redactTrackedGitToolResult } from '../../src/security/tracked-git-output-redactor.js';
import { ViewFileTool } from '../../src/tools/registry/text-editor-tools.js';
import { createTestToolRegistry } from '../../src/tools/registry/tool-registry.js';
import { registerBuiltinTools } from '../../src/tools/registry/index.js';

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
const duplicateRepo = path.join(qa.root, 'duplicate');
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
  fs.mkdirSync(duplicateRepo, { recursive: true });
  gitIn(duplicateRepo, 'init', '-q');
  fs.writeFileSync(path.join(duplicateRepo, 'a-public.txt'), `API_KEY=${current}\n`);
  fs.writeFileSync(path.join(duplicateRepo, 'z-secret.env'), `API_KEY=${current}\n`);
  gitIn(duplicateRepo, 'add', 'a-public.txt', 'z-secret.env');
  gitIn(duplicateRepo, '-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid', 'commit', '-qm', 'même blob');
  fs.rmSync(path.join(duplicateRepo, 'z-secret.env'));
  gitIn(duplicateRepo, 'add', '--all');
  gitIn(duplicateRepo, '-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid', 'commit', '-qm', 'secret supprimé');
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
  it('masque aussi un secret suivi recopié dans un fichier ordinaire lu par le registre', async () => {
    const derived = path.join(repo, '_derived.txt');
    fs.writeFileSync(derived, `API_KEY=${current}\n`);
    try {
      const registry = createTestToolRegistry();
      registerBuiltinTools(registry);
      for (const cwd of [repo, qa.root]) {
        for (const name of ['read_file', 'view_file']) {
          const result = await registry.execute(name, { path: derived }, { cwd });
          expect(result.success).toBe(true);
          expect(result.output).toContain('[REDACTED]');
          expect(JSON.stringify(result)).not.toContain(current);
        }
      }
    } finally {
      fs.rmSync(derived, { force: true });
    }
  });

  it('masque les champs structurés rendus par le registre sans changer les métadonnées publiques', () => {
    const result = redactTrackedGitToolResult({
      success: true, content: current, data: { token: current, public: 'bonjour', [current]: 'clef' },
      metadata: { source: 'test', nested: [current] },
    }, repo);
    expect(JSON.stringify(result)).not.toContain(current);
    expect(result.content).toBe('[REDACTED]');
    expect(result.data).toEqual({ token: '[REDACTED]', public: 'bonjour', '[REDACTED]': 'clef' });
    expect(result.metadata).toEqual({ source: 'test', nested: ['[REDACTED]'] });
  });

  it.each([
    'dash -c "git show > _leak.txt"',
    'ash -c "git show > _leak.txt"',
    'ksh -c "git show > _leak.txt"',
    'sh -e -c "git show > _leak.txt"',
    'sh -ce "git show > _leak.txt"',
    'bash -e -c "git show > _leak.txt"',
    'time git show > _leak.txt',
    'eval "git show" > _leak.txt',
    'setsid git show > _leak.txt',
    'ionice git show > _leak.txt',
    'chrt -b 0 git show > _leak.txt',
    'taskset -c 0 git show > _leak.txt',
    'sudo git show > _leak.txt',
    'doas git show > _leak.txt',
    'printf "git show > _leak.txt\\n" | xargs -I{} sh -c {}',
    'busybox git show > _leak.txt',
    'parallel git show ::: 1 > _leak.txt',
    'chpst git show > _leak.txt',
  ])('refuse par défaut un préfixe Git non prouvé sûr : %s', (command) => {
    expect(validateCommand(command, undefined, repo).valid).toBe(false);
  });

  it('refuse une redirection de cat-file par hash avant toute création de fichier', async () => {
    const oid = git('rev-parse', 'HEAD:.env').trim();
    const leak = path.join(repo, '_cat-file-leak.txt');
    fs.rmSync(leak, { force: true });
    for (const command of [`git cat-file -p ${oid} > _cat-file-leak.txt`,
      `env git cat-file -p ${oid} > _cat-file-leak.txt`,
      `git cat-file blob ${oid} > _cat-file-leak.txt`]) {
      expect(validateCommand(command, undefined, repo).valid).toBe(false);
      const result = await new BashTool().execute(command, 3_000, repo);
      expect(result.success).toBe(false);
      expect(fs.existsSync(leak)).toBe(false);
    }
  });

  it('préserve cat-file pour un blob public prouvé et blame sur un fichier ordinaire', () => {
    const publicOid = git('rev-parse', 'HEAD:notes.txt').trim();
    expect(validateCommand(`git cat-file -p ${publicOid}`, undefined, repo).valid).toBe(true);
    expect(validateCommand('git blame notes.txt', undefined, repo).valid).toBe(true);
    expect(validateCommand('git blame .env', undefined, repo).valid).toBe(false);
  });

  it('refuse un OID partagé par un chemin public et un chemin secret', () => {
    const oid = gitIn(duplicateRepo, 'rev-parse', 'HEAD:a-public.txt').trim();
    expect(gitIn(duplicateRepo, 'rev-parse', 'HEAD~1:z-secret.env').trim()).toBe(oid);
    expect(validateCommand(`git cat-file -p ${oid}`, undefined, duplicateRepo).valid).toBe(false);
    expect(redactTrackedGitOutput(current, duplicateRepo)).toBe('[REDACTED]');
  });

  it('refuse la plomberie après suppression du secret et l’admet dans un dépôt sans secret', () => {
    expect(validateCommand('git bundle create _leak.bundle --all', undefined, deletedRepo).valid).toBe(false);
    expect(validateCommand('git bundle create archive.bundle --all', undefined, mutableRepo).valid).toBe(true);
  });

  it('refuse la matérialisation et la configuration d’un blob désigné seulement par hash', () => {
    const oid = git('rev-parse', 'HEAD:.env').trim();
    for (const command of [
      'git checkout-index --temp --all',
      `git unpack-file ${oid}`,
      `git config --blob ${oid} --list`,
    ]) {
      expect(validateCommand(command, undefined, repo).valid).toBe(false);
    }
  });

  it.skipIf(!posixShell)('empêche dash de créer un fichier que view_file lirait', async () => {
    const leak = path.join(repo, '_dash-leak.txt');
    fs.rmSync(leak, { force: true });
    const result = await new BashTool().execute('dash -c "git show > _dash-leak.txt"', 3_000, repo);
    expect(result.success).toBe(false);
    expect(fs.existsSync(leak)).toBe(false);
  });

  it.each([
    'git bundle create _leak.bundle --all',
    'git merge-tree HEAD~1 HEAD',
    'git checkout-index --temp .env',
    'git unpack-file HEAD:.env',
    'git config --blob HEAD:.env --list',
    'git notes show HEAD',
    'git for-each-ref --format=%(contents)',
    'git fast-export --all > _leak.txt',
    'git worktree add _copie HEAD',
    'git stash apply',
    'git -c alias.leak=!git show leak',
    'git -c core.fsmonitor=sh status',
    'git -p status',
    'git --exec-path=. status',
    'env GIT_PAGER=sh git status',
    'git commande-inconnue',
  ])('refuse par défaut la plomberie, les alias et la configuration Git : %s', (command) => {
    expect(validateCommand(command, undefined, repo).valid).toBe(false);
  });

  it.each([
    'git status', 'git status --short', 'git log --oneline -1',
    'git rev-parse HEAD:.env', 'git ls-tree HEAD', 'git rev-list HEAD',
    'git cat-file -t HEAD:.env', 'git cat-file -s HEAD:.env',
    "printf 'git show > fichier.txt'", 'echo git status',
  ])('admet la métadonnée Git sans contenu : %s', (command) => {
    expect(validateCommand(command, undefined, repo).valid).toBe(true);
  });

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
  ])('refuse le sous-processus direct malgré le préfixe : %s', async (command) => {
    const result = await new BashTool().shellFreeExec(['bash', '-c', command], 3_000, repo);
    expect(result.success).toBe(false);
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

  it.skipIf(!posixShell)('refuse aussi une commande enveloppée dans le shell', async () => {
    const command = `env sh -c "printf ${current}"`;
    expect(validateCommand(command, undefined, repo).valid).toBe(true);
    const result = await new BashTool().execute(command, 3_000, repo);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(current);
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
    expect(result.value.success).toBe(false);
    expect(visible).not.toContain(current);
    expect(visible).not.toContain(older);
    expect(visible).not.toContain(stashed);
  });

  it('conserve les métadonnées publiques via le parent sans rendre le secret', async () => {
    const result = await new BashTool().execute('git status', 3_000, repo);
    expect(result.success).toBe(true);
    expect(JSON.stringify(result)).not.toContain(current);
  });

  it('masque la valeur historique après suppression du fichier de travail', async () => {
    const result = await new BashTool().shellFreeExec(['git', 'show', 'HEAD~1'], 3_000, deletedRepo);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(older);
  });

  it.skipIf(!posixShell)('l’enveloppe sh -c avec un chemin explicite ne rend pas la valeur', async () => {
    const result = await new BashTool().execute('sh -c "git show HEAD:.env"', 3_000, repo);
    expect(JSON.stringify(result)).not.toContain(current);
  });

  it('refuse le blob lu par hash avec git cat-file sur toutes les plateformes', async () => {
    const oid = git('rev-parse', 'HEAD:.env').trim();
    const result = await new BashTool().shellFreeExec(['git', 'cat-file', '-p', oid], 3_000, repo);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(current);
  });

  it.skipIf(!posixShell)('refuse cat-file par le validateur et le lancement direct', async () => {
    const oid = git('rev-parse', 'HEAD:.env').trim();
    const command = `env git cat-file -p ${oid}`;
    expect(validateCommand(command, undefined, repo).valid).toBe(false);
    const result = await new BashTool().shellFreeExec(['bash', '-c', command], 3_000, repo);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(current);
  });

  it('repère le dossier Git nommé dans la commande depuis un parent', () => {
    expect(redactTrackedGitOutput(current, qa.root, 'GIT_DIR=tracked/.git git show'))
      .toBe('[REDACTED]');
  });

  it.skipIf(!posixShell)('refuse le chemin de projet composé au moment de l’exécution', async () => {
    const command = 'Z=; cat .en${Z}v';
    expect(validateCommand(command, undefined, repo).valid).toBe(true);
    const result = await new BashTool().shellFreeExec(['bash', '-c', command], 3_000, repo);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(current);
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
    expect(step.value.success).toBe(false);
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
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(current);
  });

  it.skipIf(!posixShell).each([
    'env -C tracked git show',
    'env --chdir=tracked git show',
    'env GIT_DIR=tracked/.git GIT_WORK_TREE=tracked git show',
  ])('masque aussi un dépôt désigné depuis un répertoire parent : %s', async (command) => {
    const result = await new BashTool().shellFreeExec(['bash', '-c', command], 3_000, qa.root);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(current);
  });

  it('masque aussi la sortie du chemin shellFreeExec', async () => {
    const result = await new BashTool().shellFreeExec(['git', 'show'], 3_000, repo);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(current);
  });

  it('masque la sortie du ripgrep direct de BashTool', async () => {
    const bash = new BashTool();
    await bash.execute('cd ' + repo, 3_000, repo);
    const result = await bash.grep('FAKE-GIT', 'credentials.json');
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(current);
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
