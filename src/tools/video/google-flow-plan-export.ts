/** Convert a QA-approved MySoulmate Short plan into a bounded Google Flow handoff. */

import path from 'path';

import { loadApprovedImageSource } from './approved-media-source.js';
import {
  createGoogleFlowHandoff,
  canonicalSha256,
  type GoogleFlowHandoff,
  type GoogleFlowModel,
  type GoogleFlowSourceShot,
} from './google-flow-handoff.js';

interface PlannedShot {
  index: number;
  assetId: string;
  sourceSha256: string;
  referenceImagePath: string;
  contentTier: 'safe';
  qaStatus: 'approved';
  motionPrompt: string;
}

interface PlannedShort {
  shortId: string;
  locale?: string;
  profile: {
    name: string;
    declaredAdultAge: number;
  };
  render: {
    shots: PlannedShot[];
  };
  publication: {
    visibility: 'private';
    autoPublish: false;
    containsSyntheticMedia: true;
    reviewStatus: 'pending-human-review';
  };
}

interface ShortPlan {
  schemaVersion: 3;
  sourceDigests: {
    imageManifestSha256: string;
    imageCatalogSha256: string;
    factoryConfigSha256: string;
    assetApprovalsSha256: string;
    productionLedgerSha256: string;
  };
  policy: {
    contentTier: 'safe';
    qaStatus: 'approved';
    autoPublish: false;
    initialVisibility: 'private';
    syntheticMediaDisclosureRequired: true;
  };
  shorts: PlannedShort[];
}

const REQUIRED_SOURCE_DIGEST_KEYS = [
  'assetApprovalsSha256',
  'factoryConfigSha256',
  'imageCatalogSha256',
  'imageManifestSha256',
  'productionLedgerSha256',
] as const;

function hasExactSourceDigests(value: unknown): value is ShortPlan['sourceDigests'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return keys.length === REQUIRED_SOURCE_DIGEST_KEYS.length &&
    keys.every((key, index) => key === REQUIRED_SOURCE_DIGEST_KEYS[index]) &&
    REQUIRED_SOURCE_DIGEST_KEYS.every((key) =>
      typeof record[key] === 'string' && /^[a-f0-9]{64}$/u.test(record[key]));
}

export interface GoogleFlowPlanExportOptions {
  approvedAssetRoot: string;
  batchId: string;
  shortId?: string;
  includeAllShorts?: boolean;
  model: GoogleFlowModel;
  durationSeconds: 4 | 6 | 8;
  aspectRatio: '9:16' | '16:9';
  upscale4k: boolean;
  remainingFlowCredits: number;
  maxFlowCreditsPerBatch: number;
  darkstarAvailable: boolean;
  ministarAvailable: boolean;
}

function assertShortPlan(value: unknown): asserts value is ShortPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Short plan must be an object');
  const plan = value as Partial<ShortPlan>;
  if (
    plan.schemaVersion !== 3 ||
    !hasExactSourceDigests(plan.sourceDigests) ||
    plan.policy?.contentTier !== 'safe' ||
    plan.policy.qaStatus !== 'approved' ||
    plan.policy.autoPublish !== false ||
    plan.policy.initialVisibility !== 'private' ||
    plan.policy.syntheticMediaDisclosureRequired !== true ||
    !Array.isArray(plan.shorts) ||
    !plan.shorts.length
  ) {
    throw new Error('Short plan is not safe, QA-approved, private and disclosed');
  }
}

function selectShorts(plan: ShortPlan, options: GoogleFlowPlanExportOptions): PlannedShort[] {
  if (options.shortId && options.includeAllShorts) {
    throw new Error('Select either one Short or all Shorts, not both');
  }
  if (options.shortId) {
    const selected = plan.shorts.find((short) => short.shortId === options.shortId);
    if (!selected) throw new Error(`Unknown Short ID: ${options.shortId}`);
    return [selected];
  }
  return options.includeAllShorts ? plan.shorts : [plan.shorts[0]!];
}

