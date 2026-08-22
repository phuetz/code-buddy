/** Browser-assisted Google Flow work packets. No unofficial API or hidden billing. */

import { createHash } from 'crypto';

import {
  routeHybridVideoBatch,
  type HybridVideoCapacity,
  type HybridVideoEngine,
  type HybridVideoUseCase,
} from './hybrid-video-router.js';

export type GoogleFlowModel = 'lite' | 'fast' | 'quality';

export interface GoogleFlowSourceShot {
  id: string;
  characterName: string;
  declaredAdultAge: number;
  sourcePath: string;
  sourceSha256: string;
  motionPrompt: string;
  role: 'hero' | 'b-roll' | 'transition';
  consumerShortIds?: string[];
  consumers?: Array<{ shortId: string; shotIndex: number }>;
}

export interface GoogleFlowHandoffOptions {
  sourcePlanSha256: string;
  batchId: string;
  model: GoogleFlowModel;
  locale: string;
  durationSeconds: 4 | 6 | 8;
  aspectRatio: '9:16' | '16:9';
  upscale4k: boolean;
  capacity: HybridVideoCapacity;
}

export interface GoogleFlowHandoffJob {
  id: string;
  engine: HybridVideoEngine;
  executionMode: 'browser-assisted';
  estimatedCredits: number;
  source: {
    path: string;
    sha256: string;
  };
  consumerShortIds: string[];
  consumers: Array<{ shortId: string; shotIndex: number }>;
  prompt: string;
  role: 'hero' | 'b-roll' | 'transition';
  settings: {
    durationSeconds: 4 | 6 | 8;
    aspectRatio: '9:16' | '16:9';
    upscale4k: boolean;
    audio: 'ambient-only';
    lipSync: false;
  };
  status: 'awaiting-flow-generation';
}

export interface GoogleFlowHandoff {
  schemaVersion: 2;
  sourcePlanSha256: string;
  handoffSha256: string;
  batchId: string;
  provider: 'google-flow-web';
  billingMode: 'google-ai-ultra-flow-credits';
  apiBillingAllowed: false;
  model: GoogleFlowModel;
  locale: string;
  estimatedCredits: number;
  remainingCreditsBefore: number;
  remainingCreditsAfterEstimate: number;
  humanFlowSessionRequired: true;
  autoPublish: false;
  jobs: GoogleFlowHandoffJob[];
}

type UnsignedGoogleFlowHandoff = Omit<GoogleFlowHandoff, 'handoffSha256'>;

