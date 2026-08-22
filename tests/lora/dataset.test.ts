import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  fillMissingCaptions,
  initLoraProject,
  validateDataset,
} from '../../src/lora/dataset.js';
import { packDatasetZip } from '../../src/lora/pack-dataset.js';
import { writeLocalTrainPlan } from '../../src/lora/local-plan.js';

describe('lora dataset pipeline', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-lora-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('inits project and validates with trigger-only captions', async () => {
    const { dir, imagesDir } = await initLoraProject({
      name: 'lisa',
      triggerPhrase: 'ohwx lisa',
      root,
      character: 'lisa',
    });
    // minimal fake images
    await fs.writeFile(path.join(imagesDir, 'a.png'), Buffer.from([137, 80, 78, 71]));
    await fs.writeFile(path.join(imagesDir, 'b.png'), Buffer.from([137, 80, 78, 71]));

    let v = await validateDataset(dir);
    expect(v.ok).toBe(true);
    expect(v.imageCount).toBe(2);
    expect(v.missingCaptions.length).toBe(2);

    const n = await fillMissingCaptions(dir, 'ohwx lisa');
    expect(n).toBe(2);
    v = await validateDataset(dir);
    expect(v.captionCount).toBe(2);
    expect(v.missingCaptions.length).toBe(0);
  });

  it('packs zip with images and captions', async () => {
    const { dir, imagesDir } = await initLoraProject({
      name: 't',
      triggerPhrase: 'tok',
      root,
    });
    await fs.writeFile(path.join(imagesDir, '1.jpg'), Buffer.from('fake'));
    await fs.writeFile(path.join(imagesDir, '1.txt'), 'tok\n');
    const { zipPath, fileCount } = await packDatasetZip(dir);
    const st = await fs.stat(zipPath);
    expect(st.size).toBeGreaterThan(20);
    expect(fileCount).toBe(2);
  });

  it('writes local train plan files', async () => {
    const { dir, imagesDir } = await initLoraProject({
      name: 'local',
      triggerPhrase: 'ohwx x',
      root,
    });
    await fs.writeFile(path.join(imagesDir, 'x.png'), Buffer.from([1, 2, 3]));
    const plan = await writeLocalTrainPlan(dir, { steps: 1200 });
    await fs.access(plan.configPath);
    await fs.access(plan.scriptPath);
    await fs.access(plan.readmePath);
    const cfg = JSON.parse(await fs.readFile(plan.configPath, 'utf8'));
    expect(cfg.config.process[0].train.steps).toBe(1200);
    expect(cfg.config.process[0].model.name_or_path).toMatch(/krea/i);
  });

  it('fails validation without images', async () => {
    const { dir } = await initLoraProject({ name: 'empty', triggerPhrase: 't', root });
    const v = await validateDataset(dir);
    expect(v.ok).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
  });
});
