import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertOriginalReferenceOnly,
  buildIdentityDatasetV3Workflow,
  candidateSeed,
  generateIdentityDatasetV3,
  parseIdentityDatasetV3Args,
  type GenerateCandidateInput,
  type IdentityDatasetV3ComfyClient,
  type IdentityDatasetV3Options,
  type UploadOriginalReferenceInput,
} from '../../scripts/darkstar/generate-identity-dataset-v3.js';
import { createDatasetV3Plan } from '../../src/lora/dataset-v3-plan.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(slotCount = 1): Promise<{ root: string; options: IdentityDatasetV3Options }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'identity-v3-test-'));
  temporaryRoots.push(root);
  const referencePath = path.join(root, 'original.png');
  await fs.writeFile(referencePath, PNG);
  return {
    root,
    options: {
      referencePath,
      comfyUrl: 'http://127.0.0.1:8189',
      outputRoot: path.join(root, 'out'),
      width: 1024,
      height: 1536,
      slots: createDatasetV3Plan().slice(0, slotCount),
      baseSeed: 12_000,
      force: false,
    },
  };
}

function fakeClient(generated: GenerateCandidateInput[], failOnCandidate?: string): IdentityDatasetV3ComfyClient {
  return {
    probe: vi.fn(async () => ({ ok: true, devices: [{ name: 'fake' }] })),
    uploadOriginalReference: vi.fn(async (_input: UploadOriginalReferenceInput) => 'original-lock/reference.png'),
    generateCandidate: vi.fn(async (input) => {
      generated.push(input);
      if (input.candidateId === failOnCandidate) throw new Error('synthetic interruption');
      return Buffer.concat([PNG, Buffer.from(input.candidateId)]);
    }),
  };
}

describe('identity dataset v3 CLI', () => {
  it('parses the documented defaults and selected slots', () => {
    const parsed = parseIdentityDatasetV3Args([
      '--reference', './original.png',
      '--comfy=http://127.0.0.1:8189',
      '--out', './candidates',
      '--slots', 'face-front-neutral,face-profile-right-neutral',
      '--seed', '9000',
    ]);
    expect(parsed).toMatchObject({ width: 1024, height: 1536, baseSeed: 9000, force: false });
    expect(parsed.slots.map((slot) => slot.slotId)).toEqual([
      'face-front-neutral', 'face-profile-right-neutral',
    ]);
    expect(() => parseIdentityDatasetV3Args(['--slots', 'all'])).toThrow(/--reference is required/u);
    expect(() => parseIdentityDatasetV3Args([
      '--reference', './original.png', '--resolution', '768x1024',
    ])).toThrow(/at least 1024x1536/u);
  });
});

