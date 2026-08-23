/**
 * ITool adapter over hybrid-video-router — pure routing, no execution, no I/O.
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
import { routeHybridVideo, routeHybridVideoBatch } from './video/hybrid-video-router.js';
import {
  parseHybridCapacity,
  parseHybridRequest,
  parseHybridRequestList,
  toolFail,
  toolOk,
} from './video-studio-tool-helpers.js';

const CAPACITY_PROPERTIES = {
  darkstar: { type: 'boolean', description: 'Darkstar local GPU worker is available.' },
  ministar: { type: 'boolean', description: 'Ministar local GPU worker is available.' },
  google_flow: { type: 'boolean', description: 'Google Flow (browser-assisted) is available.' },
  remaining_flow_credits: { type: 'number', description: 'Remaining Google Flow credits.' },
  max_flow_credits_per_batch: { type: 'number', description: 'Credit ceiling for this batch.' },
};

const REQUEST_PROPERTIES = {
  id: { type: 'string', description: 'Request id (non-empty).' },
  use_case: {
    type: 'string',
    enum: ['avatar-lipsync', 'bulk-variation', 'hero-shot', 'long-form-b-roll', 'transition'],
    description: 'Production use case.',
  },
  content_tier: {
    type: 'string',
    enum: ['safe', 'sensual', 'explicit'],
    description: 'Content tier. Non-safe stays on local engines.',
  },
  quantity: { type: 'number', description: 'Positive integer quantity.' },
  requires_lip_sync: { type: 'boolean', description: 'Whether lip synchronization is required.' },
  premium: { type: 'boolean', description: 'Premium/hero quality (Veo Quality when Flow can spend).' },
  upscale_4k: { type: 'boolean', description: 'Optional 4K upscale surcharge on Flow engines.' },
};

export const VIDEO_ROUTE_PARAMETERS = {
  type: 'object' as const,
  properties: {
    request: {
      type: 'object',
      description: 'Single hybrid video request to route.',
      properties: { ...REQUEST_PROPERTIES },
      required: ['id', 'use_case', 'content_tier', 'quantity', 'requires_lip_sync', 'premium'],
      additionalProperties: false,
    },
    requests: {
      type: 'array',
      items: {
        type: 'object',
        properties: { ...REQUEST_PROPERTIES },
        required: ['id', 'use_case', 'content_tier', 'quantity', 'requires_lip_sync', 'premium'],
        additionalProperties: false,
      },
      description: 'Batch of requests (credit ceiling decrements between items).',
    },
    capacity: {
      type: 'object',
      description: 'Available engines and Flow credit budget.',
      properties: { ...CAPACITY_PROPERTIES },
      required: ['darkstar', 'ministar', 'google_flow', 'remaining_flow_credits', 'max_flow_credits_per_batch'],
      additionalProperties: false,
    },
  },
  required: ['capacity'] as string[],
  additionalProperties: false,
};

export class VideoRouteTool implements ITool {
  readonly name = 'video_route';
  readonly description =
    'Route hybrid image/video production requests to a local engine (Darkstar/Ministar/LongCat) or browser-assisted Google Flow. Pure policy: estimates credits, never spends, never generates media, never publishes.';

  async execute(input: Record<string, unknown>, _context?: IToolExecutionContext): Promise<ToolResult> {
    try {
      const capacity = parseHybridCapacity(input.capacity);
      if (input.requests !== undefined) {
        const requests = parseHybridRequestList(input.requests);
        return toolOk(routeHybridVideoBatch(requests, capacity));
      }
      if (input.request !== undefined) {
        return toolOk(routeHybridVideo(parseHybridRequest(input.request), capacity));
      }
      throw new Error('Provide request (one) or requests (batch)');
    } catch (error) {
      return toolFail(error);
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: VIDEO_ROUTE_PARAMETERS as unknown as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (!data.capacity || typeof data.capacity !== 'object' || Array.isArray(data.capacity)) {
      return { valid: false, errors: ['capacity (object) is required'] };
    }
    const hasRequest = data.request !== undefined;
    const hasRequests = data.requests !== undefined;
    if (hasRequest === hasRequests) {
      return { valid: false, errors: ['Provide exactly one of request or requests'] };
    }
    if (hasRequests && (!Array.isArray(data.requests) || data.requests.length === 0)) {
      return { valid: false, errors: ['requests must be a non-empty array'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'media' as ToolCategoryType,
      keywords: [
        'video', 'route', 'router', 'hybrid', 'flow', 'veo', 'comfyui', 'longcat',
        'darkstar', 'ministar', 'credits', 'engine', 'routage', 'moteur',
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
