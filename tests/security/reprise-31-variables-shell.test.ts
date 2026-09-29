import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = await vi.hoisted(async () => {
  const path = await import('node:path');
  const root = path.join(process.cwd(), '_qa', 'securite-reprise-31');
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = path.join(root, 'home');
  process.env.USERPROFILE = process.env.HOME;
  return { root, home: process.env.HOME, work: path.join(root, 'work'), previousHome, previousUserProfile };
});

import * as fs from 'node:fs';
import * as path from 'node:path';
import { findCredentialPathInCommand, validateCommand } from '../../src/tools/bash/command-validator.js';

beforeAll(() => {
  fs.mkdirSync(path.join(qa.work, '.codebuddy'), { recursive: true });
  fs.mkdirSync(path.join(qa.home, '.docker'), { recursive: true });
  fs.writeFileSync(path.join(qa.work, '.codebuddy', 'codex-auth.json'), 'FAKE-REPRISE-31');
  fs.writeFileSync(path.join(qa.home, '.docker', 'config.json'), 'FAKE-DOCKER-31');
  fs.writeFileSync(path.join(qa.work, 'notes.txt'), 'public\n');
});

afterAll(() => {
  fs.rmSync(qa.root, { recursive: true, force: true });
  if (qa.previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.previousHome;
  if (qa.previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = qa.previousUserProfile;
});

describe('reprise n°31 : variables shell devant une racine privée', () => {
  it.each([
    'cat $PWD/.codebuddy/*',
    'cat ${PWD}/.codebuddy/*',
    'cat $OLDPWD/.codebuddy/*',
    'cat /home/$USER/.codebuddy/*',
    'cat /home/${LOGNAME}/.codebuddy/*',
    'cat $RACINE_INCONNUE/.codebuddy/*',
    'cat "$PWD"/.codebuddy/*',
    'sort $PWD/.docker/*',
    'cat $PWD/.ssh/*',
  ])('refuse %s avant lancement', (command) => {
    expect(findCredentialPathInCommand(command, process.platform, qa.work)).not.toBeNull();
    expect(validateCommand(command, undefined, qa.work).valid).toBe(false);
  });

  it('conserve les chemins publics nommés via PWD et la configuration publique du HOME', () => {
    expect(validateCommand('cat $PWD/notes.txt', undefined, qa.work).valid).toBe(true);
    expect(validateCommand('cat ~/.codebuddy/settings.json', undefined, qa.work).valid).toBe(true);
  });
});