describe('identity dataset v3 generator', () => {
  it('fails closed during preflight without uploading or generating', async () => {
    const value = await fixture();
    const upload = vi.fn(async () => 'should-not-upload.png');
    const generate = vi.fn(async () => PNG);
    const client: IdentityDatasetV3ComfyClient = {
      probe: vi.fn(async () => ({ ok: false, devices: [] })),
      uploadOriginalReference: upload,
      generateCandidate: generate,
    };
    await expect(generateIdentityDatasetV3(value.options, { client })).rejects.toThrow(/preflight failed/u);
    expect(upload).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    await expect(fs.access(value.options.outputRoot)).rejects.toThrow();

    const symlinkPath = path.join(value.root, 'linked.png');
    await fs.symlink(value.options.referencePath, symlinkPath);
    await expect(generateIdentityDatasetV3({ ...value.options, referencePath: symlinkPath }, { client }))
      .rejects.toThrow(/non-symlink/u);
  });

  it('locks every workflow to the one uploaded original and pins resolution and seeds', async () => {
    const value = await fixture();
    const generated: GenerateCandidateInput[] = [];
    const client = fakeClient(generated);
    await generateIdentityDatasetV3(value.options, { client, now: () => new Date('2026-07-20T12:00:00Z') });

    const slot = value.options.slots[0]!;
    expect(client.uploadOriginalReference).toHaveBeenCalledTimes(1);
    expect(generated).toHaveLength(slot.overgenCount);
    generated.forEach((input, index) => {
      expect(input.workflow['5']).toMatchObject({
        class_type: 'LoadImage', inputs: { image: 'original-lock/reference.png' },
      });
      expect(input.workflow['10']).toMatchObject({
        class_type: 'EmptySD3LatentImage', inputs: { width: 1024, height: 1536, batch_size: 1 },
      });
      expect(input.workflow['11']?.inputs.seed).toBe(candidateSeed(value.options.baseSeed, slot.slotId, index));
      expect(() => assertOriginalReferenceOnly(input.workflow, 'original-lock/reference.png')).not.toThrow();
    });

    const unsafe = buildIdentityDatasetV3Workflow({
      reference: {
        workflowPath: 'original-lock/reference.png',
        sourcePath: value.options.referencePath,
        sha256: 'a'.repeat(64),
      },
      slot,
      seed: 1,
      width: 1024,
      height: 1536,
      prefix: 'candidate',
    });
    unsafe['14'] = { class_type: 'LoadImage', inputs: { image: 'generated-candidate.png' } };
    expect(() => assertOriginalReferenceOnly(unsafe, 'original-lock/reference.png')).toThrow(/Anti-chaining/u);
  });

  it('writes complete sidecars and a resumable state for each slot', async () => {
    const value = await fixture(2);
    const firstSlot = value.options.slots[0]!;
    const secondSlot = value.options.slots[1]!;
    const generatedBeforeFailure: GenerateCandidateInput[] = [];
    const interruptedClient = fakeClient(generatedBeforeFailure, `${secondSlot.slotId}-01`);
    await expect(generateIdentityDatasetV3(value.options, {
      client: interruptedClient,
      now: () => new Date('2026-07-20T12:00:00Z'),
    })).rejects.toThrow(/synthetic interruption/u);
    expect(generatedBeforeFailure.filter((entry) => entry.candidateId.startsWith(firstSlot.slotId)))
      .toHaveLength(firstSlot.overgenCount);

    const resumed: GenerateCandidateInput[] = [];
    await generateIdentityDatasetV3(value.options, {
      client: fakeClient(resumed),
      now: () => new Date('2026-07-20T12:05:00Z'),
    });
    expect(resumed.every((entry) => entry.candidateId.startsWith(secondSlot.slotId))).toBe(true);
    expect(resumed).toHaveLength(secondSlot.overgenCount);

    for (const slot of value.options.slots) {
      const slotDirectory = path.join(value.options.outputRoot, slot.slotId);
      const state = JSON.parse(await fs.readFile(path.join(slotDirectory, 'state.json'), 'utf8')) as {
        referenceSha256: string;
        completedCandidateIds: string[];
      };
      expect(state.referenceSha256).toBe(createHash('sha256').update(PNG).digest('hex'));
      expect(state.completedCandidateIds).toHaveLength(slot.overgenCount);
      for (let index = 0; index < slot.overgenCount; index += 1) {
        const id = `${slot.slotId}-${String(index + 1).padStart(2, '0')}`;
        const image = await fs.readFile(path.join(slotDirectory, `${id}.png`));
        const caption = await fs.readFile(path.join(slotDirectory, `${id}.txt`), 'utf8');
        const sidecar = JSON.parse(await fs.readFile(path.join(slotDirectory, `${id}.json`), 'utf8')) as {
          candidateId: string;
          slot: { slotId: string; prompt: string };
          seed: number;
          sha256: string;
          provenance: { generator: string; referenceKind: string; referenceSha256: string };
        };
        expect(sidecar).toMatchObject({
          candidateId: id,
          slot: { slotId: slot.slotId, prompt: slot.prompt },
          seed: candidateSeed(value.options.baseSeed, slot.slotId, index),
          sha256: createHash('sha256').update(image).digest('hex'),
          provenance: {
            generator: 'krea2-identity-edit-v3',
            referenceKind: 'original',
            referenceSha256: state.referenceSha256,
          },
        });
        expect(caption).toBe(`${slot.prompt}\n`);
      }
    }

    const noRegeneration: GenerateCandidateInput[] = [];
    await generateIdentityDatasetV3(value.options, { client: fakeClient(noRegeneration) });
    expect(noRegeneration).toEqual([]);
  });
});
