import { describe, expect, it } from 'vitest';

import {
  buildGoogleFlowPrompt,
  canonicalSha256,
  createGoogleFlowHandoff,
  verifyGoogleFlowHandoffDigest,
} from '../../../src/tools/video/google-flow-handoff.js';

const SOURCE_PLAN_SHA256 = 'f'.repeat(64);

const shots = [1, 2, 3].map((index) => ({
  id: `lisa-shot-${index}`,
  characterName: 'Lisa',
  declaredAdultAge: 28,
  sourcePath: `/catalog/lisa-${index}.png`,
  sourceSha256: String(index).repeat(64),
  motionPrompt: `distinct cinematic movement ${index}`,
  role: index === 1 ? 'hero' as const : index === 3 ? 'transition' as const : 'b-roll' as const,
  consumerShortIds: [`lisa-pilot-${index}`],
  consumers: [{ shortId: `lisa-pilot-${index}`, shotIndex: index }],
}));

describe('Google Flow handoff', () => {
  it('creates a bounded Ultra-credit Fast batch without API billing or lip sync', () => {
    const handoff = createGoogleFlowHandoff(shots, {
      sourcePlanSha256: SOURCE_PLAN_SHA256,
      batchId: 'lisa-pilot-en',
      model: 'fast',
      locale: 'en-US',
      durationSeconds: 8,
      aspectRatio: '9:16',
      upscale4k: false,
      capacity: {
        darkstar: true,
        ministar: true,
        googleFlow: true,
        remainingFlowCredits: 25_000,
        maxFlowCreditsPerBatch: 100,
      },
    });
    expect(handoff).toMatchObject({
      schemaVersion: 2,
      sourcePlanSha256: SOURCE_PLAN_SHA256,
      provider: 'google-flow-web',
      billingMode: 'google-ai-ultra-flow-credits',
      apiBillingAllowed: false,
      estimatedCredits: 30,
      remainingCreditsAfterEstimate: 24_970,
      humanFlowSessionRequired: true,
      autoPublish: false,
    });
    expect(verifyGoogleFlowHandoffDigest(handoff)).toBe(true);
    expect(handoff.handoffSha256).toBe(canonicalSha256((({ handoffSha256: _digest, ...unsigned }) => unsigned)(handoff)));
    expect(handoff.jobs).toHaveLength(3);
    expect(handoff.jobs[0]).toMatchObject({
      engine: 'google-flow-veo31-fast',
      estimatedCredits: 10,
      settings: { lipSync: false, audio: 'ambient-only' },
    });
  });

  it('reserves Quality for bounded premium batches and refuses credit overflow', () => {
    expect(createGoogleFlowHandoff(shots, {
      sourcePlanSha256: SOURCE_PLAN_SHA256,
      batchId: 'quality-pilot',
      model: 'quality',
      locale: 'fr-FR',
      durationSeconds: 8,
      aspectRatio: '16:9',
      upscale4k: false,
      capacity: {
        darkstar: true,
        ministar: true,
        googleFlow: true,
        remainingFlowCredits: 25_000,
        maxFlowCreditsPerBatch: 300,
      },
    }).estimatedCredits).toBe(300);
    expect(() => createGoogleFlowHandoff(shots, {
      sourcePlanSha256: SOURCE_PLAN_SHA256,
      batchId: 'quality-overflow',
      model: 'quality',
      locale: 'fr-FR',
      durationSeconds: 8,
      aspectRatio: '16:9',
      upscale4k: true,
      capacity: {
        darkstar: true,
        ministar: true,
        googleFlow: true,
        remainingFlowCredits: 25_000,
        maxFlowCreditsPerBatch: 300,
      },
    })).toThrow('reduce or split');
  });

  it('forces safe identity and no-dialogue prompt constraints', () => {
    const prompt = buildGoogleFlowPrompt(shots[0]!, '9:16');
    expect(prompt).toContain('clearly age 28');
    expect(prompt).toContain('preserve face');
    expect(prompt).toContain('No speech');
    expect(prompt).toContain('no visible lip synchronization');
  });

  it('rejects unsupported Quality durations before spending credits', () => {
    expect(() => createGoogleFlowHandoff([shots[0]!], {
      sourcePlanSha256: SOURCE_PLAN_SHA256,
      batchId: 'invalid-quality-duration',
      model: 'quality',
      locale: 'fr-FR',
      durationSeconds: 4,
      aspectRatio: '9:16',
      upscale4k: false,
      capacity: {
        darkstar: true,
        ministar: true,
        googleFlow: true,
        remainingFlowCredits: 25_000,
        maxFlowCreditsPerBatch: 100,
      },
    })).toThrow('only supports 8-second');
  });

  it('rejects a batch ID that could escape a generated output path', () => {
    expect(() => createGoogleFlowHandoff([shots[0]!], {
      sourcePlanSha256: SOURCE_PLAN_SHA256,
      batchId: '../../outside',
      model: 'fast',
      locale: 'fr-FR',
      durationSeconds: 4,
      aspectRatio: '9:16',
      upscale4k: false,
      capacity: {
        darkstar: true,
        ministar: true,
        googleFlow: true,
        remainingFlowCredits: 100,
        maxFlowCreditsPerBatch: 100,
      },
    })).toThrow('safe batch ID');
  });

  it('detects any mutation after the handoff was digest-bound', () => {
    const handoff = createGoogleFlowHandoff([shots[0]!], {
      sourcePlanSha256: SOURCE_PLAN_SHA256,
      batchId: 'digest-pilot',
      model: 'fast',
      locale: 'fr-FR',
      durationSeconds: 4,
      aspectRatio: '9:16',
      upscale4k: false,
      capacity: {
        darkstar: true,
        ministar: true,
        googleFlow: true,
        remainingFlowCredits: 100,
        maxFlowCreditsPerBatch: 100,
      },
    });
    handoff.jobs[0]!.prompt = 'mutated after approval';
    expect(verifyGoogleFlowHandoffDigest(handoff)).toBe(false);
  });
});
