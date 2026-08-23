/**
 * video_route adapter — ITool wiring over routeHybridVideo / routeHybridVideoBatch.
 */
import { describe, expect, it } from 'vitest';

import { MULTIMODAL_TOOLS } from '../../src/codebuddy/tool-definitions/multimodal-tools.js';
import { TOOL_METADATA } from '../../src/tools/metadata.js';
import { createMultimodalTools } from '../../src/tools/registry/multimodal-tools.js';
import { VideoRouteTool } from '../../src/tools/video-route-tool.js';

const capacity = {
  darkstar: true,
  ministar: true,
  google_flow: true,
  remaining_flow_credits: 25_000,
  max_flow_credits_per_batch: 500,
};

describe('video_route — registration + schema', () => {
  it('is registered under its name with media metadata and no fleetSafe flag', () => {
    const tool = createMultimodalTools().find((entry) => entry.name === 'video_route');
    expect(tool).toBeDefined();
    expect(tool!.getMetadata?.()?.category).toBe('media');
    expect(tool!.getMetadata?.()?.keywords).toEqual(expect.arrayContaining(['router', 'flow']));
    expect(tool!.getMetadata?.()?.fleetSafe).toBeUndefined();
    expect(tool!.getSchema().parameters.required).toEqual(['capacity']);
    expect(tool!.getSchema().parameters.additionalProperties).toBe(false);

    const def = MULTIMODAL_TOOLS.find((entry) => entry.function.name === 'video_route');
    expect(def).toBeDefined();
    expect(def!.function.parameters.required).toEqual(['capacity']);
    expect(def!.function.parameters.additionalProperties).toBe(false);

    const meta = TOOL_METADATA.find((entry) => entry.name === 'video_route');
    expect(meta).toMatchObject({ category: 'media', priority: 8 });
    expect(meta?.fleetSafe).toBeUndefined();
  });

  it('rejects input that is not a single request or a non-empty batch', () => {
    const tool = new VideoRouteTool();
    expect(tool.validate({}).valid).toBe(false);
    expect(tool.validate({ capacity, request: { id: 'a' }, requests: [] }).valid).toBe(false);
    expect(tool.validate({ capacity, requests: [] }).valid).toBe(false);
    expect(tool.validate({
      capacity,
      request: {
        id: 'opening-hero',
        use_case: 'hero-shot',
        content_tier: 'safe',
        quantity: 1,
        requires_lip_sync: false,
        premium: true,
      },
    }).valid).toBe(true);
  });
});

describe('video_route — routing', () => {
  it('routes a premium safe hero shot to Veo Quality', async () => {
    const tool = new VideoRouteTool();
    const result = await tool.execute({
      capacity,
      request: {
        id: 'opening-hero',
        use_case: 'hero-shot',
        content_tier: 'safe',
        quantity: 2,
        requires_lip_sync: false,
        premium: true,
      },
    });
    expect(result.success, result.error).toBe(true);
    expect(result.data).toMatchObject({
      requestId: 'opening-hero',
      primary: 'google-flow-veo31-quality',
      estimatedFlowCredits: 200,
      executionMode: 'browser-assisted',
    });
  });

  it('returns success:false when the request id is empty', async () => {
    const tool = new VideoRouteTool();
    const result = await tool.execute({
      capacity,
      request: {
        id: '  ',
        use_case: 'hero-shot',
        content_tier: 'safe',
        quantity: 1,
        requires_lip_sync: false,
        premium: false,
      },
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/id/i);
  });
});
