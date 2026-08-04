import { describe, expect, it } from 'vitest';

import { SIGNATURE_LOCATIONS } from '../../../src/companion/signature-locations.js';
import {
  buildCharacterInLocationWorkflow,
  buildFaceProtectedCharacterInLocationWorkflow,
  buildInsertionPrompt,
  INSERT_QWEN_TEMPLATE_CONTRACT,
} from '../../../src/tools/video/character-in-location.js';
import {
  assertAllSeedsPinned,
  loadWorkflowTemplate,
  type ComfyWorkflowGraph,
} from '../../../src/tools/video/comfy-workflow-template.js';

function insertionGraph(): ComfyWorkflowGraph {
  return {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'Qwen-Image-Edit-2509-Q4_K_M.gguf' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
    '4': { class_type: 'LoadImage', inputs: { image: 'character-old.png' }, _meta: { title: 'Character' } },
    '5': { class_type: 'LoadImage', inputs: { image: 'location-old.png' }, _meta: { title: 'Location' } },
    '6': { class_type: 'TextEncodeQwenImageEditPlus', inputs: { prompt: '', image1: ['4', 0], image2: ['5', 0] } },
    '7': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0] } },
    '8': { class_type: 'KSampler', inputs: { seed: -1, model: ['7', 0] } },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    '10': { class_type: 'SaveImage', inputs: { filename_prefix: '', images: ['9', 0] } },
    '11': { class_type: 'VAEEncode', inputs: { pixels: ['5', 0] } },
  };
}

describe('Qwen character-in-location workflow', () => {
  it('accepts the exact contract and rejects a missing required class', () => {
    expect(() => loadWorkflowTemplate(insertionGraph(), INSERT_QWEN_TEMPLATE_CONTRACT)).not.toThrow();
    const invalid = insertionGraph();
    delete invalid['1'];
    expect(() => loadWorkflowTemplate(invalid, INSERT_QWEN_TEMPLATE_CONTRACT))
      .toThrow(/requires exactly 1 UnetLoaderGGUF.*found 0/u);
  });

  it('patches the two LoadImage roles by title and pins every seed', () => {
    const source = insertionGraph();
    const graph = buildCharacterInLocationWorkflow(source, {
      characterImage: 'uploads/lisa.png',
      locationImage: 'uploads/loft.png',
      location: 'cozy-loft-interior',
      seed: 61_084,
      outputPrefix: 'insertions/lisa-loft',
    });

    expect(graph['4']?.inputs.image).toBe('uploads/lisa.png');
    expect(graph['5']?.inputs.image).toBe('uploads/loft.png');
    expect(graph['6']?.inputs.prompt).toBe(buildInsertionPrompt('cozy-loft-interior'));
    expect(graph['8']?.inputs.seed).toBe(61_084);
    expect(graph['10']?.inputs.filename_prefix).toBe('insertions/lisa-loft');
    expect(source['4']?.inputs.image).toBe('character-old.png');
    expect(() => assertAllSeedsPinned(graph)).not.toThrow();
  });

  it('fails when Character and Location titles do not disambiguate the images', () => {
    const graph = insertionGraph();
    graph['5']!._meta = { title: 'Background' };
    expect(() => loadWorkflowTemplate(graph, INSERT_QWEN_TEMPLATE_CONTRACT))
      .toThrow(/locationImage.*titled "Location"/u);
  });

  it('builds a deterministic prompt without textual decor from the catalog', () => {
    const location = SIGNATURE_LOCATIONS['european-street-goldenhour'];
    const first = buildInsertionPrompt(location);
    const second = buildInsertionPrompt(location);
    expect(first).toBe(second);
    expect(first).toBe(
      'place the woman from image 1 into the scene from image 2, keep her identity/pose/scale, ' +
      'match the scene lighting and perspective, photorealistic',
    );
    expect(first).not.toContain(location.label);
    expect(first).not.toContain(location.description);
    expect(first).not.toContain(location.paletteTag);
    expect(first).not.toContain(location.lightingSpec);
  });

  it('can require a measurable frontal medium shot without changing the default prompt', () => {
    expect(buildInsertionPrompt('cozy-loft-interior', { frontalMedium: true }))
      .toContain('frontal medium shot looking directly at camera');
  });

  it('protects the canonical face in latent sampling and restores it after decode', () => {
    const source = insertionGraph();
    source['8']!.inputs.latent_image = ['11', 0];
    const graph = buildFaceProtectedCharacterInLocationWorkflow(source, {
      characterImage: 'uploads/ambre.png',
      locationImage: 'uploads/protected-base.png',
      editMaskImage: 'uploads/edit-mask.png',
      location: 'cozy-loft-interior',
      seed: 81_001,
      outputPrefix: 'insertions/ambre-protected',
    });
    const latentMask = Object.values(graph).find((node) => node.class_type === 'SetLatentNoiseMask');
    const composite = Object.values(graph).find((node) => node.class_type === 'ImageCompositeMasked');
    const finalMask = Object.values(graph).find((node) => node.class_type === 'GrowMask');
    expect(latentMask).toBeDefined();
    expect(finalMask?.inputs.expand).toBe(-16);
    expect(composite).toBeDefined();
    expect(graph['8']?.inputs.latent_image).toEqual(
      [Object.entries(graph).find(([, node]) => node === latentMask)?.[0], 0],
    );
    expect(graph['10']?.inputs.images).toEqual(
      [Object.entries(graph).find(([, node]) => node === composite)?.[0], 0],
    );
  });
});
