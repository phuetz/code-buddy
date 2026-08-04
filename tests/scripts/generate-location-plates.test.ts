import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertNoLoraNodes,
  buildLocationPlateWorkflow,
  generateLocationPlates,
  locationAngleSeedHash,
  parseLocationPlateArgs,
  plateSeed,
  type GenerateLocationPlateInput,
  type LocationPlateComfyClient,
  type LocationPlateOptions,
} from '../../scripts/darkstar/generate-location-plates.js';
import { buildPlatePrompt, SIGNATURE_LOCATIONS } from '../../src/companion/signature-locations.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const LOCATION_ID = 'stone-staircase' as const;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(variants = 2): Promise<{ root: string; options: LocationPlateOptions }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'location-plates-test-'));
  temporaryRoots.push(root);
  return {
    root,
    options: {
      comfyUrl: 'http://127.0.0.1:8189',
      outputRoot: path.join(root, 'out'),
      locations: [LOCATION_ID],
      baseSeed: 15_000,
      variants,
      force: false,
    },
  };
}

function fakeClient(generated: GenerateLocationPlateInput[], failOnPlate?: string): LocationPlateComfyClient {
  return {
    probe: vi.fn(async () => ({ ok: true, devices: [{ name: 'fake' }] })),
    generatePlate: vi.fn(async (input) => {
      generated.push(input);
      if (input.plateId === failOnPlate) throw new Error('synthetic interruption');
      return Buffer.concat([PNG, Buffer.from(input.plateId)]);
    }),
  };
}

describe('location plate CLI', () => {
  it('parses documented options and stable catalog-order selections', () => {
    const parsed = parseLocationPlateArgs([
      '--comfy=http://127.0.0.1:8189',
      '--out', './plates',
      '--locations', 'rooftop-dusk,stone-staircase',
      '--seed', '9000',
      '--variants', '3',
      '--force',
    ]);
    expect(parsed).toMatchObject({ baseSeed: 9000, variants: 3, force: true });
    expect(parsed.locations).toEqual(['stone-staircase', 'rooftop-dusk']);
    expect(() => parseLocationPlateArgs(['--locations', 'unknown-place'])).toThrow(/Unknown signature location/u);
    expect(() => parseLocationPlateArgs(['--variants', '0'])).toThrow(/--variants/u);
  });
});

