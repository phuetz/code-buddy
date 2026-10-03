import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = await vi.hoisted(async () => {
  const { join, normalize } = await import('node:path');
  const root = normalize(join(process.cwd(), '_qa', 'securite-understand-video'));
  const home = join(root, 'home');
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { root, home, previousHome, previousUserProfile };
});

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { understandVideo } from '../../src/tools/video/video-understanding.js';

const credential = path.join(qa.home, '.codebuddy', 'codex-auth.json');
const ordinary = path.join(qa.root, 'work', 'scene.mp4');
const fake = 'FAKE-VIDEO-SECRET';

beforeAll(async () => {
  await fs.rm(qa.root, { recursive: true, force: true });
  await fs.mkdir(path.dirname(credential), { recursive: true });
  await fs.mkdir(path.dirname(ordinary), { recursive: true });
  await fs.writeFile(credential, JSON.stringify({ access_token: fake }));
  await fs.writeFile(ordinary, 'ordinary video fixture');
});

afterAll(async () => {
  await fs.rm(qa.root, { recursive: true, force: true });
  if (qa.previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.previousHome;
  if (qa.previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = qa.previousUserProfile;
});

describe('understand_video et fichiers locaux', () => {
  it('refuse un identifiant avant de le transmettre à l’extracteur audio', async () => {
    const extractAudio = vi.fn(async () => ({ success: false, error: 'fixture' }));
    const deps = { outDir: path.join(qa.root, 'output'), extractAudio };

    const denied = await understandVideo({ source: credential }, deps);
    expect(denied).toHaveProperty('error', expect.stringMatching(/credential\/secret/i));
    expect(JSON.stringify(denied)).not.toContain(fake);
    expect(extractAudio).not.toHaveBeenCalled();

    const allowed = await understandVideo({ source: ordinary }, deps);
    expect(allowed).toEqual({ error: 'fixture' });
    expect(extractAudio).toHaveBeenCalledExactlyOnceWith(ordinary);
  });
});
