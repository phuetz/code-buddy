import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = vi.hoisted(() => {
  const oldHome = process.env.HOME;
  const home = `${process.cwd()}/_qa/securite-reprise-5/home`;
  process.env.HOME = home;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { home, oldHome };
});

import fs from 'node:fs';
import path from 'node:path';
import { findCredentialPathInCommand, validateCommand } from '../../src/tools/bash/command-validator.js';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import { understandVideo } from '../../src/tools/video/video-understanding.js';

const work = path.join(path.dirname(qa.home), 'work');
const clean = path.join(path.dirname(qa.home), 'clean');
const auth = path.join(qa.home, '.codebuddy', 'codex-auth.json');
const fake = 'FAKE-REPRISE-5-TOKEN';

beforeAll(() => {
  fs.mkdirSync(path.dirname(auth), { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(clean, { recursive: true });
  fs.writeFileSync(auth, JSON.stringify({ access_token: fake }));
  fs.writeFileSync(path.join(work, '.env'), `TOKEN=${fake}\n`);
  fs.writeFileSync(path.join(work, 'prod.env'), `TOKEN=${fake}\n`);
  fs.writeFileSync(path.join(work, 'notes.txt'), 'bonjour\n');
  fs.writeFileSync(path.join(work, '.env.example'), 'TOKEN=example\n');
  fs.writeFileSync(path.join(clean, 'notes.txt'), 'bonjour\n');
  fs.symlinkSync(auth, path.join(work, 'clip.mp4'));
});

afterAll(() => {
  fs.rmSync(path.dirname(qa.home), { recursive: true, force: true });
  if (qa.oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.oldHome;
});

describe('B6 : lecteurs récursifs et globs', () => {
  it.each([
    'grep -r FAKE-REPRISE-5 $HOME',
    'grep -r . $HOME',
    'rg -uuu . ~',
    'tar cf - -C ~ . | tar xf - -O',
    'find $HOME -type f -exec cat {} \\;',
    'find $HOME -name "*.json" -exec cat {} \\;',
    'cd $HOME && grep -r . .',
  ])('refuse la lecture du HOME par %s', (command) => {
    expect(findCredentialPathInCommand(command)).not.toBeNull();
    expect(validateCommand(command).valid).toBe(false);
  });

  it.each([
    'grep -r FAKE-REPRISE-5 .',
    'grep -r .',
    'find . -name ".env*" -exec cat {} \\;',
    'cat .env*',
    'cat .e*',
    'cat .*',
    'cat *.env',
    'cat *',
  ])('refuse la lecture du secret de projet par %s', (command) => {
    const previous = process.cwd();
    process.chdir(work);
    try {
      expect(findCredentialPathInCommand(command)).not.toBeNull();
      expect(validateCommand(command).valid).toBe(false);
    } finally { process.chdir(previous); }
  });

  it('conserve les fichiers publics et les recherches ciblées', () => {
    const previous = process.cwd();
    process.chdir(work);
    try {
      expect(validateCommand('cat .env.example').valid).toBe(true);
      expect(validateCommand('head notes.txt').valid).toBe(true);
      expect(validateCommand('grep -r bonjour notes.txt').valid).toBe(true);
      expect(validateCommand('find . -name "*.ts"').valid).toBe(true);
    } finally { process.chdir(previous); }
  });

  it('tient compte du cwd effectif de Bash et préserve un dossier sans secret', () => {
    expect(findCredentialPathInCommand('grep -r FAKE-REPRISE-5 .', process.platform, work)).not.toBeNull();
    expect(validateCommand('grep -r FAKE-REPRISE-5 .', undefined, work).valid).toBe(false);
    expect(validateCommand('grep -r bonjour .', undefined, clean).valid).toBe(true);
    expect(validateCommand('tar cf out.tar notes.txt', undefined, clean).valid).toBe(true);
    expect(validateCommand('cat *', undefined, clean).valid).toBe(true);
    expect(validateCommand('find . -name "*.ts" && grep -r FAKE-REPRISE-5 .', undefined, work).valid).toBe(false);
  });

  it('le vrai BashTool refuse avant exécution, en mode normal et streaming', async () => {
    const bash = new BashTool();
    const command = 'grep -r FAKE-REPRISE-5 .';
    const buffered = await bash.execute(command, 1_000, work);
    expect(buffered.success).toBe(false);
    expect(buffered.error).toMatch(/credential\/secret/i);
    expect(JSON.stringify(buffered)).not.toContain(fake);
    const stream = bash.executeStreaming(command, 1_000, work);
    const final = await stream.next();
    expect(final.done).toBe(true);
    expect(final.value).toMatchObject({ success: false });
    expect(JSON.stringify(final.value)).not.toContain(fake);
  });
});

describe('réserve : vidéo locale', () => {
  it('refuse un secret direct et un lien avant extraction ffmpeg', async () => {
    const extractAudio = vi.fn(async () => ({ success: false, error: 'fixture' }));
    const deps = { cwd: work, outDir: path.join(work, 'out'), extractAudio };
    const direct = await understandVideo({ source: auth }, deps);
    const linked = await understandVideo({ source: path.join(work, 'clip.mp4') }, deps);
    expect(direct).toHaveProperty('error', expect.stringMatching(/credential\/secret/i));
    expect(linked).toHaveProperty('error', expect.stringMatching(/credential\/secret/i));
    expect(extractAudio).not.toHaveBeenCalled();
    await understandVideo({ source: path.join(work, 'notes.txt') }, deps);
    expect(extractAudio).toHaveBeenCalledOnce();
  });
});
