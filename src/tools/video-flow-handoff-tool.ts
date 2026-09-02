/**
 * ITool adapter over google-flow-handoff / plan-export / result-import review.
 * Builds or verifies browser-assisted Flow work packets. Never calls an unofficial
 * API, never bills, never writes files, never publishes.
 */

import type { ToolResult } from '../types/index.js';
import type {
  ITool,
  IToolExecutionContext,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
  ToolSchema,
} from './registry/types.js';
import {
  createGoogleFlowHandoff,
  verifyGoogleFlowHandoffDigest,
  type GoogleFlowHandoff,
  type GoogleFlowHandoffOptions,
  type GoogleFlowModel,
  type GoogleFlowSourceShot,
} from './video/google-flow-handoff.js';
import { exportGoogleFlowHandoffFromPlan } from './video/google-flow-plan-export.js';
import {
  reviewGoogleFlowImport,
  type GoogleFlowImportReceipt,
  type GoogleFlowReviewChecks,
} from './video/google-flow-result-import.js';
import {
  firstPresent,
  optionalString,
  parseEnum,
  parseHybridCapacity,
  pickBoolean,
  pickFiniteNumber,
  pickInteger,
  pickString,
  requireRecord,
  toolFail,
  toolOk,
} from './video-studio-tool-helpers.js';

const OPERATIONS = ['create', 'verify', 'export', 'review_import'] as const;
const MODELS: readonly GoogleFlowModel[] = ['lite', 'fast', 'quality'];
const ASPECTS = ['9:16', '16:9'] as const;
const ROLES = ['hero', 'b-roll', 'transition'] as const;

const CAPACITY_PROPERTIES = {
  gpuNode: { type: 'boolean', description: 'GPU node local GPU worker is available.' },
  ministar: { type: 'boolean', description: 'Ministar local GPU worker is available.' },
  google_flow: { type: 'boolean', description: 'Google Flow (browser-assisted) is available.' },
  remaining_flow_credits: { type: 'number', description: 'Remaining Google Flow credits.' },
  max_flow_credits_per_batch: { type: 'number', description: 'Credit ceiling for this batch.' },
};

function parseDuration(value: unknown): 4 | 6 | 8 {
  if (value === 4 || value === 6 || value === 8) return value;
  throw new Error('duration_seconds must be 4, 6 or 8');
}

function parseShot(value: unknown, index: number): GoogleFlowSourceShot {
  const record = requireRecord(value, `shots[${index}]`);
  const role = parseEnum(
    firstPresent(record, ['role']),
    ROLES,
    `shots[${index}].role`,
  );
  const shot: GoogleFlowSourceShot = {
    id: pickString(record, ['id'], `shots[${index}].id`),
    characterName: pickString(record, ['character_name', 'characterName'], `shots[${index}].character_name`),
    declaredAdultAge: pickInteger(
      record,
      ['declared_adult_age', 'declaredAdultAge'],
      `shots[${index}].declared_adult_age`,
      1,
    ),
    sourcePath: pickString(record, ['source_path', 'sourcePath'], `shots[${index}].source_path`),
    sourceSha256: pickString(record, ['source_sha256', 'sourceSha256'], `shots[${index}].source_sha256`),
    motionPrompt: pickString(record, ['motion_prompt', 'motionPrompt'], `shots[${index}].motion_prompt`),
    role,
  };
  const consumerShortIds = firstPresent(record, ['consumer_short_ids', 'consumerShortIds']);
  if (Array.isArray(consumerShortIds)) {
    shot.consumerShortIds = consumerShortIds.map((id, i) => {
      if (typeof id !== 'string' || !id.trim()) {
        throw new Error(`shots[${index}].consumer_short_ids[${i}] must be a non-empty string`);
      }
      return id.trim();
    });
  }
  const consumers = firstPresent(record, ['consumers']);
  if (Array.isArray(consumers)) {
    shot.consumers = consumers.map((item, i) => {
      const consumer = requireRecord(item, `shots[${index}].consumers[${i}]`);
      const shotIndex = firstPresent(consumer, ['shot_index', 'shotIndex']);
      if (typeof shotIndex !== 'number' || !Number.isSafeInteger(shotIndex) || shotIndex < 1) {
        throw new Error(`shots[${index}].consumers[${i}].shot_index must be an integer >= 1`);
      }
      return {
        shortId: pickString(consumer, ['short_id', 'shortId'], `shots[${index}].consumers[${i}].short_id`),
        shotIndex,
      };
    });
  }
  return shot;
}

function parseCreateOptions(input: Record<string, unknown>): GoogleFlowHandoffOptions {
  return {
    sourcePlanSha256: pickString(input, ['source_plan_sha256', 'sourcePlanSha256'], 'source_plan_sha256'),
    batchId: pickString(input, ['batch_id', 'batchId'], 'batch_id'),
    model: parseEnum(input.model, MODELS, 'model'),
    locale: pickString(input, ['locale'], 'locale'),
    durationSeconds: parseDuration(firstPresent(input, ['duration_seconds', 'durationSeconds'])),
    aspectRatio: parseEnum(
      firstPresent(input, ['aspect_ratio', 'aspectRatio']),
      ASPECTS,
      'aspect_ratio',
    ),
    upscale4k: pickBoolean(input, ['upscale_4k', 'upscale4k'], 'upscale_4k'),
    capacity: parseHybridCapacity(input.capacity),
  };
}

