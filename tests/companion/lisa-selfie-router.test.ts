/**
 * Cache-first Lisa selfie router: photo requests never wait on the generator.
 * Fixtures are 1×1 PNG buffers created in the test (never real portraits).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'node:url';

import { isLisaSelfieRequest } from '../../src/companion/lisa-selfie.js';
import { tryServeCompanionSelfie } from '../../src/companion/lisa-selfie-router.js';
import {
  evictLisaSelfieCacheOverflow,
  maybeIngestGeneratedLisaSelfie,
} from '../../src/companion/lisa-selfie-ingest.js';
import { runLisaSelfieRefillPass } from '../../src/companion/lisa-selfie-refill.js';

const QA = fileURLToPath(new URL('../../_qa/selfie', import.meta.url));
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const PHOTO_REQUESTS = [
  'Envoie-moi une photo de toi',
  'envoie-moi un selfie',
  'Montre-moi un portrait de toi',
  'Send me a picture of you',
  'Show me a selfie',
  'Une photo de toi sur la plage',
  'Envoie-moi une photo de toi en pull',
  'Ta photo s\'il te plaît',
  'Fais-moi un selfie',
  'Lisa, send me a photo of you',
];

const NEIGHBORS = [
  'Envoie-moi une photo de chat',
  'Prends une photo de l\'écran',
  'Qu\'est-ce que tu vois',
  'Génère une image de paysage',
  'Explique la photosynthèse',
];

const roots: string[] = [];

async function makeRoot(prefix: string): Promise<string> {
  await fs.mkdir(QA, { recursive: true });
  const root = await fs.mkdtemp(path.join(QA, `${prefix}-`));
  roots.push(root);
  return root;
}

async function writePng(file: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, PNG_1X1);
}

beforeEach(() => {
  delete process.env.CODEBUDDY_COMPANION_PERSONA;
  delete process.env.CODEBUDDY_LISA_SELFIE;
  delete process.env.CODEBUDDY_LISA_SELFIE_CACHE_DIR;
  delete process.env.CODEBUDDY_LISA_SELFIE_RECENT_FILE;
  delete process.env.CODEBUDDY_LISA_CONTENT_TIER;
  delete process.env.CODEBUDDY_ADULT_CONTENT_ENABLED;
  delete process.env.CODEBUDDY_LISA_SELFIE_REFILL;
  delete process.env.CODEBUDDY_USER_NAME;
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('Lisa selfie request routing', () => {
  it('matches 10 photo-of-you phrases and rejects 5 neighbors', () => {
    for (const phrase of PHOTO_REQUESTS) {
      expect(isLisaSelfieRequest(phrase), phrase).toBe(true);
    }
    for (const phrase of NEIGHBORS) {
      expect(isLisaSelfieRequest(phrase), phrase).toBe(false);
    }
  });
});

describe('tryServeCompanionSelfie cache-first', () => {
  it('serves a cache image immediately for each photo request, including styled ones', async () => {
    const root = await makeRoot('serve');
    const cacheDir = path.join(root, 'cache');
    const rotationPath = path.join(root, 'recent-selfies.json');
    await writePng(path.join(cacheDir, 'safe', 'portrait', 'portrait-001.png'));
    await writePng(path.join(cacheDir, 'safe', 'soft-editorial', 'soft-001.png'));
    await writePng(path.join(cacheDir, 'safe', 'wet-selfie', 'wet-001.png'));
    const generate = vi.fn();

    for (const phrase of PHOTO_REQUESTS) {
      const served = await tryServeCompanionSelfie(phrase, {
        surface: 'telegram',
        cacheDir,
        rotationPath,
        env: {
          CODEBUDDY_LISA_SELFIE_CACHE_DIR: cacheDir,
          CODEBUDDY_LISA_SELFIE_RECENT_FILE: rotationPath,
        } as NodeJS.ProcessEnv,
        includeImageBytes: true,
      });
      expect(served, phrase).not.toBeNull();
      expect(served?.reason, phrase).toBe('ok');
      expect(served?.imagePath, phrase).toBeTruthy();
      expect(served?.imageBase64, phrase).toBeTruthy();
      expect(served?.caption, phrase).toMatch(/photo|Voilà|Tiens|portrait/i);
    }
    expect(generate).not.toHaveBeenCalled();
  });

  it('does not serve a selfie for neighbor phrases', async () => {
    const root = await makeRoot('neighbors');
    const cacheDir = path.join(root, 'cache');
    await writePng(path.join(cacheDir, 'safe', 'portrait', 'portrait-001.png'));
    for (const phrase of NEIGHBORS) {
      const served = await tryServeCompanionSelfie(phrase, {
        surface: 'mobile',
        cacheDir,
        rotationPath: path.join(root, 'recent.json'),
      });
      expect(served, phrase).toBeNull();
    }
  });

  it('never returns the same cache file twice in a row', async () => {
    const root = await makeRoot('rotate');
    const cacheDir = path.join(root, 'cache');
    const rotationPath = path.join(root, 'recent-selfies.json');
    const a = path.join(cacheDir, 'safe', 'portrait', 'a.png');
    const b = path.join(cacheDir, 'safe', 'portrait', 'b.png');
    await writePng(a);
    await writePng(b);
    const env = {
      CODEBUDDY_LISA_SELFIE_CACHE_DIR: cacheDir,
      CODEBUDDY_LISA_SELFIE_RECENT_FILE: rotationPath,
    } as NodeJS.ProcessEnv;
    const first = await tryServeCompanionSelfie('envoie-moi un selfie', {
      surface: 'voice',
      cacheDir,
      rotationPath,
      env,
    });
    const second = await tryServeCompanionSelfie('envoie-moi un selfie', {
      surface: 'voice',
      cacheDir,
      rotationPath,
      env,
    });
    expect(first?.imagePath).toBeTruthy();
    expect(second?.imagePath).toBeTruthy();
    expect(second?.imagePath).not.toBe(first?.imagePath);
  });

  it('refuses an explicit request when the adult gate is off', async () => {
    const root = await makeRoot('gate');
    const cacheDir = path.join(root, 'cache');
    await writePng(path.join(cacheDir, 'safe', 'portrait', 'portrait-001.png'));
    await writePng(path.join(cacheDir, 'explicit', 'portrait', 'nope.png'));
    const served = await tryServeCompanionSelfie('envoie-moi une photo nue de toi', {
      surface: 'telegram',
      cacheDir,
      rotationPath: path.join(root, 'recent.json'),
      env: { CODEBUDDY_ADULT_CONTENT_ENABLED: 'false' } as NodeJS.ProcessEnv,
    });
    expect(served?.refused).toBe(true);
    expect(served?.reason).toBe('explicit-gate');
    expect(served?.imagePath).toBeUndefined();
    expect(served?.caption).toMatch(/pas|côté|simple/i);
  });

  it('uses historical captions when the copine persona is unset (byte-identical pool)', async () => {
    const root = await makeRoot('byte');
    const cacheDir = path.join(root, 'cache');
    await writePng(path.join(cacheDir, 'safe', 'portrait', 'portrait-001.png'));
    const served = await tryServeCompanionSelfie('envoie-moi un selfie', {
      surface: 'mobile',
      cacheDir,
      rotationPath: path.join(root, 'recent.json'),
      env: {} as NodeJS.ProcessEnv,
    });
    expect(served?.caption).toBe('Voilà — une photo de moi.');
  });
});

describe('Lisa selfie cache ingest + eviction', () => {
  it('copies a generated 1×1 PNG into tier/style with a sidecar', async () => {
    const root = await makeRoot('ingest');
    const cacheDir = path.join(root, 'cache');
    const source = path.join(root, 'out.png');
    await writePng(source);
    const result = await maybeIngestGeneratedLisaSelfie({
      sourcePath: source,
      prompt: 'ohwx lisa, selfie portrait, tasteful',
      contentTier: 'safe',
      style: 'portrait',
      model: 'test-model',
      env: { CODEBUDDY_LISA_SELFIE_CACHE_DIR: cacheDir } as NodeJS.ProcessEnv,
      rootDir: root,
      now: () => new Date('2026-09-06T12:00:00.000Z'),
    });
    expect(result.ingested).toBe(true);
    expect(result.destPath).toMatch(/safe[/\\]portrait[/\\].*png$/);
    const sidecar = JSON.parse(
      await fs.readFile(result.destPath!.replace(/\.png$/i, '.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(sidecar.tier).toBe('safe');
    expect(sidecar.style).toBe('portrait');
    expect(sidecar.source).toBe('test-model');
    expect(sidecar.prompt).toBeUndefined();
    expect(sidecar.hash).toMatch(/^[a-f0-9]{12}$/);
    expect(typeof sidecar.createdAt).toBe('string');
    expect(sidecar.favorite).toBe(false);
  });

  it('never persists a raw prompt (fictional first name stays out of the sidecar)', async () => {
    const root = await makeRoot('ingest-pii');
    const cacheDir = path.join(root, 'cache');
    const source = path.join(root, 'out.png');
    await writePng(source);
    const result = await maybeIngestGeneratedLisaSelfie({
      sourcePath: source,
      prompt: 'ohwx lisa, selfie portrait, looking at Camille, tasteful',
      contentTier: 'safe',
      style: 'portrait',
      provider: 'refill',
      env: { CODEBUDDY_LISA_SELFIE_CACHE_DIR: cacheDir } as NodeJS.ProcessEnv,
      rootDir: root,
      now: () => new Date('2026-09-06T12:00:00.000Z'),
    });
    expect(result.ingested).toBe(true);
    const raw = await fs.readFile(result.destPath!.replace(/\.png$/i, '.json'), 'utf8');
    expect(raw).not.toMatch(/Camille/i);
    expect(raw).not.toMatch(/looking at/i);
    const sidecar = JSON.parse(raw) as Record<string, unknown>;
    expect(sidecar).toEqual({
      tier: 'safe',
      style: 'portrait',
      hash: expect.stringMatching(/^[a-f0-9]{12}$/),
      createdAt: expect.any(String),
      source: 'refill',
      favorite: false,
      promptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(Object.keys(sidecar).sort()).toEqual(
      ['createdAt', 'favorite', 'hash', 'promptHash', 'source', 'style', 'tier'].sort(),
    );
  });

  it('evicts the oldest non-favorite when over the max', async () => {
    const root = await makeRoot('evict');
    const cacheDir = path.join(root, 'cache');
    const oldFile = path.join(cacheDir, 'safe', 'portrait', 'old.png');
    const favFile = path.join(cacheDir, 'safe', 'portrait', 'fav.png');
    const newFile = path.join(cacheDir, 'safe', 'portrait', 'new.png');
    await writePng(oldFile);
    await writePng(favFile);
    await writePng(newFile);
    await fs.writeFile(
      favFile.replace(/\.png$/, '.json'),
      JSON.stringify({ favorite: true }),
    );
    const older = new Date('2026-01-01T00:00:00Z');
    const newer = new Date('2026-09-01T00:00:00Z');
    await fs.utimes(oldFile, older, older);
    await fs.utimes(favFile, older, older);
    await fs.utimes(newFile, newer, newer);
    const evicted = await evictLisaSelfieCacheOverflow(cacheDir, 2);
    expect(evicted).toBe(1);
    await expect(fs.stat(oldFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(favFile)).resolves.toBeTruthy();
    await expect(fs.stat(newFile)).resolves.toBeTruthy();
  });

  it('skips non-Lisa prompts', async () => {
    const root = await makeRoot('skip');
    const source = path.join(root, 'cat.png');
    await writePng(source);
    const result = await maybeIngestGeneratedLisaSelfie({
      sourcePath: source,
      prompt: 'a landscape with a river',
      env: { CODEBUDDY_LISA_SELFIE_CACHE_DIR: path.join(root, 'cache') } as NodeJS.ProcessEnv,
      rootDir: root,
    });
    expect(result.ingested).toBe(false);
    expect(result.skipped).toBe('not-lisa');
  });
});

describe('Lisa selfie refill heartbeat', () => {
  it('is a no-op when the opt-in flag is unset (byte-identical)', async () => {
    const generate = vi.fn();
    const result = await runLisaSelfieRefillPass({
      env: {} as NodeJS.ProcessEnv,
      generate,
      probeGenerator: async () => true,
      load1: () => 0,
    });
    expect(result.skipped).toBe('disabled');
    expect(generate).not.toHaveBeenCalled();
  });

  it('generates one image per pass with an injected generator', async () => {
    const root = await makeRoot('refill');
    const cacheDir = path.join(root, 'cache');
    const source = path.join(root, 'gen.png');
    await writePng(source);
    const generate = vi.fn(async () => ({ success: true, outputPath: source }));
    const result = await runLisaSelfieRefillPass({
      env: {
        CODEBUDDY_LISA_SELFIE_REFILL: 'true',
        CODEBUDDY_LISA_SELFIE_CACHE_DIR: cacheDir,
        CODEBUDDY_LISA_SELFIE_REFILL_MIN: '1',
      } as NodeJS.ProcessEnv,
      rootDir: root,
      generate,
      probeGenerator: async () => true,
      load1: () => 0.1,
    });
    expect(result.generated).toBe(true);
    expect(generate).toHaveBeenCalledOnce();
    expect(result.style).toBeTruthy();
  });

  it('refills a generic Lisa image without a first name in the prompt or sidecar', async () => {
    const root = await makeRoot('refill-pii');
    const cacheDir = path.join(root, 'cache');
    const source = path.join(root, 'gen.png');
    await writePng(source);
    let captured = '';
    const generate = vi.fn(async (prompt: string) => {
      captured = prompt;
      return { success: true, outputPath: source };
    });
    const result = await runLisaSelfieRefillPass({
      env: {
        CODEBUDDY_LISA_SELFIE_REFILL: 'true',
        CODEBUDDY_LISA_SELFIE_CACHE_DIR: cacheDir,
        CODEBUDDY_LISA_SELFIE_REFILL_MIN: '1',
        CODEBUDDY_USER_NAME: 'Camille',
      } as NodeJS.ProcessEnv,
      rootDir: root,
      generate,
      probeGenerator: async () => true,
      load1: () => 0.1,
    });
    expect(result.generated).toBe(true);
    expect(captured).not.toMatch(/Camille/i);
    expect(captured).toMatch(/looking at camera/i);
    const files = await fs.readdir(path.join(cacheDir, result.contentTier ?? 'safe', result.style ?? 'portrait'));
    const sidecarName = files.find((name) => name.endsWith('.json'));
    expect(sidecarName).toBeTruthy();
    const raw = await fs.readFile(
      path.join(cacheDir, result.contentTier ?? 'safe', result.style ?? 'portrait', sidecarName!),
      'utf8',
    );
    expect(raw).not.toMatch(/Camille/i);
    expect(JSON.parse(raw).prompt).toBeUndefined();
  });

  it('stops without looping when the generator is unreachable', async () => {
    const generate = vi.fn();
    const probe = vi.fn(async () => false);
    const result = await runLisaSelfieRefillPass({
      env: { CODEBUDDY_LISA_SELFIE_REFILL: 'true' } as NodeJS.ProcessEnv,
      generate,
      probeGenerator: probe,
      load1: () => 0,
    });
    expect(result.skipped).toBe('unreachable');
    expect(generate).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledOnce();
  });

  it('skips when load is high', async () => {
    const generate = vi.fn();
    const result = await runLisaSelfieRefillPass({
      env: {
        CODEBUDDY_LISA_SELFIE_REFILL: 'true',
        CODEBUDDY_LISA_SELFIE_REFILL_MAX_LOAD: '1',
      } as NodeJS.ProcessEnv,
      generate,
      probeGenerator: async () => true,
      load1: () => 8,
    });
    expect(result.skipped).toBe('load');
    expect(generate).not.toHaveBeenCalled();
  });
});
