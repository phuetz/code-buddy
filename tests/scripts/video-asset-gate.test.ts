import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  dHashFrame,
  deliveryFilename,
  hammingDistance,
  perceptualDuplicate,
  registerVideoAssets,
} from '../../scripts/trailers/video-asset-gate.js';

describe('video asset fingerprint and versioning gate', () => {
  it('computes stable dHash values and detects near-identical stock', () => {
    const frame = Uint8Array.from({ length: 72 }, (_, index) => index % 9);
    const changed = Uint8Array.from(frame);
    changed[0] = 2;
    const left = dHashFrame(frame);
    const right = dHashFrame(changed);
    expect(left).toMatch(/^[a-f0-9]{16}$/u);
    expect(hammingDistance(left, right)).toBeLessThanOrEqual(2);
    expect(perceptualDuplicate([left], [right])).toBe(true);
  });

  it('uses an unambiguous physical filename schema', () => {
    expect(deliveryFilename({
      titleId: 'Les Sœurs',
      language: 'fr',
      role: 'alternate',
      revision: 2,
      masterId: 'master 2026',
    })).toBe('les-s-urs--fr--alternate--r2--master-2026.mp4');
  });

  it('refuses a fake directorscut and unexplained cross-title stock reuse', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-asset-gate-'));
    const registryPath = path.join(root, 'index.json');
    const fingerprint = async () => ({
      sha256: 'a'.repeat(64),
      perceptualFrames: ['0123456789abcdef'],
    });
    try {
      await registerVideoAssets(
        [path.join(root, 'master.mp4')],
        {
          titleId: 'book-a',
          masterId: 'master-a',
          role: 'master',
          registryPath,
        },
        { fingerprint },
      );
      await expect(registerVideoAssets(
        [path.join(root, 'directorscut.mp4')],
        {
          titleId: 'book-a',
          masterId: 'master-a',
          role: 'alternate',
          revision: 2,
          differenceJustification: 'nouveau montage annoncé',
          registryPath,
        },
        { fingerprint },
      )).rejects.toThrow(/bit-for-bit identical/iu);
      await expect(registerVideoAssets(
        [path.join(root, 'recycled.mp4')],
        {
          titleId: 'book-b',
          masterId: 'master-b',
          role: 'shot',
          registryPath,
        },
        { fingerprint },
      )).rejects.toThrow(/cross-title stock reuse/iu);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
