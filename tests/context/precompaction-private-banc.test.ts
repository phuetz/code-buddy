import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrecompactionFlusher } from '../../src/context/precompaction-flush.js';

vi.mock('../../src/memory/decision-memory.js', () => ({
  getDecisionMemory: () => ({ getDecisionPromptEnhancement: () => '', extractDecisions: () => ({ decisions: [] }) }),
}));

let root: string;
let workspace: string;
let profile: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'flush-private-'));
  workspace = path.join(root, 'public-project');
  profile = path.join(root, 'profile');
  fs.mkdirSync(workspace);
  vi.stubEnv('CODEBUDDY_HOME', profile);
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

async function flush(workDir = workspace) {
  return new PrecompactionFlusher().flush([
    { role: 'user', content: 'Fix the project.' },
    { role: 'assistant', content: 'Reading.' },
    { role: 'user', content: 'Use the private report.' },
    { role: 'assistant', content: 'Investigating.' },
  ], async () => '- Private report: /private/operator/report.md', workDir);
}

it('garde les faits automatiques dans le profil, sans modifier un MEMORY.md publiable', async () => {
  const existing = path.join(workspace, 'MEMORY.md');
  fs.writeFileSync(existing, '# Public documentation\n');
  const first = await flush();
  expect(first.flushed).toBe(true);
  expect(first.writtenTo?.startsWith(profile + path.sep)).toBe(true);
  expect(fs.readFileSync(existing, 'utf8')).toBe('# Public documentation\n');
  expect(fs.readFileSync(first.writtenTo!, 'utf8')).toContain('/private/operator/report.md');
  const other = path.join(root, 'other-project'); fs.mkdirSync(other);
  expect((await flush(other)).writtenTo).not.toBe(first.writtenTo);
  if (process.platform !== 'win32') {
    expect(fs.statSync(first.writtenTo!).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(first.writtenTo!)).mode & 0o777).toBe(0o700);
  }
});

it('n’annonce pas de sauvegarde et ne retombe pas dans les sources si le profil est inaccessible', async () => {
  fs.writeFileSync(profile, 'not a directory');
  expect(await flush()).toMatchObject({ flushed: false, factsCount: 0, writtenTo: null });
  expect(fs.existsSync(path.join(workspace, 'MEMORY.md'))).toBe(false);
});

it.skipIf(process.platform === 'win32')('ne suit pas un lien depuis son fichier de mémoire vers un autre fichier', async () => {
  const first = await flush();
  const outside = path.join(root, 'untouched.txt');
  fs.writeFileSync(outside, 'unchanged');
  fs.unlinkSync(first.writtenTo!);
  fs.symlinkSync(outside, first.writtenTo!);
  expect(await flush()).toMatchObject({ flushed: false, writtenTo: null });
  expect(fs.readFileSync(outside, 'utf8')).toBe('unchanged');
});
