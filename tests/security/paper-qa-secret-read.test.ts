import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = vi.hoisted(() => {
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const root = `${process.cwd()}/_qa/socle/paper-qa`;
  const home = `${root}/home`;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { root, home, previousHome, previousUserProfile };
});

import fs from 'node:fs';
import path from 'node:path';
import { parsePdfStructure } from '../../src/research/paper-qa/pdf-structure.js';
import { PaperQaTool, resolvePdfPaths } from '../../src/tools/paper-qa-tool.js';

const privatePdf = path.join(qa.home, '.codebuddy', 'sessions', 'private.pdf');
const tokenFile = path.join(qa.home, '.codebuddy', 'codex-auth.json');
const alias = path.join(qa.root, 'work', 'innocent.pdf');
const ordinary = path.join(qa.root, 'work', 'article.pdf');

beforeAll(() => {
  fs.mkdirSync(path.dirname(privatePdf), { recursive: true });
  fs.mkdirSync(path.dirname(alias), { recursive: true });
  fs.writeFileSync(privatePdf, 'FAKE-SESSION-PDF');
  fs.writeFileSync(tokenFile, 'FAKE-OAUTH-PDF');
  fs.writeFileSync(ordinary, 'PUBLIC-PDF');
  if (process.platform !== 'win32') fs.symlinkSync(tokenFile, alias);
});

afterAll(() => {
  fs.rmSync(qa.root, { recursive: true, force: true });
  if (qa.previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.previousHome;
  if (qa.previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = qa.previousUserProfile;
});

describe('paper_qa refuse les PDF classés avant lecture', () => {
  it('écarte une session PDF privée, même dans un dossier parcouru', async () => {
    expect(await resolvePdfPaths([privatePdf])).toEqual([]);
    expect(await resolvePdfPaths([path.dirname(privatePdf)])).toEqual([]);
    expect(await resolvePdfPaths([ordinary])).toEqual([ordinary]);

    const resolveProvider = vi.fn(async () => null);
    const result = await new PaperQaTool({ resolveProvider }).execute({ question: 'Quel contenu ?', paths: [privatePdf] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('FAKE-SESSION-PDF');
    expect(resolveProvider).not.toHaveBeenCalled();
  });

  it('ne passe pas un chemin classé au lecteur PDF, même s’il est injecté', async () => {
    const readFile = vi.fn(async () => Buffer.from('FAKE-SESSION-PDF'));
    const parsePdf = vi.fn(async () => ({ pages: [{ num: 1, text: 'FAKE-SESSION-PDF' }], total: 1 }));
    expect(await parsePdfStructure(privatePdf, { readFile, parsePdf })).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
    expect(parsePdf).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === 'win32')('écarte un lien PDF vers un fichier d’identifiants', async () => {
    expect(await resolvePdfPaths([alias])).toEqual([]);
    const readFile = vi.fn(async () => Buffer.from('FAKE-OAUTH-PDF'));
    expect(await parsePdfStructure(alias, { readFile })).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });
});
