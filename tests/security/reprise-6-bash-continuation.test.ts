import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = vi.hoisted(() => {
  const oldHome = process.env.HOME;
  const oldSandbox = process.env.CODEBUDDY_NATIVE_SANDBOX;
  const root = `${process.cwd()}/_qa/securite-reprise-6`;
  process.env.HOME = `${root}/home`;
  delete process.env.CODEBUDDY_NATIVE_SANDBOX;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { root, home: `${root}/home`, oldHome, oldSandbox };
});

import fs from 'node:fs';
import path from 'node:path';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import { findCredentialPathInCommand, validateCommand } from '../../src/tools/bash/command-validator.js';

const token = 'FAKE-OAUTH-REPRISE-6';
const auth = path.join(qa.home, '.codebuddy', 'codex-auth.json');
const publicProject = path.join(qa.root, 'public-project');
const secretProject = path.join(qa.root, 'secret-project');
const largeProject = path.join(qa.root, 'large-project');

beforeAll(() => {
  fs.mkdirSync(path.dirname(auth), { recursive: true });
  fs.writeFileSync(auth, JSON.stringify({ access_token: token }));
  fs.mkdirSync(publicProject, { recursive: true });
  fs.writeFileSync(path.join(publicProject, '.npmrc'),
    'engine-strict=true\npackage-lock=false\nsave-exact=true\nlegacy-peer-deps=true\n');
  fs.writeFileSync(path.join(publicProject, 'notes.txt'), 'bonjour\n');
  fs.mkdirSync(secretProject, { recursive: true });
  fs.writeFileSync(path.join(secretProject, '.env'), `TOKEN=${token}\n`);
  fs.writeFileSync(path.join(secretProject, 'notes.txt'), 'bonjour\n');
  fs.mkdirSync(largeProject, { recursive: true });
  for (let i = 0; i < 10_001; i += 1) {
    fs.writeFileSync(path.join(largeProject, `ordinary-${i}.txt`), 'bonjour\n');
  }
});

afterAll(() => {
  fs.rmSync(qa.root, { recursive: true, force: true });
  if (qa.oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.oldHome;
  if (qa.oldSandbox === undefined) delete process.env.CODEBUDDY_NATIVE_SANDBOX;
  else process.env.CODEBUDDY_NATIVE_SANDBOX = qa.oldSandbox;
});

describe('B7 — continuation de ligne dans un chemin de jeton', () => {
  it.each([
    'cat ~/.codebuddy/codex-a\\\nuth.json',
    'cat $HOME/.codebuddy/codex-a\\\nuth.json',
    'cat ~/.codebuddy/codex-a\\\r\nuth.json',
  ])('refuse le chemin recollé avant exécution : %j', (command) => {
    expect(findCredentialPathInCommand(command)).not.toBeNull();
    expect(validateCommand(command).valid).toBe(false);
  });

  it('le vrai BashTool ne renvoie plus le jeton', async () => {
    const result = await new BashTool().execute('cat ~/.codebuddy/codex-a\\\nuth.json', 1_000);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(token);
  });
});

describe('réserves B6 — recherches légitimes', () => {
  it('ne confond pas le fichier de motifs de grep/rg avec un motif littéral', () => {
    expect(validateCommand('grep -f .env notes.txt', undefined, secretProject).valid).toBe(false);
    expect(validateCommand('grep -f.env notes.txt', undefined, secretProject).valid).toBe(false);
    expect(validateCommand('grep --file=.env notes.txt', undefined, secretProject).valid).toBe(false);
    expect(validateCommand('rg -f .env notes.txt', undefined, secretProject).valid).toBe(false);
    expect(validateCommand('grep -e . notes.txt', undefined, secretProject).valid).toBe(true);
  });

  it('accepte un .npmrc public et refuse une valeur d’authentification', () => {
    expect(validateCommand('grep -r bonjour .', undefined, publicProject).valid).toBe(true);
    expect(validateCommand('cat .npmrc', undefined, publicProject).valid).toBe(false);
    fs.appendFileSync(path.join(publicProject, '.npmrc'), '//registry.npmjs.org/:_authToken=FAKE-NPM-TOKEN\n');
    expect(validateCommand('grep -r bonjour .', undefined, publicProject).valid).toBe(false);
  });

  it('ne refuse pas un arbre propre de 10 001 fichiers', () => {
    expect(validateCommand('grep -r bonjour .', undefined, largeProject).valid).toBe(true);
  });
});
