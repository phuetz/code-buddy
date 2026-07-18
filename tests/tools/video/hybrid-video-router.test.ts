import { describe, expect, it } from 'vitest';

import {
  routeHybridVideo,
  routeHybridVideoBatch,
  type HybridVideoCapacity,
} from '../../../src/tools/video/hybrid-video-router.js';

const capacity: HybridVideoCapacity = {
  darkstar: true,
  ministar: true,
  googleFlow: true,
  remainingFlowCredits: 25_000,
  maxFlowCreditsPerBatch: 500,
};

describe('routeHybridVideo', () => {
  it('routes lip sync to LongCat and premium safe shots to Veo Quality', () => {
    expect(routeHybridVideo({
      id: 'lisa-en-dialogue',
      useCase: 'avatar-lipsync',
      contentTier: 'safe',
      quantity: 3,
      requiresLipSync: true,
      premium: false,
    }, capacity)).toMatchObject({
      primary: 'darkstar-longcat',
      estimatedFlowCredits: 0,
      executionMode: 'automatic-local',
    });
    expect(routeHybridVideo({
      id: 'opening-hero',
      useCase: 'hero-shot',
      contentTier: 'safe',
      quantity: 2,
      requiresLipSync: false,
      premium: true,
    }, capacity)).toMatchObject({
      primary: 'google-flow-veo31-quality',
      estimatedFlowCredits: 200,
      executionMode: 'browser-assisted',
    });
  });

  it('keeps adult content local and falls back when a Flow batch is too costly', () => {
    expect(routeHybridVideo({
      id: 'private-variation',
      useCase: 'bulk-variation',
      contentTier: 'sensual',
      quantity: 10,
      requiresLipSync: false,
      premium: false,
    }, capacity).primary).toBe('darkstar-comfyui');
    expect(routeHybridVideo({
      id: 'too-many-heroes',
      useCase: 'hero-shot',
      contentTier: 'safe',
      quantity: 6,
      requiresLipSync: false,
      premium: true,
    }, capacity)).toMatchObject({
      primary: 'darkstar-comfyui',
      estimatedFlowCredits: 0,
    });
  });

  it('decrements the batch credit ceiling between routes', () => {
    const result = routeHybridVideoBatch([
      {
        id: 'quality-a',
        useCase: 'hero-shot',
        contentTier: 'safe',
        quantity: 3,
        requiresLipSync: false,
        premium: true,
      },
      {
        id: 'quality-b',
        useCase: 'hero-shot',
        contentTier: 'safe',
        quantity: 3,
        requiresLipSync: false,
        premium: true,
      },
    ], capacity);
    expect(result.estimatedFlowCredits).toBe(300);
    expect(result.routes.map((route) => route.primary)).toEqual([
      'google-flow-veo31-quality',
      'darkstar-comfyui',
    ]);
  });
});