/** Stable JSON encoding used by local handoff and receipt digests. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function verifyGoogleFlowHandoffDigest(handoff: GoogleFlowHandoff): boolean {
  const { handoffSha256, ...unsigned } = handoff;
  return /^[a-f0-9]{64}$/u.test(handoffSha256) && canonicalSha256(unsigned) === handoffSha256;
}

function routeSettings(model: GoogleFlowModel): { useCase: HybridVideoUseCase; premium: boolean } {
  if (model === 'quality') return { useCase: 'hero-shot', premium: true };
  if (model === 'lite') return { useCase: 'bulk-variation', premium: false };
  return { useCase: 'long-form-b-roll', premium: false };
}

export function buildGoogleFlowPrompt(shot: GoogleFlowSourceShot, aspectRatio: '9:16' | '16:9'): string {
  if (!shot.characterName.trim() || shot.declaredAdultAge < 25 || !shot.motionPrompt.trim()) {
    throw new Error(`Flow shot ${shot.id} lacks an approved adult identity or motion prompt`);
  }
  return [
    `Fictional adult character ${shot.characterName}, clearly age ${shot.declaredAdultAge}.`,
    'Use the supplied image as the identity reference; preserve face, hair, body proportions and wardrobe.',
    shot.motionPrompt.trim(),
    aspectRatio === '9:16' ? 'Vertical cinematic composition for YouTube Shorts.' : 'Cinematic widescreen composition.',
    'Natural anatomy, coherent hands, stable background, physically plausible motion, no text, no logo.',
    'Ambient sound only. No speech, no singing and no visible lip synchronization.',
    'End on a visually clean frame suitable for editing into a larger original story.',
  ].join(' ');
}

export function createGoogleFlowHandoff(
  shots: readonly GoogleFlowSourceShot[],
  options: GoogleFlowHandoffOptions,
): GoogleFlowHandoff {
  if (!/^[a-f0-9]{64}$/u.test(options.sourcePlanSha256)) {
    throw new Error('Flow handoff requires the canonical SHA-256 of its V3 source plan');
  }
  if (new Set(shots.map((shot) => shot.id)).size !== shots.length) {
    throw new Error('Flow handoff job IDs must be unique');
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,125}[a-z0-9])?$/u.test(options.batchId) || !shots.length) {
    throw new Error('Flow handoff requires a safe batch ID and shots');
  }
  for (const shot of shots) {
    if (
      !/^[a-z0-9](?:[a-z0-9-]{0,125}[a-z0-9])?$/u.test(shot.id) ||
      !/^[a-f0-9]{64}$/u.test(shot.sourceSha256) || !shot.sourcePath.startsWith('/') ||
      !['hero', 'b-roll', 'transition'].includes(shot.role) ||
      !(shot.consumers?.length || shot.consumerShortIds?.length) ||
      (shot.consumerShortIds ?? []).some((shortId) =>
        !/^[a-z0-9](?:[a-z0-9-]{0,125}[a-z0-9])?$/u.test(shortId)) ||
      (shot.consumers ?? []).some((consumer) =>
        !/^[a-z0-9](?:[a-z0-9-]{0,125}[a-z0-9])?$/u.test(consumer.shortId) ||
        !Number.isInteger(consumer.shotIndex) || consumer.shotIndex < 1)
    ) throw new Error(`Flow shot ${shot.id || '<unknown>'} has an unsafe source or consumer mapping`);
  }
  if (options.model === 'quality' && options.durationSeconds !== 8) {
    throw new Error('Veo 3.1 Quality only supports 8-second generations in Google Flow');
  }
  const settings = routeSettings(options.model);
  const routed = routeHybridVideoBatch(
    shots.map((shot) => ({
      id: shot.id,
      useCase: settings.useCase,
      contentTier: 'safe' as const,
      quantity: 1,
      requiresLipSync: false,
      premium: settings.premium,
      upscale4k: options.upscale4k,
    })),
    options.capacity,
  );
  const jobs = shots.map((shot, index): GoogleFlowHandoffJob => {
    const route = routed.routes[index]!;
    if (!route.primary.startsWith('google-flow-') || route.executionMode !== 'browser-assisted') {
      throw new Error(`Flow credit guardrail routed ${shot.id} to ${route.primary}; reduce or split the batch`);
    }
    return {
      id: shot.id,
      engine: route.primary,
      executionMode: 'browser-assisted',
      estimatedCredits: route.estimatedFlowCredits,
      source: { path: shot.sourcePath, sha256: shot.sourceSha256 },
      consumerShortIds: [...new Set(shot.consumerShortIds ?? [])],
      consumers: [...new Map((shot.consumers?.length ? shot.consumers : (shot.consumerShortIds ?? []).map((shortId) => ({
        shortId,
        shotIndex: index + 1,
      }))).map((consumer) => [`${consumer.shortId}:${consumer.shotIndex}`, consumer])).values()],
      prompt: buildGoogleFlowPrompt(shot, options.aspectRatio),
      role: shot.role,
      settings: {
        durationSeconds: options.durationSeconds,
        aspectRatio: options.aspectRatio,
        upscale4k: options.upscale4k,
        audio: 'ambient-only',
        lipSync: false,
      },
      status: 'awaiting-flow-generation',
    };
  });
  const unsigned: UnsignedGoogleFlowHandoff = {
    schemaVersion: 2,
    sourcePlanSha256: options.sourcePlanSha256,
    batchId: options.batchId,
    provider: 'google-flow-web',
    billingMode: 'google-ai-ultra-flow-credits',
    apiBillingAllowed: false,
    model: options.model,
    locale: options.locale,
    estimatedCredits: routed.estimatedFlowCredits,
    remainingCreditsBefore: options.capacity.remainingFlowCredits,
    remainingCreditsAfterEstimate: options.capacity.remainingFlowCredits - routed.estimatedFlowCredits,
    humanFlowSessionRequired: true,
    autoPublish: false,
    jobs,
  };
  return { ...unsigned, handoffSha256: canonicalSha256(unsigned) };
}