function parseFlowReviewChecks(value: unknown): GoogleFlowReviewChecks {
  const record = requireRecord(value, 'checks');
  return {
    identity: pickBoolean(record, ['identity'], 'checks.identity'),
    anatomy: pickBoolean(record, ['anatomy'], 'checks.anatomy'),
    motion: pickBoolean(record, ['motion'], 'checks.motion'),
    cleanEnd: pickBoolean(record, ['clean_end', 'cleanEnd'], 'checks.clean_end'),
    noSpeech: pickBoolean(record, ['no_speech', 'noSpeech'], 'checks.no_speech'),
    noTextOrLogo: pickBoolean(record, ['no_text_or_logo', 'noTextOrLogo'], 'checks.no_text_or_logo'),
    safeContent: pickBoolean(record, ['safe_content', 'safeContent'], 'checks.safe_content'),
  };
}

export const VIDEO_FLOW_HANDOFF_PARAMETERS = {
  type: 'object' as const,
  properties: {
    operation: {
      type: 'string',
      enum: [...OPERATIONS],
      description:
        'create: build a signed Flow handoff from shots. verify: check handoffSha256. export: convert a QA-approved Short plan (reads approved assets, writes nothing). review_import: digest-bound human review of an import receipt (writes nothing). Never bills, never publishes.',
    },
    shots: {
      type: 'array',
      items: { type: 'object' },
      description: 'Source shots for create (absolute source_path, SHA-256, adult identity, consumers).',
    },
    handoff: {
      type: 'object',
      description: 'GoogleFlowHandoff document for verify.',
    },
    plan: {
      type: 'object',
      description: 'QA-approved Short plan (schemaVersion 3) for export.',
    },
    receipt: {
      type: 'object',
      description: 'GoogleFlowImportReceipt for review_import.',
    },
    capacity: {
      type: 'object',
      description: 'Engine availability and Flow credits (create).',
      properties: { ...CAPACITY_PROPERTIES },
      required: ['gpuNode', 'ministar', 'google_flow', 'remaining_flow_credits', 'max_flow_credits_per_batch'],
      additionalProperties: false,
    },
    source_plan_sha256: { type: 'string', description: 'Canonical SHA-256 of the V3 source plan (create).' },
    batch_id: { type: 'string', description: 'Safe batch id (lowercase kebab).' },
    model: { type: 'string', enum: ['lite', 'fast', 'quality'], description: 'Flow model family.' },
    locale: { type: 'string', description: 'BCP 47 locale (create).' },
    duration_seconds: { type: 'number', description: 'Clip duration in seconds: 4, 6 or 8. Quality requires 8.' },
    aspect_ratio: { type: 'string', enum: ['9:16', '16:9'], description: 'Output aspect ratio.' },
    upscale_4k: { type: 'boolean', description: '4K upscale surcharge.' },
    approved_asset_root: { type: 'string', description: 'Absolute approved-asset root (export).' },
    short_id: { type: 'string', description: 'Export a single Short id (mutually exclusive with include_all_shorts).' },
    include_all_shorts: { type: 'boolean', description: 'Export every Short in the plan.' },
    remaining_flow_credits: { type: 'number', description: 'Remaining Flow credits (export).' },
    max_flow_credits_per_batch: { type: 'number', description: 'Batch credit ceiling (export).' },
    gpu_node_available: { type: 'boolean', description: 'GPU node available (export).' },
    ministar_available: { type: 'boolean', description: 'Ministar available (export).' },
    expected_receipt_sha256: { type: 'string', description: 'Expected import receipt digest (review_import).' },
    reviewer: { type: 'string', description: 'Reviewer name (review_import).' },
    reason: { type: 'string', description: 'Review reason (review_import).' },
    checks: {
      type: 'object',
      description: 'Flow human-review checks (review_import).',
      properties: {
        identity: { type: 'boolean', description: 'Identity preserved.' },
        anatomy: { type: 'boolean', description: 'Anatomy plausible.' },
        motion: { type: 'boolean', description: 'Motion approved.' },
        clean_end: { type: 'boolean', description: 'Clean end frame.' },
        no_speech: { type: 'boolean', description: 'No speech in the clip.' },
        no_text_or_logo: { type: 'boolean', description: 'No burned-in text or logo.' },
        safe_content: { type: 'boolean', description: 'Advertiser-safe content.' },
      },
      required: ['identity', 'anatomy', 'motion', 'clean_end', 'no_speech', 'no_text_or_logo', 'safe_content'],
      additionalProperties: false,
    },
  },
  required: ['operation'] as string[],
  additionalProperties: false,
};

