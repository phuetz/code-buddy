import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  buildLisaTrainingPrompts,
  generateLisaTrainingSet,
  LISA_IDENTITY_BLOCK,
} from '../../src/lora/generate-training-set.js';

describe('generate-training-set', () => {
  it('builds deterministic prompts with shared identity + trigger', () => {
    const a = buildLisaTrainingPrompts(12);
    const b = buildLisaTrainingPrompts(12);
    expect(a).toEqual(b);
    expect(a).toHaveLength(12);
    expect(a[0]!.prompt.startsWith('ohwx lisa')).toBe(true);
    expect(a.every((s) => s.prompt.includes(LISA_IDENTITY_BLOCK.slice(0, 20)))).toBe(true);
    expect(new Set(a.map((s) => s.id)).size).toBe(12);
  });

  it('writes images and captions via injectable generate', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-trainset-'));
    let calls = 0;
    const result = await generateLisaTrainingSet({
      name: 'lisa',
      count: 3,
      rootDir: root,
      loraRoot: path.join(root, 'lora'),
      resume: false,
      generate: async () => {
        calls += 1;
        const p = path.join(root, `gen-${calls}.png`);
        await fs.writeFile(p, Buffer.from([137, 80, 78, 71, calls]));
        return { success: true, outputPath: p };
      },
    });
    expect(result.generated).toBe(3);
    expect(result.failed).toBe(0);
    expect(calls).toBe(3);
    const names = await fs.readdir(result.imagesDir);
    expect(names.filter((n) => n.endsWith('.png'))).toHaveLength(3);
    expect(names.filter((n) => n.endsWith('.txt'))).toHaveLength(3);
    const cap = await fs.readFile(path.join(result.imagesDir, 'lisa_001.txt'), 'utf8');
    expect(cap.trim()).toMatch(/^ohwx lisa, /u);
    expect(cap).toContain(LISA_IDENTITY_BLOCK);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('resumes by skipping existing files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-trainset2-'));
    const loraRoot = path.join(root, 'lora');
    let calls = 0;
    const gen = async () => {
      calls += 1;
      const p = path.join(root, `g-${calls}.png`);
      await fs.writeFile(p, Buffer.from([1, 2, 3, calls]));
      return { success: true, outputPath: p };
    };
    await generateLisaTrainingSet({
      name: 'lisa',
      count: 2,
      rootDir: root,
      loraRoot,
      generate: gen,
    });
    const firstCalls = calls;
    const second = await generateLisaTrainingSet({
      name: 'lisa',
      count: 2,
      rootDir: root,
      loraRoot,
      resume: true,
      generate: gen,
    });
    expect(second.skipped).toBe(2);
    expect(calls).toBe(firstCalls);
    await fs.rm(root, { recursive: true, force: true });
  });
});
