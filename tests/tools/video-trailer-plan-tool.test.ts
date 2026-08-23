/**
 * video_trailer_plan adapter — ITool wiring over cinematic-trailer-plan.
 */
import { describe, expect, it } from 'vitest';

import { MULTIMODAL_TOOLS } from '../../src/codebuddy/tool-definitions/multimodal-tools.js';
import { TOOL_METADATA } from '../../src/tools/metadata.js';
import { createMultimodalTools } from '../../src/tools/registry/multimodal-tools.js';
import { VideoTrailerPlanTool } from '../../src/tools/video-trailer-plan-tool.js';
import type { CinematicTrailerPlan, TrailerShot } from '../../src/tools/video/cinematic-trailer-plan.js';

const SHA = 'a'.repeat(64);

const capacity = {
  darkstar: true,
  ministar: true,
  google_flow: true,
  remaining_flow_credits: 25_000,
  max_flow_credits_per_batch: 5_000,
};

function shot(overrides: Partial<TrailerShot> & Pick<TrailerShot, 'id' | 'token' | 'durationSeconds'>): TrailerShot {
  const editorial = overrides.token === 'brand' || overrides.token === 'cta';
  return {
    information: 'a single clue appears',
    action: 'turns',
    cameraMove: 'slow push-in',
    characters: [],
    entryHandle: true,
    exitHandle: true,
    burnedInText: false,
    rejectionConditions: ['off-model face'],
    useCase: 'hero-shot',
    ...(editorial ? {} : { manuscriptSource: { file: 'ch01.md', locator: 'scene 3' } }),
    ...overrides,
  };
}

function validPlan(): CinematicTrailerPlan {
  return {
    schemaVersion: 1,
    status: 'APPROVED_FOR_PUBLICATION',
    contentTier: 'safe',
    book: {
      title: 'Les Oubliés',
      genre: 'thriller',
      stagingSentence: 'We move from silence to a scream, seen from the child, without revealing who survives.',
      spoilerLimit: 'no death is shown',
      commercialAction: 'read the book',
    },
    masterDurationSeconds: 72,
    characters: [
      {
        id: 'lisa',
        identityVersion: 'lisa-v3',
        reference: 'refs/lisa-approved.png',
        referenceSha256: SHA,
        castingApproved: true,
      },
    ],
    shots: [
      shot({ id: 's1', token: 'hook', durationSeconds: 6, characters: ['lisa'] }),
      shot({ id: 's2', token: 'world', durationSeconds: 10 }),
      shot({ id: 's3', token: 'protagonist', durationSeconds: 10, characters: ['lisa'] }),
      shot({ id: 's4', token: 'escalation', durationSeconds: 12, characters: ['lisa'] }),
      shot({ id: 's5', token: 'price', durationSeconds: 12 }),
      shot({ id: 's6', token: 'withheld', durationSeconds: 10 }),
      shot({ id: 's7', token: 'brand', durationSeconds: 8 }),
      shot({ id: 's8', token: 'cta', durationSeconds: 4 }),
    ],
    overlays: [{ timecodeSeconds: 68, text: 'Les Oubliés', source: 'editorial', safeZone: true }],
    sound: {
      layers: ['ambience', 'foley', 'motif', 'speech'],
      masters: ['music-approved.wav', 'sound-design-approved.wav'],
    },
    retention: {
      hookA: 'the empty crib',
      hookB: 'the scream over black',
      promise: 'a disappearance you cannot explain',
      proofWithinThreeSeconds: 'the crib is shown at 0-2s',
      deeperPayoff: 'the note found later',
      singleAbVariable: 'hook image',
    },
    cost: {
      displayedInUi: true,
      estimatedFlowCredits: 800,
      approvedCeilingFlowCredits: 5_000,
      approvedBy: 'patrice',
    },
    approvals: {
      narrativeReviewed: true,
      castingReviewed: true,
      costApproved: true,
      publicationApproved: true,
    },
    publication: {
      visibility: 'private',
      autoPublish: false,
      containsSyntheticMedia: true,
      humanReviewRequired: true,
    },
  };
}

describe('video_trailer_plan — registration + schema', () => {
  it('is registered under its name with media metadata and no fleetSafe flag', () => {
    const tool = createMultimodalTools().find((entry) => entry.name === 'video_trailer_plan');
    expect(tool).toBeDefined();
    expect(tool!.getMetadata?.()?.category).toBe('media');
    expect(tool!.getMetadata?.()?.fleetSafe).toBeUndefined();
    expect(tool!.getSchema().parameters.required).toEqual(['operation', 'plan']);
    expect(MULTIMODAL_TOOLS.some((entry) => entry.function.name === 'video_trailer_plan')).toBe(true);
    expect(TOOL_METADATA.find((entry) => entry.name === 'video_trailer_plan')?.fleetSafe).toBeUndefined();
  });

  it('rejects missing plan and preview without capacity', () => {
    const tool = new VideoTrailerPlanTool();
    expect(tool.validate({ operation: 'validate' }).valid).toBe(false);
    expect(tool.validate({ operation: 'preview', plan: validPlan() }).valid).toBe(false);
    expect(tool.validate({ operation: 'validate', plan: validPlan() }).valid).toBe(true);
  });
});

describe('video_trailer_plan — validate + preview', () => {
  it('validates a complete publication-ready plan', async () => {
    const tool = new VideoTrailerPlanTool();
    const result = await tool.execute({ operation: 'validate', plan: validPlan() });
    expect(result.success, result.error).toBe(true);
    expect(result.data).toMatchObject({
      status: 'APPROVED_FOR_PUBLICATION',
      qualifiedStatus: 'APPROVED_FOR_PUBLICATION',
      blockers: [],
    });
  });

  it('preview never authorizes execution or publication', async () => {
    const tool = new VideoTrailerPlanTool();
    const result = await tool.execute({ operation: 'preview', plan: validPlan(), capacity });
    expect(result.success, result.error).toBe(true);
    expect(result.data).toMatchObject({
      executionAuthorized: false,
      publicationAuthorized: false,
    });
  });

  it('returns success:false when preview is missing capacity', async () => {
    const tool = new VideoTrailerPlanTool();
    const result = await tool.execute({ operation: 'preview', plan: validPlan() });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/capacity/i);
  });
});
