/**
 * ITool adapter over cinematic-trailer-plan.
 * Validates a book-trailer plan or compiles a PREVIEW routing estimate.
 * A preview never authorizes generation or publication.
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
  compileTrailerPreview,
  validateCinematicTrailerPlan,
} from './video/cinematic-trailer-plan.js';
import {
  parseEnum,
  parseHybridCapacity,
  toolFail,
  toolOk,
} from './video-studio-tool-helpers.js';

const OPERATIONS = ['validate', 'preview'] as const;

const CAPACITY_PROPERTIES = {
  darkstar: { type: 'boolean', description: 'Darkstar local GPU worker is available.' },
  ministar: { type: 'boolean', description: 'Ministar local GPU worker is available.' },
  google_flow: { type: 'boolean', description: 'Google Flow (browser-assisted) is available.' },
  remaining_flow_credits: { type: 'number', description: 'Remaining Google Flow credits.' },
  max_flow_credits_per_batch: { type: 'number', description: 'Credit ceiling for this batch.' },
};

export const VIDEO_TRAILER_PLAN_PARAMETERS = {
  type: 'object' as const,
  properties: {
    operation: {
      type: 'string',
      enum: [...OPERATIONS],
      description:
        'validate: fail-closed editorial/status validation. preview: map shots to hybrid-video requests and estimate routing; executionAuthorized and publicationAuthorized are always false.',
    },
    plan: {
      type: 'object',
      description:
        'CinematicTrailerPlan (schemaVersion 1). Accepts unknown/partial values; malformed plans collapse to INCOMPLETE with blockers.',
    },
    capacity: {
      type: 'object',
      description: 'Required for preview: available engines and Flow credit budget.',
      properties: { ...CAPACITY_PROPERTIES },
      required: ['darkstar', 'ministar', 'google_flow', 'remaining_flow_credits', 'max_flow_credits_per_batch'],
      additionalProperties: false,
    },
  },
  required: ['operation', 'plan'] as string[],
  additionalProperties: false,
};

export class VideoTrailerPlanTool implements ITool {
  readonly name = 'video_trailer_plan';
  readonly description =
    'Validate a cinematic book-trailer plan or compile a PREVIEW routing estimate. Never generates media, never spends Flow credits, never authorizes publication.';

  async execute(input: Record<string, unknown>, _context?: IToolExecutionContext): Promise<ToolResult> {
    try {
      const operation = parseEnum(input.operation, OPERATIONS, 'operation');
      if (input.plan === undefined) throw new Error('plan is required');
      if (operation === 'validate') {
        return toolOk(validateCinematicTrailerPlan(input.plan));
      }
      const capacity = parseHybridCapacity(input.capacity);
      return toolOk(compileTrailerPreview(input.plan, capacity));
    } catch (error) {
      return toolFail(error);
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: VIDEO_TRAILER_PLAN_PARAMETERS as unknown as ToolSchema['parameters'],
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
    if (data.plan === undefined) {
      return { valid: false, errors: ['plan is required'] };
    }
    if (data.operation === 'preview') {
      if (!data.capacity || typeof data.capacity !== 'object' || Array.isArray(data.capacity)) {
        return { valid: false, errors: ['capacity (object) is required for preview'] };
      }
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'media' as ToolCategoryType,
      keywords: [
        'video', 'trailer', 'bande-annonce', 'cinematic', 'storyboard', 'book',
        'preview', 'plan', 'narrative', 'hook', 'cta',
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
