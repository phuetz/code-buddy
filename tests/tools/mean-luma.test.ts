import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  DARK_SCENE_LUMA_THRESHOLD,
  meanLumaFromPng,
  meanLumaOfImage,
} from '../../src/tools/vision/mean-luma.js';

const BLACK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAADElEQVR4nGNgGB4AAADIAAGtQHYiAAAAAElFTkSuQmCC',
  'base64',
);
const BRIGHT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFUlEQVR4nGM8ceIEAzbAhFV00EoAANcnAmjjOKqVAAAAAElFTkSuQmCC',
  'base64',
);

describe('mean luma (SENSE1 darkness door)', () => {
  it('reads a black PNG as luma 0, below the SENSE1 floor', () => {
    const luma = meanLumaFromPng(BLACK_PNG);
    expect(luma).toBe(0);
    expect(luma!).toBeLessThan(DARK_SCENE_LUMA_THRESHOLD);
  });

  it('reads a bright PNG as luma well above the SENSE1 floor', () => {
    const luma = meanLumaFromPng(BRIGHT_PNG);
    expect(luma).toBeGreaterThan(DARK_SCENE_LUMA_THRESHOLD);
  });

  it('meanLumaOfImage agrees with the PNG decoder on a real file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mean-luma-'));
    const file = path.join(dir, 'black.png');
    try {
      await writeFile(file, BLACK_PNG);
      await expect(meanLumaOfImage(file)).resolves.toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
