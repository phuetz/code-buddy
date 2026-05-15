import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { ImageProcessorTool } from '../../src/tools/vision/image-processor.js';

describe('ImageProcessorTool', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-image-processor-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function writeSolidPng(name: string, color: { r: number; g: number; b: number }): Promise<string> {
    const imagePath = path.join(tmpDir, name);
    await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: color,
      },
    }).png().toFile(imagePath);
    return imagePath;
  }

  it('reports identical images as fully similar', async () => {
    const imagePath = await writeSolidPng('red.png', { r: 255, g: 0, b: 0 });
    const processor = ImageProcessorTool.getInstance();

    const result = await processor.compare(imagePath, imagePath);

    expect(result.similarity).toBe(1);
    expect(result.sameDimensions).toBe(true);
  });

  it('uses pixel data instead of metadata-only placeholder similarity', async () => {
    const red = await writeSolidPng('red.png', { r: 255, g: 0, b: 0 });
    const blue = await writeSolidPng('blue.png', { r: 0, g: 0, b: 255 });
    const processor = ImageProcessorTool.getInstance();

    const result = await processor.compare(red, blue);

    expect(result.similarity).toBeLessThan(0.5);
    expect(result.description).toContain('Pixel comparison');
  });
});
