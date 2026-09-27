import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = vi.hoisted(() => {
  const previousHome = process.env.HOME;
  const home = `${process.cwd()}/_qa/securite-reprise-4-git/home`;
  process.env.HOME = home;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { home, previousHome };
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findCredentialPathInCommand, validateCommand } from '../../src/tools/bash/command-validator.js';
import { GitTool } from '../../src/tools/git-tool.js';
import { ArchiveTool } from '../../src/tools/archive-tool.js';

const fakeToken = 'FAKE-GIT-SECRET-259';
let repo: string;
let archiveWork: string;

beforeAll(() => {
  fs.mkdirSync(path.join(qa.home, '.codebuddy', 'skill-signing'), { recursive: true });
  fs.writeFileSync(path.join(qa.home, '.codebuddy', 'skill-signing', 'key.pem'), fakeToken);
  fs.mkdirSync(path.join(qa.home, '.codebuddy', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(qa.home, '.codebuddy', 'skills', 'guide.md'), 'TODO: réparer\n');
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-reprise-4-git-'));
  execFileSync('git', ['init', '-q', repo], { env: { ...process.env, HOME: qa.home } });
  fs.writeFileSync(path.join(repo, 'secrets.json'), `{"token":"${fakeToken}"}\n`);
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'ancienne note\n');
  execFileSync('git', ['-C', repo, 'add', '--', 'secrets.json', 'notes.txt'], { env: { ...process.env, HOME: qa.home } });
  execFileSync('git', ['-C', repo, '-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid', 'commit', '-qm', 'fixture'], { env: { ...process.env, HOME: qa.home } });
  fs.writeFileSync(path.join(repo, 'secrets.json'), `{"token":"${fakeToken}-MODIFIE"}\n`);
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'nouvelle note\n');
  archiveWork = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-reprise-4-archive-'));
});

