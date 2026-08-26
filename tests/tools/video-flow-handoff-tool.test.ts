/**
 * video_flow_handoff adapter — ITool wiring over google-flow-handoff / plan-export / result-import.
 */
import { describe, expect, it } from 'vitest';

import { MULTIMODAL_TOOLS } from '../../src/codebuddy/tool-definitions/multimodal-tools.js';
import { TOOL_METADATA } from '../../src/tools/metadata.js';
import { createMultimodalTools } from '../../src/tools/registry/multimodal-tools.js';
import { VideoFlowHandoffTool } from '../../src/tools/video-flow-handoff-tool.js';
import { verifyGoogleFlowHandoffDigest } from '../../src/tools/video/google-flow-handoff.js';

const SOURCE_PLAN_SHA256 = 'f'.repeat(64);

const capacity = {
  darkstar: true,
  ministar: true,
  google_flow: true,
  remaining_flow_credits: 25_000,
  max_flow_credits_per_batch: 100,
};

const shots = [1, 2, 3].map((index) => ({
  id: `lisa-shot-${index}`,
  character_name: 'Lisa',
  declared_adult_age: 28,
  source_path: `/catalog/lisa-${index}.png`,
  source_sha256: String(index).repeat(64),
  motion_prompt: `distinct cinematic movement ${index}`,
  role: index === 1 ? 'hero' : index === 3 ? 'transition' : 'b-roll',
  consumer_short_ids: [`lisa-pilot-${index}`],
  consumers: [{ short_id: `lisa-pilot-${index}`, shot_index: index }],
}));

describe('video_flow_handoff — registration + schema', () => {
  it('is registered under its name with media metadata and no fleetSafe flag', () => {
    const tool = createMultimodalTools().find((entry) => entry.name === 'video_flow_handoff');
    expect(tool).toBeDefined();
    expect(tool!.getMetadata?.()?.category).toBe('media');
    expect(tool!.getMetadata?.()?.fleetSafe).toBeUndefined();
    expect(tool!.getSchema().parameters.required).toEqual(['operation']);
    expect(MULTIMODAL_TOOLS.some((entry) => entry.function.name === 'video_flow_handoff')).toBe(true);
    expect(TOOL_METADATA.find((entry) => entry.name === 'video_flow_handoff')?.fleetSafe).toBeUndefined();
  });

  it('rejects create without shots', () => {
    const tool = new VideoFlowHandoffTool();
    expect(tool.validate({ operation: 'create' }).valid).toBe(false);
    expect(tool.validate({ operation: 'create', shots, capacity }).valid).toBe(true);
  });
});

describe('video_flow_handoff — create + verify', () => {
  it('creates a bounded Ultra-credit Fast batch without API billing', async () => {
    const tool = new VideoFlowHandoffTool();
    const result = await tool.execute({
      operation: 'create',
      shots,
      source_plan_sha256: SOURCE_PLAN_SHA256,
      batch_id: 'lisa-pilot-en',
      model: 'fast',
      locale: 'en-US',
      duration_seconds: 8,
      aspect_ratio: '9:16',
      upscale_4k: false,
      capacity,
    });
    expect(result.success, result.error).toBe(true);
    const handoff = result.data as {
      apiBillingAllowed?: boolean;
      autoPublish?: boolean;
      estimatedCredits?: number;
      jobs?: unknown[];
    };
    expect(handoff.apiBillingAllowed).toBe(false);
    expect(handoff.autoPublish).toBe(false);
    expect(handoff.estimatedCredits).toBe(30);
    expect(handoff.jobs).toHaveLength(3);
    expect(verifyGoogleFlowHandoffDigest(handoff as Parameters<typeof verifyGoogleFlowHandoffDigest>[0])).toBe(true);

    const verified = await tool.execute({ operation: 'verify', handoff });
    expect(verified.success, verified.error).toBe(true);
    expect(verified.data).toEqual({ valid: true });
  });

  it('returns success:false when Quality is asked for a non-8s duration', async () => {
    const tool = new VideoFlowHandoffTool();
    const result = await tool.execute({
      operation: 'create',
      shots: [shots[0]],
      source_plan_sha256: SOURCE_PLAN_SHA256,
      batch_id: 'invalid-quality-duration',
      model: 'quality',
      locale: 'fr-FR',
      duration_seconds: 4,
      aspect_ratio: '9:16',
      upscale_4k: false,
      capacity,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/8-second|Quality/i);
  });

  it('returns success:false when export is given an unsafe plan', async () => {
    const tool = new VideoFlowHandoffTool();
    const result = await tool.execute({
      operation: 'export',
      plan: { schemaVersion: 1 },
      approved_asset_root: '/approved',
      batch_id: 'pilot',
      include_all_shorts: true,
      model: 'fast',
      duration_seconds: 4,
      aspect_ratio: '9:16',
      upscale_4k: false,
      remaining_flow_credits: 25_000,
      max_flow_credits_per_batch: 100,
      darkstar_available: true,
      ministar_available: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not safe|QA-approved|object/i);
  });
});
