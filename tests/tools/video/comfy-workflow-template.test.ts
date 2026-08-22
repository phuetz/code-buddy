import { describe, expect, it } from 'vitest';

import {
  assertAllSeedsPinned,
  I2V_WAN_LIGHTX2V_TEMPLATE_CONTRACT,
  loadWorkflowTemplate,
  patchWorkflow,
  type ComfyWorkflowGraph,
  type TemplateContract,
} from '../../../src/tools/video/comfy-workflow-template.js';

function i2vGraph(): ComfyWorkflowGraph {
  return {
    '1': { class_type: 'WanVideoModelLoader', inputs: { model: 'high.safetensors' }, _meta: { title: 'High Noise' } },
    '2': { class_type: 'WanVideoModelLoader', inputs: { model: 'low.safetensors' }, _meta: { title: 'Low Noise' } },
    '3': { class_type: 'WanVideoSampler', inputs: { seed: -1, steps: 4, cfg: 1 }, _meta: { title: 'High Sampler' } },
    '4': { class_type: 'WanVideoSampler', inputs: { seed: -1, steps: 4, cfg: 1 }, _meta: { title: 'Low Sampler' } },
    '5': { class_type: 'WanVideoImageToVideoEncode', inputs: { width: 832, height: 480, num_frames: 81 } },
    '6': { class_type: 'WanVideoTextEncode', inputs: { positive_prompt: '', negative_prompt: '' } },
    '7': { class_type: 'LoadImage', inputs: { image: 'input.png' } },
    '8': { class_type: 'VHS_VideoCombine', inputs: { filename_prefix: 'video' } },
  };
}

describe('ComfyUI workflow template contracts', () => {
  it('accepts the exact required node multiplicities and rejects a missing class', () => {
    expect(() => loadWorkflowTemplate(i2vGraph(), I2V_WAN_LIGHTX2V_TEMPLATE_CONTRACT)).not.toThrow();
    const missing = i2vGraph();
    delete missing['5'];
    expect(() => loadWorkflowTemplate(missing, I2V_WAN_LIGHTX2V_TEMPLATE_CONTRACT))
      .toThrow(/requires exactly 1 WanVideoImageToVideoEncode.*found 0/u);
  });

  it('patches every typed role and leaves the source template unchanged', () => {
    const original = i2vGraph();
    const snapshot = structuredClone(original);
    const loaded = loadWorkflowTemplate(original, I2V_WAN_LIGHTX2V_TEMPLATE_CONTRACT);
    const patched = patchWorkflow(loaded, [
      { role: 'seed', value: 4201 },
      { role: 'prompt', value: 'stable fashion motion' },
      { role: 'negative', value: 'flicker' },
      { role: 'inputImage', value: 'approved.png' },
      { role: 'frames', value: 81 },
      { role: 'resolution', value: { width: 720, height: 1280 } },
      { role: 'outputPrefix', value: 'batch/segment-1' },
    ]);

    expect(patched['3']?.inputs.seed).toBe(4201);
    expect(patched['4']?.inputs.seed).toBe(4201);
    expect(patched['5']?.inputs).toMatchObject({ width: 720, height: 1280, num_frames: 81 });
    expect(patched['6']?.inputs).toMatchObject({ positive_prompt: 'stable fashion motion', negative_prompt: 'flicker' });
    expect(patched['7']?.inputs.image).toBe('approved.png');
    expect(patched['8']?.inputs.filename_prefix).toBe('batch/segment-1');
    expect(original).toEqual(snapshot);
  });

  it('fails explicitly on an ambiguous role without _meta.title disambiguation', () => {
    const contract: TemplateContract = {
      id: 'keyframe-flux',
      required: [{ classType: 'CLIPTextEncode', count: 2 }],
      roles: { prompt: [{ classType: 'CLIPTextEncode', input: 'text' }] },
    };
    const graph: ComfyWorkflowGraph = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    };
    expect(() => loadWorkflowTemplate(graph, contract)).toThrow(/ambiguous.*_meta\.title/u);
  });

  it('rejects an unresolved patch role', () => {
    const loaded = loadWorkflowTemplate(i2vGraph(), I2V_WAN_LIGHTX2V_TEMPLATE_CONTRACT);
    expect(() => patchWorkflow(loaded, [{ role: 'inputVideo', value: 'clip.mp4' }]))
      .toThrow(/does not resolve patch role inputVideo/u);
  });

  it('rejects unpinned seeds and accepts all explicitly pinned seed inputs', () => {
    expect(() => assertAllSeedsPinned(i2vGraph())).toThrow(/3\.seed/u);
    const loaded = loadWorkflowTemplate(i2vGraph(), I2V_WAN_LIGHTX2V_TEMPLATE_CONTRACT);
    const pinned = patchWorkflow(loaded, [{ role: 'seed', value: 7 }]);
    expect(() => assertAllSeedsPinned(pinned)).not.toThrow();
  });
});
