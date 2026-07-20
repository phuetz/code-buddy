import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildWorkflow,
  candidateComplete,
  imageFromOutputs,
  parseCount,
  validateBaseUrl,
} from '../../../scripts/darkstar/generate-krea2-identity-dataset.js';

describe('validateBaseUrl', () => {
  it.each([
    ['http://127.0.0.1:8189', 'http://127.0.0.1:8189/'],
    ['http://localhost:8189/', 'http://localhost:8189/'],
    ['http://100.64.0.1:8189', 'http://100.64.0.1:8189/'],
    ['https://100.127.255.254', 'https://100.127.255.254/'],
  ])('accepts a loopback or Tailscale root URL: %s', (input, expected) => {
    expect(validateBaseUrl(input).href).toBe(expected);
  });

  it.each([
    'https://example.com',
    'http://100.63.255.255:8189',
    'http://100.128.0.1:8189',
    'http://100.64.0.1.evil.example:8189',
    'http://user:secret@100.64.0.1:8189',
    'http://100.64.0.1:8189/api',
    'ftp://100.64.0.1:8189',
  ])('rejects a URL outside the private generation boundary: %s', (input) => {
    expect(() => validateBaseUrl(input)).toThrow(/loopback|Tailscale/);
  });
});

describe('dataset workflow helpers', () => {
  it('bounds the candidate count', () => {
    expect(parseCount('1')).toBe(1);
    expect(parseCount('24')).toBe(24);
    for (const invalid of ['0', '25', '1.5', 'NaN']) {
      expect(() => parseCount(invalid)).toThrow(/integer between 1 and 24/);
    }
  });

  it('extracts only an actual ComfyUI image output', () => {
    expect(imageFromOutputs({
      '13': { images: [{ filename: 'lisa.png', subfolder: 'identity', type: 'output' }] },
    })).toEqual({ filename: 'lisa.png', subfolder: 'identity', type: 'output' });
    expect(imageFromOutputs({ '13': { images: [{ filename: 42 }] } })).toBeUndefined();
    expect(imageFromOutputs(null)).toBeUndefined();
  });

  it('pins the Krea 2 model, identity adapter and safe output dimensions', () => {
    const workflow = buildWorkflow({
      reference: 'approved.png',
      prompt: 'same adult character, front portrait',
      seed: 123,
      prefix: 'candidate/lisa',
    });
    expect(workflow['1']).toMatchObject({
      class_type: 'UNETLoader',
      inputs: { unet_name: 'krea2_turbo_fp8_scaled.safetensors' },
    });
    expect(workflow['4']).toMatchObject({
      class_type: 'LoraLoaderModelOnly',
      inputs: { lora_name: 'krea2_identity_edit_v1_2_r64.safetensors' },
    });
    expect(workflow['10']).toMatchObject({
      class_type: 'EmptySD3LatentImage',
      inputs: { width: 768, height: 1024, batch_size: 1 },
    });
  });

  it('recognises only a complete candidate with matching metadata hash', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'krea-candidate-'));
    const id = 'lisa_identity_001';
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    const outputSha256 = createHash('sha256').update(image).digest('hex');
    expect(await candidateComplete(root, id)).toBe(false);
    await fs.writeFile(path.join(root, `${id}.png`), image);
    await expect(candidateComplete(root, id)).rejects.toThrow(/Incomplete candidate/);
    await fs.writeFile(path.join(root, `${id}.txt`), 'ohwx lisa\n');
    await fs.writeFile(path.join(root, `${id}.json`), JSON.stringify({ id, outputSha256 }));
    expect(await candidateComplete(root, id)).toBe(true);
    await fs.writeFile(path.join(root, `${id}.json`), JSON.stringify({ id, outputSha256: '0'.repeat(64) }));
    await expect(candidateComplete(root, id)).rejects.toThrow(/metadata\/hash mismatch/);
    await fs.rm(root, { recursive: true, force: true });
  });
});
