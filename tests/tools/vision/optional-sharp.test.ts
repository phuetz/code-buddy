import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  SharpUnavailableError,
  loadSharp,
  setSharpImporterForTests,
} from '../../../src/tools/vision/load-sharp.js';

const VISION_DIR = join(process.cwd(), 'src/tools/vision');

describe('optional sharp loader', () => {
  afterEach(() => {
    setSharpImporterForTests(null);
  });

  it('does not statically import sharp from vision modules on the default tool path', () => {
    for (const file of ['image-processor.ts', 'vision-analysis.ts']) {
      const src = readFileSync(join(VISION_DIR, file), 'utf8');
      expect(src, file).not.toMatch(/from ['"]sharp['"]/);
      expect(src, file).not.toMatch(/import sharp /);
    }
  });

  it('rejects when the importer cannot resolve sharp (the npm-pack missing-optional case)', async () => {
    setSharpImporterForTests(async () => {
      const err = new Error("Cannot find package 'sharp' imported from image-processor.js") as Error & {
        code?: string;
      };
      err.code = 'ERR_MODULE_NOT_FOUND';
      throw err;
    });

    await expect(loadSharp()).rejects.toBeInstanceOf(SharpUnavailableError);
    await expect(loadSharp()).rejects.toThrow(/npm install sharp/);
  });

  it('returns the default export when sharp is present', async () => {
    const fake = Object.assign(function sharp() { return {}; }, { versions: { sharp: '0.0.0' } });
    setSharpImporterForTests(async () => ({ default: fake }));
    const loaded = await loadSharp();
    expect(loaded).toBe(fake);
  });
});

describe('vision registry loads without sharp', () => {
  afterEach(() => {
    setSharpImporterForTests(null);
  });

  it('createVisionTools can be imported and constructed when sharp is missing', async () => {
    setSharpImporterForTests(async () => {
      throw Object.assign(new Error("Cannot find package 'sharp'"), { code: 'ERR_MODULE_NOT_FOUND' });
    });
    const { createVisionTools } = await import('../../../src/tools/registry/vision-tools.js');
    const tools = createVisionTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((tool) => tool.name === 'vision_analyze')).toBe(true);
  });
});
