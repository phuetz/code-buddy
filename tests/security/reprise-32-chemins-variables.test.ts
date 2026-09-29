import { afterAll, describe, expect, it, vi } from 'vitest';

const qa = await vi.hoisted(async () => {
  const path = await import('node:path');
  const home = path.join(process.cwd(), '_qa', 'securite-reprise-32', 'home');
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return { home, work: path.join(process.cwd(), '_qa', 'securite-reprise-32', 'work'), previousHome, previousUserProfile };
});

import { findCredentialPathInCommand, validateCommand } from '../../src/tools/bash/command-validator.js';

afterAll(() => {
  if (qa.previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.previousHome;
  if (qa.previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = qa.previousUserProfile;
});

describe('reprise n°32 : chemins de lecture construits dans le shell', () => {
  it.each([
    'R=.codebuddy; D=~/$R; cat $D/sessions/s1.json',
    'C=.codebuddy; cat "$HOME/$C/sessions/s1.json"',
    'D=~/.codebuddy; sort $D/sessions/s1.json',
    'A=co; B=debuddy; D=.$A$B; cat "$HOME/$D/sessions/s1.json"',
    'read F; cat "$F"',
    'SRC=.env; cp -t public "$SRC"',
  ])('refuse un argument de fichier non vérifiable : %s', (command) => {
    expect(findCredentialPathInCommand(command, process.platform, qa.work)).not.toBeNull();
    expect(validateCommand(command, undefined, qa.work).valid).toBe(false);
  });

  it.each([
    'cat $PWD/notes.txt',
    'echo $HOME',
    'cat ~/.codebuddy/settings.json',
    'sort public.json',
    'F=notes.txt; cat "$F"',
    'F=public.json; sort "$F"',
    'N=5; head -n "$N" notes.txt',
    'KEY=2; sort -k "$KEY" public.json',
    'OUT=.env; sort -o "$OUT" public.json',
    'TARGET=.env; cp .env.example "$TARGET"',
  ])('conserve les usages publics : %s', (command) => {
    expect(validateCommand(command, undefined, qa.work).valid).toBe(true);
  });
});
