import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateLisaSelfieCache } from '../../src/companion/lisa-selfie-cache.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('Lisa selfie cache generator', () => {
  it('pre-generates the requested number of images per style', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lisa-cache-'));
    roots.push(root);
    const source = path.join(root, 'source.png');
    await fs.writeFile(source, Buffer.from([1, 2, 3]));
    const generate = vi.fn(async () => ({ success: true, outputPath: source }));

    const result = await generateLisaSelfieCache({
      rootDir: root,
      styles: ['tender', 'playful'],
      imagesPerStyle: 2,
      generate,
    });

    expect(result.generated).toBe(4);
    expect(result.failed).toBe(0);
    expect(generate).toHaveBeenCalledTimes(4);
    expect(result.contentTier).toBe('safe');
    expect(await fs.stat(path.join(result.cacheDir, 'safe', 'tender', 'tender-001.png'))).toBeTruthy();
  });

  it('keeps sensual images in a distinct tier with a non-explicit prompt', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lisa-cache-'));
    roots.push(root);
    const source = path.join(root, 'source.png');
    await fs.writeFile(source, Buffer.from([1, 2, 3]));
    const prompts: string[] = [];

    const result = await generateLisaSelfieCache({
      rootDir: root,
      contentTier: 'sensual',
      styles: ['studio'],
      imagesPerStyle: 1,
      generate: async (prompt) => {
        prompts.push(prompt);
        return { success: true, outputPath: source };
      },
    });

    expect(result.contentTier).toBe('sensual');
    expect(prompts[0]).toContain('tasteful non-explicit boudoir');
    expect(prompts[0]).toContain('intimate areas fully covered');
    expect(prompts[0]).toContain('clean warm-grey beauty studio');
    expect(prompts[0]).toContain('no split screen');
    expect(await fs.stat(path.join(result.cacheDir, 'sensual', 'studio', 'studio-001.png'))).toBeTruthy();
    const sidecar = JSON.parse(await fs.readFile(
      path.join(result.cacheDir, 'sensual', 'studio', 'studio-001.json'),
      'utf8',
    )) as Record<string, unknown>;
    expect(sidecar.momentId).toBe('studio-confidence');
    expect(sidecar.momentCategory).toBe('creative');
  });

  it('fails closed for explicit generation without the adult-content gate', async () => {
    await expect(generateLisaSelfieCache({
      contentTier: 'explicit',
      env: { CODEBUDDY_ADULT_CONTENT_ENABLED: 'false' },
    })).rejects.toThrow(/verified adult-content route/i);
  });

  it('requires a separate approved prompt provider even when the adult gate is enabled', async () => {
    await expect(generateLisaSelfieCache({
      contentTier: 'explicit',
      env: { CODEBUDDY_ADULT_CONTENT_ENABLED: 'true' },
    })).rejects.toThrow(/separate policy-approved prompt provider/i);
  });
});