function assertPlannedShort(short: PlannedShort): void {
  if (
    !short.shortId?.trim() ||
    !short.profile?.name?.trim() ||
    !Number.isInteger(short.profile.declaredAdultAge) ||
    short.profile.declaredAdultAge < 25 ||
    short.publication?.visibility !== 'private' ||
    short.publication.autoPublish !== false ||
    short.publication.containsSyntheticMedia !== true ||
    short.publication.reviewStatus !== 'pending-human-review' ||
    !Array.isArray(short.render?.shots) ||
    !short.render.shots.length
  ) {
    throw new Error(`Short ${short.shortId || '<unknown>'} is not approved for a Flow handoff`);
  }
}

/**
 * Validate every source file before creating a handoff. Identical visual shots
 * shared by localized masters are generated once and list every consumer.
 */
export async function exportGoogleFlowHandoffFromPlan(
  value: unknown,
  options: GoogleFlowPlanExportOptions,
): Promise<GoogleFlowHandoff> {
  assertShortPlan(value);
  if (!path.isAbsolute(options.approvedAssetRoot)) throw new Error('Approved asset root must be absolute');
  const selected = selectShorts(value, options);
  const uniqueShots = new Map<string, GoogleFlowSourceShot>();

  for (const short of selected) {
    assertPlannedShort(short);
    for (const shot of short.render.shots) {
      if (
        shot.contentTier !== 'safe' ||
        shot.qaStatus !== 'approved' ||
        !path.isAbsolute(shot.referenceImagePath) ||
        !/^[a-f0-9]{64}$/u.test(shot.sourceSha256) ||
        !shot.motionPrompt?.trim()
      ) {
        throw new Error(`Short ${short.shortId} contains an incomplete or unsafe source shot`);
      }
      const source = await loadApprovedImageSource(
        shot.referenceImagePath,
        options.approvedAssetRoot,
        shot.sourceSha256,
      );
      const key = `${source.sha256}\u0000${shot.motionPrompt.trim()}`;
      const existing = uniqueShots.get(key);
      if (existing) {
        existing.consumerShortIds = [...new Set([...(existing.consumerShortIds ?? []), short.shortId])];
        existing.consumers = [...new Map([...(existing.consumers ?? []), { shortId: short.shortId, shotIndex: shot.index ?? short.render.shots.indexOf(shot) + 1 }]
          .map((consumer) => [`${consumer.shortId}:${consumer.shotIndex}`, consumer])).values()];
        continue;
      }
      uniqueShots.set(key, {
        id: `${short.shortId}-flow-${String(uniqueShots.size + 1).padStart(2, '0')}`,
        characterName: short.profile.name,
        declaredAdultAge: short.profile.declaredAdultAge,
        sourcePath: source.realPath,
        sourceSha256: source.sha256,
        motionPrompt: shot.motionPrompt,
        role: uniqueShots.size === 0 ? 'hero' : uniqueShots.size % 3 === 2 ? 'transition' : 'b-roll',
        consumerShortIds: [short.shortId],
        consumers: [{ shortId: short.shortId, shotIndex: shot.index ?? short.render.shots.indexOf(shot) + 1 }],
      });
    }
  }

  const locales = [...new Set(selected.map((short) => short.locale).filter((locale): locale is string => Boolean(locale)))];
  return createGoogleFlowHandoff([...uniqueShots.values()], {
    sourcePlanSha256: canonicalSha256(value),
    batchId: options.batchId,
    model: options.model,
    locale: locales.length === 1 ? locales[0]! : locales.length ? 'multilingual-shared-visuals' : 'und',
    durationSeconds: options.durationSeconds,
    aspectRatio: options.aspectRatio,
    upscale4k: options.upscale4k,
    capacity: {
      darkstar: options.darkstarAvailable,
      ministar: options.ministarAvailable,
      googleFlow: true,
      remainingFlowCredits: options.remainingFlowCredits,
      maxFlowCreditsPerBatch: options.maxFlowCreditsPerBatch,
    },
  });
}
