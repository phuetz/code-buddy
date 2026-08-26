/**
 * video_long_form_plan adapter — ITool wiring over long-form-plan + compileLongFormRenderPacket.
 */
import { describe, expect, it } from 'vitest';

import { MULTIMODAL_TOOLS } from '../../src/codebuddy/tool-definitions/multimodal-tools.js';
import { TOOL_METADATA } from '../../src/tools/metadata.js';
import { createMultimodalTools } from '../../src/tools/registry/multimodal-tools.js';
import { VideoLongFormPlanTool } from '../../src/tools/video-long-form-plan-tool.js';
import type { LongFormEpisodePlan } from '../../src/tools/video/long-form-plan.js';

function readyPlan(): LongFormEpisodePlan {
  const words = Array.from({ length: 26 }, (_, index) => `word${index}`).join(' ');
  return {
    schemaVersion: 1,
    episodeId: 'why-humans-keep-imperfect-photos',
    locale: 'en-US',
    title: 'Why we keep imperfect photos',
    description: 'An original chaptered story about memory and imperfect images.',
    chapters: Array.from({ length: 5 }, (_, chapterIndex) => ({
      id: `chapter-${chapterIndex + 1}`,
      title: `Chapter ${chapterIndex + 1}`,
      scenes: Array.from({ length: 5 }, (_, sceneIndex) => ({
        id: `chapter-${chapterIndex + 1}-scene-${sceneIndex + 1}`,
        durationSeconds: 20,
        narration: `${words} chapter ${chapterIndex} scene ${sceneIndex}`,
        visualPrompt: `unique cinematic setting ${chapterIndex}-${sceneIndex}, distinct action and composition`,
      })),
    })),
    publication: {
      visibility: 'private',
      autoPublish: false,
      madeForKids: false,
      containsSyntheticMedia: true,
      humanReviewRequired: true,
    },
  };
}

describe('video_long_form_plan — registration + schema', () => {
  it('is registered under its name with media metadata and no fleetSafe flag', () => {
    const tool = createMultimodalTools().find((entry) => entry.name === 'video_long_form_plan');
    expect(tool).toBeDefined();
    expect(tool!.getMetadata?.()?.category).toBe('media');
    expect(tool!.getMetadata?.()?.fleetSafe).toBeUndefined();
    expect(tool!.getSchema().parameters.required).toEqual(['operation', 'plan']);
    expect(MULTIMODAL_TOOLS.some((entry) => entry.function.name === 'video_long_form_plan')).toBe(true);
    expect(TOOL_METADATA.find((entry) => entry.name === 'video_long_form_plan')?.fleetSafe).toBeUndefined();
  });

  it('rejects missing operation or plan', () => {
    const tool = new VideoLongFormPlanTool();
    expect(tool.validate({}).valid).toBe(false);
    expect(tool.validate({ operation: 'assess' }).valid).toBe(false);
    expect(tool.validate({ operation: 'assess', plan: readyPlan() }).valid).toBe(true);
  });
});

describe('video_long_form_plan — assess + compile', () => {
  it('assesses a ready eight-minute chaptered episode', async () => {
    const tool = new VideoLongFormPlanTool();
    const result = await tool.execute({ operation: 'assess', plan: readyPlan() });
    expect(result.success, result.error).toBe(true);
    expect(result.data).toMatchObject({
      ready: true,
      durationSeconds: 500,
      midRollEligible: true,
      failures: [],
    });
  });

  it('compiles a render packet for a production-ready plan', async () => {
    const tool = new VideoLongFormPlanTool();
    const result = await tool.execute({ operation: 'compile', plan: readyPlan() });
    expect(result.success, result.error).toBe(true);
    const data = result.data as { packet?: { publication?: { autoPublish?: boolean }; scenes?: unknown[] } };
    expect(data.packet?.publication?.autoPublish).toBe(false);
    expect(data.packet?.scenes?.length).toBe(25);
  });

  it('returns success:false when compile is given an incomplete plan', async () => {
    const tool = new VideoLongFormPlanTool();
    const plan = readyPlan();
    plan.chapters = plan.chapters.slice(0, 1);
    const result = await tool.execute({ operation: 'compile', plan });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not production-ready/i);
  });
});