afterAll(() => {
  if (repo) fs.rmSync(repo, { recursive: true, force: true });
  if (archiveWork) fs.rmSync(archiveWork, { recursive: true, force: true });
  fs.rmSync(path.dirname(qa.home), { recursive: true, force: true });
  if (qa.previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.previousHome;
});

describe('shell, Git et archives sur secrets fictifs', () => {
  it('C1 refuse un chemin de jeton recomposé dans Python ou par variable', () => {
    const interpreter = `python3 -c "import os; print(open(os.path.join(os.path.expanduser('~'), '.codebuddy', 'codex-' + 'auth.json')).read())"`;
    const variable = 'H=$HOME; cat $H/.codebuddy/skill-signing/key.pem';
    expect(validateCommand(interpreter).valid).toBe(false);
    expect(validateCommand(variable).valid).toBe(false);
    expect(validateCommand('python3 -c "print(2+2)"').valid).toBe(true);
  });

  it('C4 autorise la création de .env et la recherche dans skills, sans lire key.pem', () => {
    const previous = process.cwd();
    process.chdir(repo);
    try {
      expect(findCredentialPathInCommand("printf 'A=1\\n' > .env")).toBeNull();
      expect(findCredentialPathInCommand('mv .env.example .env')).toBeNull();
      expect(validateCommand("printf 'A=1\\n' > .env").valid).toBe(true);
      expect(validateCommand('mv .env.example .env').valid).toBe(true);
      expect(findCredentialPathInCommand('cat .env')).not.toBeNull();
      expect(findCredentialPathInCommand(`rg TODO ${path.join(qa.home, '.codebuddy', 'skills')}`)).toBeNull();
      expect(validateCommand(`rg TODO ${path.join(qa.home, '.codebuddy', 'skills')}`).valid).toBe(true);
      expect(findCredentialPathInCommand(`rg TODO ${path.join(qa.home, '.codebuddy', 'skill-signing')}`)).not.toBeNull();
      fs.symlinkSync(path.join(qa.home, '.codebuddy', 'skill-signing'), path.join(qa.home, '.codebuddy', 'skills', 'key-link'));
      expect(findCredentialPathInCommand(`rg -L TODO ${path.join(qa.home, '.codebuddy', 'skills')}`)).not.toBeNull();
    } finally {
      process.chdir(previous);
    }
  });

  it('C2 git diff et blame masquent un secret suivi et conservent le fichier ordinaire', async () => {
    const git = new GitTool(repo);
    const diff = await git.getDiff();
    expect(diff).not.toContain(fakeToken);
    expect(diff).toContain('nouvelle note');
    const blame = await git.blame('secrets.json');
    expect(JSON.stringify(blame)).not.toContain(fakeToken);
    expect(blame.success).toBe(false);
    const ordinary = await git.blame('notes.txt');
    expect(ordinary.success).toBe(true);
    execFileSync('git', ['-C', repo, 'add', '--', 'secrets.json', 'notes.txt'], { env: { ...process.env, HOME: qa.home } });
    try {
      const staged = await git.getDiff(true);
      expect(staged).not.toContain(fakeToken);
      expect(staged).toContain('nouvelle note');
    } finally {
      execFileSync('git', ['-C', repo, 'reset', '-q', '--', 'secrets.json', 'notes.txt'], { env: { ...process.env, HOME: qa.home } });
    }
    const previous = process.cwd();
    process.chdir(repo);
    try {
      expect(findCredentialPathInCommand('git diff')).not.toBeNull();
      expect(validateCommand('git diff').valid).toBe(false);
      expect(validateCommand('git diff -- .').valid).toBe(false);
      expect(findCredentialPathInCommand('git diff -- notes.txt')).toBeNull();
      expect(findCredentialPathInCommand('git blame secrets.json')).not.toBeNull();
    } finally {
      process.chdir(previous);
    }
    const outside = process.cwd();
    process.chdir(archiveWork);
    try {
      expect(findCredentialPathInCommand(`cd ${repo} && git diff`)).not.toBeNull();
      expect(findCredentialPathInCommand(`git -C ${repo} diff`)).not.toBeNull();
    } finally {
      process.chdir(outside);
    }
  });

  it('C2 git add all ne place pas de fichier secret dans l’index', async () => {
    fs.writeFileSync(path.join(repo, 'prod.env'), `TOKEN=${fakeToken}\n`);
    const git = new GitTool(repo);
    await git.add('all');
    const staged = execFileSync('git', ['-C', repo, 'diff', '--cached', '--name-only'], { encoding: 'utf8', env: { ...process.env, HOME: qa.home } });
    expect(staged).not.toContain('prod.env');
    expect(staged).not.toContain('secrets.json');
    expect(staged).toContain('notes.txt');
  });

  it('C3 refuse une archive de la racine d’identifiants, même nommée backup.zip', async () => {
    const { default: AdmZip } = await import('adm-zip');
    const zip = new AdmZip();
    zip.addFile('notes.txt', Buffer.from(fakeToken));
    const source = path.join(qa.home, '.codebuddy', 'backup.zip');
    zip.writeZip(source);
    const archive = new ArchiveTool();
    expect((await archive.list(source)).success).toBe(false);
    const outputDir = path.join(archiveWork, 'out');
    expect((await archive.extract(source, { outputDir })).success).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'notes.txt'))).toBe(false);
  });

  it('C3 refuse un membre secret et une destination hors espace de travail', async () => {
    const { default: AdmZip } = await import('adm-zip');
    const zip = new AdmZip();
    zip.addFile('secrets.json', Buffer.from(fakeToken));
    const source = path.join(archiveWork, 'input.zip');
    zip.writeZip(source);
    const previous = process.cwd();
    process.chdir(archiveWork);
    try {
      const archive = new ArchiveTool();
      expect((await archive.extract(source, { outputDir: path.join(archiveWork, 'out') })).success).toBe(false);
      expect(fs.existsSync(path.join(archiveWork, 'out', 'secrets.json'))).toBe(false);
      expect((await archive.extract(source, { outputDir: path.join(repo, 'elsewhere') })).success).toBe(false);
    } finally {
      process.chdir(previous);
    }
    const ordinary = new AdmZip();
    ordinary.addFile('notes.txt', Buffer.from('texte ordinaire'));
    const ordinarySource = path.join(archiveWork, 'ordinary.zip');
    ordinary.writeZip(ordinarySource);
    process.chdir(repo);
    try {
      expect((await new ArchiveTool().extract(ordinarySource, { outputDir: path.join(archiveWork, 'external') })).success).toBe(false);
    } finally {
      process.chdir(previous);
    }
  });
});
