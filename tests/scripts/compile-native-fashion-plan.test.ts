import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildNativeFashionPlan,
  compileNativeFashionPlan,
  type CompileNativeFashionPlanOptions,
  type NativeFashionClipProbe,
  type NativeFashionSourceDigests,
} from '../../scripts/mysoulmate/compile-native-fashion-plan.js';
import { PILOT_FASHION_SCENES } from '../../src/companion/fashion-scene-catalog.js';
import { assertPlan } from '../../scripts/mysoulmate/render-youtube-short-batch.js';

const roots: string[] = [];
const sourceDigests: NativeFashionSourceDigests = {
  imageManifestSha256: '1'.repeat(64),
  imageCatalogSha256: '2'.repeat(64),
  factoryConfigSha256: '3'.repeat(64),
  assetApprovalsSha256: '4'.repeat(64),
  productionLedgerSha256: '5'.repeat(64),
};
const passingProbe: NativeFashionClipProbe = {
  duration: 12,
  width: 1288,
  height: 1920,
  fps: 30,
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{
  root: string;
  clipPath: string;
  clipSha256: string;
  digestsPath: string;
  outPath: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-fashion-plan-'));
  roots.push(root);
  const clipPath = path.join(root, 'pilot.mp4');
  const clipBytes = Buffer.from('synthetic native fashion pilot');
  await fs.writeFile(clipPath, clipBytes);
  const digestsPath = path.join(root, 'digests.json');
  await fs.writeFile(digestsPath, JSON.stringify({ sourceDigests }));
  return {
    root,
    clipPath,
    clipSha256: createHash('sha256').update(clipBytes).digest('hex'),
    digestsPath,
    outPath: path.join(root, 'plan.json'),
  };
}

function optionsFor(value: Awaited<ReturnType<typeof fixture>>): CompileNativeFashionPlanOptions {
  return {
    clipPath: value.clipPath,
    expectedClipSha256: value.clipSha256,
    sceneId: 'pilot-black-dress-turn',
    digestsPath: value.digestsPath,
    title: 'Lisa en robe noire, mouvement original',
    description: 'Un pilote fashion vertical original de douze secondes, réservé à une revue humaine privée.',
    provenanceRef: 'mysoulmate/original-ambient-audio',
    profileRevision: 'a'.repeat(64),
    qaApproved: true,
    outPath: value.outPath,
  };
}

describe('native fashion plan compiler', () => {
  it('builds a schema V4 plan accepted by the existing renderer contract', () => {
    const scene = PILOT_FASHION_SCENES[0];
    expect(scene).toBeDefined();
    const plan = buildNativeFashionPlan({
      clipPath: '/approved/pilot.mp4',
      clipSha256: 'f'.repeat(64),
      probe: passingProbe,
      scene: scene!,
      sourceDigests,
      title: 'Lisa en robe noire, mouvement original',
      description: 'Un pilote fashion vertical original de douze secondes, réservé à une revue humaine privée.',
      provenanceRef: 'mysoulmate/original-ambient-audio',
      profileRevision: 'a'.repeat(64),
      qaApproved: true,
    });
    expect(() => assertPlan(plan)).not.toThrow();
    expect(plan).toMatchObject({
      schemaVersion: 4,
      policy: { qaStatus: 'approved', autoPublish: false },
      shorts: [{ render: { engine: 'approved-native-video' } }],
    });
  });

  it('fails closed when the declared clip digest does not match', async () => {
    const value = await fixture();
    await expect(compileNativeFashionPlan(
      { ...optionsFor(value), expectedClipSha256: 'b'.repeat(64) },
      { probe: async () => passingProbe },
    )).rejects.toThrow('mismatch');
  });

  it.each([
    [{ ...passingProbe, width: 720 }, '1080x1920'],
    [{ ...passingProbe, fps: 29.8 }, '30 fps'],
    [{ ...passingProbe, duration: 10.9 }, '11 and 13'],
  ] as const)('rejects a clip probe outside the native profile', async (probe, message) => {
    const value = await fixture();
    await expect(compileNativeFashionPlan(optionsFor(value), { probe: async () => probe }))
      .rejects.toThrow(message);
  });

  it.each([29.95, 30.05])('accepts the inclusive fps tolerance boundary at %s', (fps) => {
    const scene = PILOT_FASHION_SCENES[0];
    expect(scene).toBeDefined();
    expect(() => buildNativeFashionPlan({
      clipPath: '/approved/pilot.mp4',
      clipSha256: 'f'.repeat(64),
      probe: { ...passingProbe, fps },
      scene: scene!,
      sourceDigests,
      title: 'Lisa en robe noire, mouvement original',
      description: 'Un pilote fashion vertical original de douze secondes, réservé à une revue humaine privée.',
      provenanceRef: 'mysoulmate/original-ambient-audio',
      profileRevision: 'a'.repeat(64),
      qaApproved: true,
    })).not.toThrow();
  });

  it('rejects an incomplete or invalid source digest envelope', async () => {
    const value = await fixture();
    await fs.writeFile(value.digestsPath, JSON.stringify({
      sourceDigests: { ...sourceDigests, productionLedgerSha256: 'invalid' },
    }));
    await expect(compileNativeFashionPlan(optionsFor(value), { probe: async () => passingProbe }))
      .rejects.toThrow('productionLedgerSha256');
  });

  it('requires explicit prior human QA approval', async () => {
    const value = await fixture();
    await expect(compileNativeFashionPlan(
      { ...optionsFor(value), qaApproved: false },
      { probe: async () => passingProbe },
    )).rejects.toThrow(/Human QA approval.*prerequisite/u);
  });

  it('refuses to overwrite unless force is explicit', async () => {
    const value = await fixture();
    const options = optionsFor(value);
    const first = await compileNativeFashionPlan(options, { probe: async () => passingProbe });
    expect(first.planSha256).toMatch(/^[a-f0-9]{64}$/u);
    await expect(compileNativeFashionPlan(options, { probe: async () => passingProbe }))
      .rejects.toThrow('--force');
    await expect(compileNativeFashionPlan(
      { ...options, force: true },
      { probe: async () => passingProbe },
    )).resolves.toMatchObject({ planSha256: first.planSha256 });
  });

  it('rejects a symlink clip before probing it', async () => {
    const value = await fixture();
    const linkPath = path.join(value.root, 'linked.mp4');
    await fs.symlink(value.clipPath, linkPath);
    await expect(compileNativeFashionPlan(
      { ...optionsFor(value), clipPath: linkPath },
      { probe: async () => passingProbe },
    )).rejects.toThrow('non-symlink');
  });
});
