import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { assessDatasetQuality, qualityGatePassed } from '../../src/lora/quality-gate.js';

describe('lora quality-gate', () => {
  it('flags tiny files and exact duplicates', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-qgate-'));
    const images = path.join(root, 'images');
    await fs.mkdir(images, { recursive: true });
    const big = Buffer.alloc(12_000, 7);
    await fs.writeFile(path.join(images, 'a.png'), big);
    await fs.writeFile(path.join(images, 'b.png'), big); // exact dup
    await fs.writeFile(path.join(images, 'tiny.png'), Buffer.from([1, 2, 3]));

    const report = await assessDatasetQuality(root, { minBytes: 8_000 });
    expect(report.imageCount).toBe(3);
    expect(report.kept.length).toBe(1);
    expect(report.reject.length).toBe(2);
    expect(report.issues.some((i) => i.kind === 'duplicate')).toBe(true);
    expect(report.issues.some((i) => i.kind === 'too_small')).toBe(true);
    // tiny is hard fail → gate fails
    expect(qualityGatePassed(report)).toBe(false);

    await fs.rm(root, { recursive: true, force: true });
  });

  it('passes when all images are unique and large enough', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-qgate2-'));
    const images = path.join(root, 'images');
    await fs.mkdir(images, { recursive: true });
    await fs.writeFile(path.join(images, 'a.png'), Buffer.alloc(10_000, 1));
    await fs.writeFile(path.join(images, 'b.png'), Buffer.alloc(10_000, 2));

    const report = await assessDatasetQuality(root);
    expect(qualityGatePassed(report)).toBe(true);
    expect(report.kept.length).toBe(2);
    expect(report.reject.length).toBe(0);

    await fs.rm(root, { recursive: true, force: true });
  });
});