describe('location plate generator', () => {
  it('fails closed on probe failure, symlink output, and unmanaged overwrite', async () => {
    const value = await fixture();
    const generate = vi.fn(async () => PNG);
    const unavailable: LocationPlateComfyClient = {
      probe: vi.fn(async () => ({ ok: false, devices: [] })),
      generatePlate: generate,
    };
    await expect(generateLocationPlates(value.options, { client: unavailable })).rejects.toThrow(/preflight failed/u);
    expect(generate).not.toHaveBeenCalled();
    await expect(fs.access(value.options.outputRoot)).rejects.toThrow();

    const realOutput = path.join(value.root, 'real-output');
    await fs.mkdir(realOutput);
    await fs.symlink(realOutput, value.options.outputRoot);
    await expect(generateLocationPlates(value.options, { client: fakeClient([]) }))
      .rejects.toThrow(/non-symlink/u);
    await fs.unlink(value.options.outputRoot);

    const locationDirectory = path.join(value.options.outputRoot, LOCATION_ID);
    await fs.mkdir(locationDirectory, { recursive: true });
    await fs.writeFile(path.join(locationDirectory, 'wide-establishing-1.png'), PNG);
    await expect(generateLocationPlates(value.options, { client: fakeClient([]) }))
      .rejects.toThrow(/without --force/u);
  });

  it('derives stable seeds from the base, location-angle hash, and zero-based variant', () => {
    const expectedHash = createHash('sha256')
      .update(`${LOCATION_ID}wide-establishing`)
      .digest()
      .readUInt32BE(0);
    expect(locationAngleSeedHash(LOCATION_ID, 'wide-establishing')).toBe(expectedHash);
    expect(plateSeed(8000, LOCATION_ID, 'wide-establishing', 0)).toBe(8000 + expectedHash);
    expect(plateSeed(8000, LOCATION_ID, 'wide-establishing', 2)).toBe(8000 + expectedHash + 2);
  });

  it('builds the exact vertical Krea2 graph without a LoRA node', () => {
    const graph = buildLocationPlateWorkflow({ prompt: 'empty scene, no people', seed: 123, prefix: 'plate' });
    expect(graph['4']).toMatchObject({
      class_type: 'UNETLoader',
      inputs: { unet_name: 'krea2_turbo_fp8_scaled.safetensors' },
    });
    expect(graph['5']).toMatchObject({
      class_type: 'EmptyLatentImage',
      inputs: { width: 1080, height: 1920, batch_size: 1 },
    });
    expect(graph['6']).toMatchObject({ class_type: 'CLIPLoader', inputs: { type: 'krea2' } });
    expect(graph['7']).toMatchObject({
      class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' },
    });
    expect(graph['3']).toMatchObject({
      class_type: 'KSampler',
      inputs: { seed: 123, steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', model: ['4', 0] },
    });
    expect(Object.values(graph).some((node) => /lora/iu.test(node.class_type))).toBe(false);
    graph['12'] = { class_type: 'LoraLoaderModelOnly', inputs: {} };
    expect(() => assertNoLoraNodes(graph)).toThrow(/must not contain LoRA/u);
  });

  it('writes complete sidecars and resumes from per-location state', async () => {
    const value = await fixture();
    const generatedBeforeFailure: GenerateLocationPlateInput[] = [];
    await expect(generateLocationPlates(value.options, {
      client: fakeClient(generatedBeforeFailure, `${LOCATION_ID}/medium-frontal-1`),
      now: () => new Date('2026-07-20T12:00:00Z'),
    })).rejects.toThrow(/synthetic interruption/u);
    expect(generatedBeforeFailure).toHaveLength(value.options.variants + 1);

    const resumed: GenerateLocationPlateInput[] = [];
    await generateLocationPlates(value.options, {
      client: fakeClient(resumed),
      now: () => new Date('2026-07-20T12:05:00Z'),
    });
    const total = SIGNATURE_LOCATIONS[LOCATION_ID].angles.length * value.options.variants;
    expect(resumed).toHaveLength(total - value.options.variants);
    expect(resumed.every((entry) => !entry.plateId.includes('wide-establishing'))).toBe(true);

    const directory = path.join(value.options.outputRoot, LOCATION_ID);
    const state = JSON.parse(await fs.readFile(path.join(directory, 'state.json'), 'utf8')) as {
      generator: string;
      completedPlateIds: string[];
    };
    expect(state.generator).toBe('krea2-location-plates-v1');
    expect(state.completedPlateIds).toHaveLength(total);
    for (const angle of SIGNATURE_LOCATIONS[LOCATION_ID].angles) {
      for (let variantIndex = 0; variantIndex < value.options.variants; variantIndex += 1) {
        const plateId = `${angle}-${variantIndex + 1}`;
        const image = await fs.readFile(path.join(directory, `${plateId}.png`));
        const sidecar = JSON.parse(await fs.readFile(path.join(directory, `${plateId}.json`), 'utf8')) as {
          locationId: string;
          angle: string;
          prompt: string;
          seed: number;
          sha256: string;
          lightingSpec: string;
          focal: string;
        };
        expect(sidecar).toEqual(expect.objectContaining({
          locationId: LOCATION_ID,
          angle,
          prompt: buildPlatePrompt(LOCATION_ID, angle),
          seed: plateSeed(value.options.baseSeed, LOCATION_ID, angle, variantIndex),
          sha256: createHash('sha256').update(image).digest('hex'),
          lightingSpec: SIGNATURE_LOCATIONS[LOCATION_ID].lightingSpec,
          focal: SIGNATURE_LOCATIONS[LOCATION_ID].focal[angle],
        }));
      }
    }

    const noRegeneration: GenerateLocationPlateInput[] = [];
    await generateLocationPlates(value.options, { client: fakeClient(noRegeneration) });
    expect(noRegeneration).toEqual([]);
  });

  it('replaces selected location output only when force is explicit', async () => {
    const value = await fixture(1);
    const directory = path.join(value.options.outputRoot, LOCATION_ID);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'wide-establishing-1.png'), Buffer.from('old'));
    const generated: GenerateLocationPlateInput[] = [];
    await generateLocationPlates({ ...value.options, force: true }, { client: fakeClient(generated) });
    expect(generated).toHaveLength(SIGNATURE_LOCATIONS[LOCATION_ID].angles.length);
    expect(await fs.readFile(path.join(directory, 'wide-establishing-1.png'))).not.toEqual(Buffer.from('old'));
  });
});
