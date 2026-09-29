import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const qa = vi.hoisted(() => {
  const root = `${process.cwd()}/_qa/securite-reprise-codebase`;
  const previousHome = process.env.HOME;
  process.env.HOME = `${root}/home`;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { root, home: `${root}/home`, previousHome };
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CodebaseReplaceTool } from '../../src/tools/registry/codebase-replace-tools.js';
import { codebaseReplace } from '../../src/tools/codebase-replace-tool.js';

const fake = 'FAKE-PROJECT-SECRET-259';
let work: string;
const secretEnv = () => path.join(work, 'prod.env');
const secretJson = () => path.join(work, 'secrets.json');
const ordinary = () => path.join(work, 'notes.txt');

async function inWorkspace<T>(task: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(work);
  try { return await task(); } finally { process.chdir(previous); }
}

beforeAll(() => {
  fs.rmSync(qa.root, { recursive: true, force: true });
  fs.mkdirSync(qa.home, { recursive: true });
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-codebase-secret-'));
});

beforeEach(() => {
  fs.writeFileSync(secretEnv(), `API_KEY=${fake}\n`);
  fs.writeFileSync(secretJson(), JSON.stringify({ api_key: fake }));
  fs.writeFileSync(ordinary(), 'release-note: old\n');
});

afterAll(() => {
  fs.rmSync(qa.root, { recursive: true, force: true });
  if (work) fs.rmSync(work, { recursive: true, force: true });
  if (qa.previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.previousHome;
});

describe('codebase_replace protège les secrets du projet', () => {
  it('ne montre pas le contenu de prod.env dans le dry-run de l’outil agent', async () => {
    const result = await inWorkspace(() => new CodebaseReplaceTool().execute({
      search_pattern: fake,
      replacement: 'MASKED',
      dry_run: true,
    }));
    expect(result.success).toBe(true);
    expect(result.output).not.toContain(fake);
    expect(result.output).toBe('No matches found.');
    expect(fs.readFileSync(secretEnv(), 'utf8')).toContain(fake);
  });

  it('ne lit ni ne réécrit secrets.json, tout en modifiant un fichier ordinaire', async () => {
    const secretResult = await inWorkspace(() => codebaseReplace(fake, 'MASKED'));
    expect(secretResult.filesChanged).toBe(0);
    expect(fs.readFileSync(secretJson(), 'utf8')).toContain(fake);
    expect(fs.readFileSync(secretEnv(), 'utf8')).toContain(fake);

    const ordinaryResult = await inWorkspace(() => codebaseReplace('old', 'new'));
    expect(ordinaryResult.filesChanged).toBe(1);
    expect(fs.readFileSync(ordinary(), 'utf8')).toContain('release-note: new');
  });
});
