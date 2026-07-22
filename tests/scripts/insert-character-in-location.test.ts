import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  insertCharacterInLocation,
  preflightCharacterInsertion,
  resolveInsertionPlate,
  type CharacterInsertionClient,
  type InsertCharacterOptions,
} from '../../scripts/darkstar/insert-character-in-location.js';
import type { ComfyWorkflowGraph } from '../../src/tools/video/comfy-workflow-template.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function insertionGraph(): ComfyWorkflowGraph {
  return {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'Qwen-Image-Edit-2509-Q4_K_M.gguf' } },
    '2': { class_type: 'LoadImage', inputs: { image: '' }, _meta: { title: 'Character' } },
    '3': { class_type: 'LoadImage', inputs: { image: '' }, _meta: { title: 'Location' } },
    '4': { class_type: 'TextEncodeQwenImageEditPlus', inputs: { prompt: '' } },
    '5': { class_type: 'KSampler', inputs: { seed: -1 } },
    '6': { class_type: 'SaveImage', inputs: { filename_prefix: '' } },
  };
}

async function fixture(): Promise<{ root: string; options: InsertCharacterOptions }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'insert-character-location-'));
  roots.push(root);
  const locationsRoot = path.join(root, 'locations');
  const workflowsDir = path.join(root, 'workflows');
  const characterPath = path.join(root, 'character.png');
  const platePath = path.join(locationsRoot, 'cozy-loft-interior', 'medium-frontal-1.png');
  await fs.mkdir(path.dirname(platePath), { recursive: true });
  await fs.mkdir(workflowsDir);
  await Promise.all([
    fs.writeFile(characterPath, PNG),
    fs.writeFile(platePath, PNG),
    fs.writeFile(path.join(workflowsDir, 'insert-qwen-edit.json'), JSON.stringify(insertionGraph())),
  ]);
  return {
    root,
    options: {
      characterPath,
      locationId: 'cozy-loft-interior',
      comfyUrl: 'http://comfy.test',
      outputDir: path.join(root, 'output'),
      seed: 61_000,
      relight: false,
      gate: false,
      force: false,
      locationsRoot,
      workflowsDir,
    },
  };
}

function fakeClient(overrides: Partial<CharacterInsertionClient> = {}): CharacterInsertionClient {
  return {
    probe: vi.fn(async () => ({ ok: true, devices: [] })),
    uploadImage: vi.fn(async (input) => `uploaded/${input.role}.png`),
    submit: vi.fn(async () => PNG),
    ...overrides,
  };
}

describe('character-in-location CLI orchestration', () => {
  it('resolves the canonical medium frontal plate from a location id', async () => {
    const value = await fixture();
    expect(resolveInsertionPlate(value.options)).toEqual({
      platePath: path.join(value.options.locationsRoot, 'cozy-loft-interior', 'medium-frontal-1.png'),
      location: 'cozy-loft-interior',
      outputSlug: 'cozy-loft-interior',
    });
  });

  it('fails closed on an unreadable image before probing or uploading', async () => {
    const value = await fixture();
    await fs.rm(value.options.characterPath);
    const client = fakeClient();
    await expect(preflightCharacterInsertion(value.options, client)).rejects.toThrow(/Character image/u);
    expect(client.probe).not.toHaveBeenCalled();
    expect(client.uploadImage).not.toHaveBeenCalled();
  });

  it('rejects a symlinked input image before probing or uploading', async () => {
    const value = await fixture();
    const realCharacter = path.join(value.root, 'real-character.png');
    await fs.rename(value.options.characterPath, realCharacter);
    await fs.symlink(realCharacter, value.options.characterPath);
    const client = fakeClient();
    await expect(preflightCharacterInsertion(value.options, client)).rejects.toThrow(/non-symlink/u);
    expect(client.probe).not.toHaveBeenCalled();
    expect(client.uploadImage).not.toHaveBeenCalled();
  });

  it('fails closed when ComfyUI cannot be probed and performs no upload', async () => {
    const value = await fixture();
    const client = fakeClient({ probe: vi.fn(async () => ({ ok: false, devices: [] })) });
    await expect(preflightCharacterInsertion(value.options, client)).rejects.toThrow(/ComfyUI preflight failed/u);
    expect(client.uploadImage).not.toHaveBeenCalled();
  });

  it('uploads both images, patches their roles, submits, and downloads the composite', async () => {
    const value = await fixture();
    const submitted: ComfyWorkflowGraph[] = [];
    const client = fakeClient({
      submit: vi.fn(async (input) => {
        submitted.push(input.workflow);
        return PNG;
      }),
    });
    const result = await insertCharacterInLocation(value.options, { client });

    expect(client.uploadImage).toHaveBeenCalledTimes(2);
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.['2']?.inputs.image).toBe('uploaded/character.png');
    expect(submitted[0]?.['3']?.inputs.image).toBe('uploaded/location.png');
    expect(submitted[0]?.['5']?.inputs.seed).toBe(61_000);
    expect(await fs.readFile(result.outputPath)).toEqual(Buffer.from(PNG));
  });
});
