import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = await vi.hoisted(async () => {
  const path = await import('node:path');
  const previousHome = process.env.HOME;
  const previousProfile = process.env.USERPROFILE;
  const root = path.join(process.cwd(), '_qa', 'securite-reprise-23');
  const home = path.join(root, 'home');
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { root, home, previousHome, previousProfile };
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkSecretFileAccess, classifySecretPath } from '../../src/security/secret-files.js';
import { findCredentialPathInCommand, validateCommand } from '../../src/tools/bash/command-validator.js';
import { TextEditorTool } from '../../src/tools/text-editor.js';
import { SearchTool } from '../../src/tools/search.js';
import { getWorkspaceIsolation, resetWorkspaceIsolation } from '../../src/workspace/workspace-isolation.js';

const repo = path.join(qa.root, 'repo');
const work = path.join(qa.root, 'work');
const tokenPath = path.join(qa.home, '.codebuddy', 'codex-auth.json');
const aliasPath = path.join(work, 'notes.json');
const fakeToken = 'FAKE-OAUTH-R23';
const gitEnv = { ...process.env, HOME: qa.home, USERPROFILE: qa.home, GIT_CONFIG_NOSYSTEM: '1' };

function git(...args: string[]): void {
  execFileSync('git', ['-C', repo, ...args], { env: gitEnv, stdio: 'ignore' });
}

beforeAll(() => {
  expect(path.normalize(os.homedir())).toBe(path.normalize(qa.home));
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(tokenPath, JSON.stringify({ access_token: fakeToken }));
  fs.linkSync(tokenPath, aliasPath);
  fs.writeFileSync(path.join(work, 'public.json'), '{"message":"public"}');
  git('init', '-q');
  fs.writeFileSync(path.join(repo, '.env'), `API_KEY=${fakeToken}\n`);
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'ancienne note\n');
  git('add', '--', '.env', 'notes.txt');
  git('-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid', 'commit', '-qm', 'fixture');
  fs.writeFileSync(path.join(repo, '.env'), `API_KEY=${fakeToken}-MODIFIE\n`);
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'nouvelle note\n');
});

afterAll(() => {
  resetWorkspaceIsolation();
  fs.rmSync(qa.root, { recursive: true, force: true });
  if (qa.previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.previousHome;
  if (qa.previousProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = qa.previousProfile;
});

describe('reprise 23 — options Git et liens physiques', () => {
  it.each([
    'git diff --output=export.patch',
    'git diff --output export.patch',
    'git diff --name-only --output=export.txt',
    'git diff --option-inconnue',
  ])('refuse %s avant tout prévol Git', (command) => {
    expect(findCredentialPathInCommand(command, process.platform, repo)).not.toBeNull();
    expect(validateCommand(command, undefined, repo).valid).toBe(false);
  });

  it('préserve la différence limitée au fichier public', () => {
    expect(validateCommand('git diff -- notes.txt', undefined, repo).valid).toBe(true);
    expect(validateCommand('git diff --cached -- notes.txt', undefined, repo).valid).toBe(true);
  });

  it('refuse le lien physique vers le jeton par les lecteurs et le shell', async () => {
    expect(classifySecretPath(aliasPath).secret).toBe(true);
    expect(checkSecretFileAccess(aliasPath, 'write').secret).toBe(true);
    expect(validateCommand('cat notes.json', undefined, work).valid).toBe(false);
    getWorkspaceIsolation({ workspaceRoot: work, enabled: true });
    const editor = new TextEditorTool();
    editor.setBaseDirectory(work);
    const result = await editor.view(aliasPath);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(fakeToken);
    const search = new SearchTool();
    search.setCurrentDirectory(work);
    const matches = await search.search(fakeToken, { searchType: 'text', includeHidden: true });
    expect(JSON.stringify(matches)).not.toContain('notes.json');
    expect(JSON.stringify(matches)).not.toContain(`"access_token":"${fakeToken}"`);
  });

  it('préserve la lecture du fichier ordinaire', async () => {
    expect(classifySecretPath(path.join(work, 'public.json')).secret).toBe(false);
    getWorkspaceIsolation({ workspaceRoot: work, enabled: true });
    const editor = new TextEditorTool();
    editor.setBaseDirectory(work);
    const result = await editor.view(path.join(work, 'public.json'));
    expect(result.success).toBe(true);
    expect(JSON.stringify(result)).toContain('public');
  });
});
