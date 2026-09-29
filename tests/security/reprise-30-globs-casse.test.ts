import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = await vi.hoisted(async () => {
  const path = await import('node:path');
  const root = path.join(process.cwd(), '_qa', 'securite-reprise-30');
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = path.join(root, 'home');
  process.env.USERPROFILE = process.env.HOME;
  return { root, home: process.env.HOME, previousHome, previousUserProfile };
});

import * as fs from 'node:fs';
import * as path from 'node:path';
import { classifySecretPath } from '../../src/security/secret-files.js';
import { findCredentialPathInCommand, validateCommand } from '../../src/tools/bash/command-validator.js';

const work = path.join(qa.root, 'work');
const fake = 'FAKE-SECU-REPRISE-30';

beforeAll(() => {
  fs.mkdirSync(qa.home, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  for (const name of ['.env', 'secrets.json', 'codex-auth.json']) {
    fs.writeFileSync(path.join(work, name), fake);
  }
  fs.writeFileSync(path.join(work, '.env.example'), 'PUBLIC=example\n');
  fs.writeFileSync(path.join(work, 'notes.txt'), 'public\n');
  fs.mkdirSync(path.join(work, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(work, 'nested', '.env.local'), fake);
  const docker = path.join(qa.home, '.docker');
  fs.mkdirSync(docker, { recursive: true });
  fs.writeFileSync(path.join(docker, 'config.json'), fake);
});

afterAll(() => {
  fs.rmSync(qa.root, { recursive: true, force: true });
  if (qa.previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.previousHome;
  if (qa.previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = qa.previousUserProfile;
});

describe('reprise n°30 : globs lus par une commande shell', () => {
  it.each(['.env*', 'secrets.jso?', 'codex-auth.jso?'])(
    'refuse sort sur un glob qui atteint %s', (pattern) => {
      const command = `sort ${path.join(work, pattern)}`;
      expect(findCredentialPathInCommand(command, process.platform, qa.home)).not.toBeNull();
      expect(validateCommand(command, undefined, qa.home).valid).toBe(false);
    },
  );

  it('conserve le tri de fichiers publics et le modèle .env.example', () => {
    expect(validateCommand(`sort ${path.join(work, 'notes.*')}`, undefined, qa.home).valid).toBe(true);
    expect(validateCommand(`sort ${path.join(work, '.env.example')}`, undefined, qa.home).valid).toBe(true);
  });

  it('refuse un glob dans le dossier parent et une expansion par accolades vers un secret', () => {
    expect(validateCommand(`sort ${path.join(work, '*', '.env*')}`, undefined, qa.home).valid).toBe(false);
    expect(validateCommand(`sort ${path.join(work, '{notes.txt,.env}')}`, undefined, qa.home).valid).toBe(false);
  });

  it('ne bloque pas une expansion par accolades limitée à deux fichiers publics', () => {
    expect(validateCommand(`sort ${path.join(work, '{notes.txt,.env.example}')}`, undefined, qa.home).valid).toBe(true);
  });

  it('ne confond pas un bloc shell ou un crochet littéral avec un glob de fichier', () => {
    expect(findCredentialPathInCommand('{ echo public; }', process.platform, work)).toBeNull();
    expect(findCredentialPathInCommand("echo '['", process.platform, work)).toBeNull();
  });
});

describe('reprise n°30 : casse des fichiers privés du HOME', () => {
  it('classe la variante Windows de .docker/config.json, même si le chemin lexical change de casse', () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
    try {
      Object.defineProperty(process, 'platform', { ...descriptor, value: 'win32' });
      const variant = path.join(qa.home, '.DOCKER', 'CONFIG.JSON');
      expect(classifySecretPath(variant).secret).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', descriptor);
    }
  });

  it('conserve un config.json ordinaire hors du HOME privé', () => {
    expect(classifySecretPath(path.join(work, 'config.json')).secret).toBe(false);
  });
});
