/**
 * ITool adapter over long-form-plan + long-form-production compile.
 * Assesses or compiles an episode plan. Never assembles media, never publishes.
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
import { assessLongFormPlan, type LongFormEpisodePlan } from './video/long-form-plan.js';
import { compileLongFormRenderPacket } from './video/long-form-production.js';
import { parseEnum, requireRecord, toolFail, toolOk } from './video-studio-tool-helpers.js';

const OPERATIONS = ['assess', 'compile'] as const;
type LongFormOperation = (typeof OPERATIONS)[number];

function asPlan(value: unknown): LongFormEpisodePlan {
  const record = requireRecord(value, 'plan');
  if (!Array.isArray(record.chapters)) throw new Error('plan.chapters must be an array');
  return record as unknown as LongFormEpisodePlan;
}

export const VIDEO_LONG_FORM_PLAN_PARAMETERS = {
  type: 'object' as const,
  properties: {
    operation: {
      type: 'string',
      enum: [...OPERATIONS],
      description:
        'assess: quality/monetization-readiness report (never throws on a well-shaped plan). compile: render packet if the plan is production-ready (fails closed otherwise). Neither operation writes files or publishes.',
    },
    plan: {
      type: 'object',
      description:
        'LongFormEpisodePlan (schemaVersion 1): episodeId, locale, title, description, chapters[], publication gate (private, autoPublish false, humanReviewRequired).',
    },
  },
  required: ['operation', 'plan'] as string[],
  additionalProperties: false,
};

export class VideoLongFormPlanTool implements ITool {
  readonly name = 'video_long_form_plan';
  readonly description =
    'Assess or compile an original long-form episode plan (8–20 min, chaptered, private, human-review required). Never generates media, never writes files, never auto-publishes.';

  async execute(input: Record<string, unknown>, _context?: IToolExecutionContext): Promise<ToolResult> {
    try {
      const operation = parseEnum(input.operation, OPERATIONS, 'operation') as LongFormOperation;
      const plan = asPlan(input.plan);
      if (operation === 'assess') {
        return toolOk(assessLongFormPlan(plan));
      }
      const assessment = assessLongFormPlan(plan);
      const packet = compileLongFormRenderPacket(plan);
      return toolOk({ assessment, packet });
    } catch (error) {
      return toolFail(error);
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: VIDEO_LONG_FORM_PLAN_PARAMETERS as unknown as ToolSchema['parameters'],
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
    if (!data.plan || typeof data.plan !== 'object' || Array.isArray(data.plan)) {
      return { valid: false, errors: ['plan (object) is required'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'media' as ToolCategoryType,
      keywords: [
        'video', 'long-form', 'long form', 'episode', 'plan', 'youtube', 'chapters',
        'narration', 'ad break', 'mid-roll', 'épisode', 'plan long', 'compile',
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