export class VideoFlowHandoffTool implements ITool {
  readonly name = 'video_flow_handoff';
  readonly description =
    'Build, verify, export or human-review Google Flow (Veo) browser-assisted work packets. Billing stays on Ultra Flow credits; apiBillingAllowed is always false; never publishes.';

  async execute(input: Record<string, unknown>, _context?: IToolExecutionContext): Promise<ToolResult> {
    try {
      const operation = parseEnum(input.operation, OPERATIONS, 'operation');
      if (operation === 'create') {
        const shotsValue = input.shots;
        if (!Array.isArray(shotsValue) || shotsValue.length === 0) {
          throw new Error('shots must be a non-empty array');
        }
        const shots = shotsValue.map((shot, index) => parseShot(shot, index));
        return toolOk(createGoogleFlowHandoff(shots, parseCreateOptions(input)));
      }
      if (operation === 'verify') {
        const handoff = requireRecord(input.handoff, 'handoff') as unknown as GoogleFlowHandoff;
        return toolOk({ valid: verifyGoogleFlowHandoffDigest(handoff) });
      }
      if (operation === 'export') {
        const approvedAssetRoot = pickString(
          input,
          ['approved_asset_root', 'approvedAssetRoot'],
          'approved_asset_root',
        );
        const includeAll = input.include_all_shorts === true || input.includeAllShorts === true;
        const shortId = optionalString(input, 'short_id') ?? optionalString(input, 'shortId');
        return toolOk(await exportGoogleFlowHandoffFromPlan(input.plan, {
          approvedAssetRoot,
          batchId: pickString(input, ['batch_id', 'batchId'], 'batch_id'),
          ...(shortId ? { shortId } : {}),
          ...(includeAll ? { includeAllShorts: true } : {}),
          model: parseEnum(input.model, MODELS, 'model'),
          durationSeconds: parseDuration(firstPresent(input, ['duration_seconds', 'durationSeconds'])),
          aspectRatio: parseEnum(
            firstPresent(input, ['aspect_ratio', 'aspectRatio']),
            ASPECTS,
            'aspect_ratio',
          ),
          upscale4k: pickBoolean(input, ['upscale_4k', 'upscale4k'], 'upscale_4k'),
          remainingFlowCredits: pickFiniteNumber(
            input,
            ['remaining_flow_credits', 'remainingFlowCredits'],
            'remaining_flow_credits',
          ),
          maxFlowCreditsPerBatch: pickFiniteNumber(
            input,
            ['max_flow_credits_per_batch', 'maxFlowCreditsPerBatch'],
            'max_flow_credits_per_batch',
          ),
          gpuNodeAvailable: pickBoolean(input, ['gpu_node_available', 'gpuNodeAvailable'], 'gpu_node_available'),
          ministarAvailable: pickBoolean(input, ['ministar_available', 'ministarAvailable'], 'ministar_available'),
        }));
      }
      const receipt = requireRecord(input.receipt, 'receipt') as unknown as GoogleFlowImportReceipt;
      const expected = pickString(
        input,
        ['expected_receipt_sha256', 'expectedReceiptSha256'],
        'expected_receipt_sha256',
      );
      return toolOk(reviewGoogleFlowImport({
        receipt,
        expectedReceiptSha256: expected,
        reviewer: pickString(input, ['reviewer'], 'reviewer'),
        reason: pickString(input, ['reason'], 'reason'),
        checks: parseFlowReviewChecks(input.checks),
      }));
    } catch (error) {
      return toolFail(error);
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: VIDEO_FLOW_HANDOFF_PARAMETERS as unknown as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.operation !== 'string' || !(OPERATIONS as readonly string[]).includes(data.operation)) {
      return { valid: false, errors: [`operation must be one of: ${OPERATIONS.join(', ')}`] };
    }
    if (data.operation === 'create') {
      if (!Array.isArray(data.shots) || data.shots.length === 0) {
        return { valid: false, errors: ['shots (non-empty array) is required for create'] };
      }
      if (!data.capacity || typeof data.capacity !== 'object' || Array.isArray(data.capacity)) {
        return { valid: false, errors: ['capacity is required for create'] };
      }
    }
    if (data.operation === 'verify' && (data.handoff === undefined || typeof data.handoff !== 'object')) {
      return { valid: false, errors: ['handoff (object) is required for verify'] };
    }
    if (data.operation === 'export' && (data.plan === undefined || typeof data.plan !== 'object')) {
      return { valid: false, errors: ['plan (object) is required for export'] };
    }
    if (data.operation === 'review_import' && (data.receipt === undefined || typeof data.receipt !== 'object')) {
      return { valid: false, errors: ['receipt (object) is required for review_import'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'media' as ToolCategoryType,
      keywords: [
        'video', 'flow', 'google flow', 'veo', 'handoff', 'export', 'import',
        'credits', 'browser', 'packet', 'transfert', 'veo3',
      ],
      priority: 8,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}
