import { countTokens } from '../context/token-counter.js';
import {
  isContextZoomEnabled,
  SegmentArchive,
  SegmentIntegrityError,
  type ArchivedSegment,
} from '../context/segment-archive.js';
import type { ToolResult } from '../types/index.js';
import type {
  ITool,
  IToolExecutionContext,
  IToolMetadata,
  IValidationResult,
  ToolSchema,
} from './registry/types.js';

const DEFAULT_MAX_TOKENS = 4000;
const HARD_MAX_TOKENS = 8000;

export interface ContextExpandToolOptions {
  archive?: SegmentArchive;
}

export class ContextExpandTool implements ITool {
  readonly name = 'context_expand';
  readonly description =
    'Expand an exact archived conversation segment from the current session. Use this whenever a [segment:…] summary does not contain enough detail to answer precisely.';

  private readonly archive: SegmentArchive;

  constructor(options: ContextExpandToolOptions = {}) {
    this.archive = options.archive ?? new SegmentArchive();
  }

  async execute(
    input: Record<string, unknown>,
    context?: IToolExecutionContext,
  ): Promise<ToolResult> {
    if (!isContextZoomEnabled()) {
      return { success: false, error: 'context_expand is disabled; set CODEBUDDY_CONTEXT_ZOOM=true to enable it.' };
    }

    const segmentId = typeof input.segment_id === 'string' ? input.segment_id.trim() : '';
    if (!segmentId) return { success: false, error: 'segment_id is required' };
    if (!context?.sessionId) {
      return { success: false, error: 'No current session is available for context expansion.' };
    }

    let segment: ArchivedSegment | null;
    try {
      segment = this.archive.get(context.sessionId, segmentId);
    } catch (error) {
      if (error instanceof SegmentIntegrityError) {
        return { success: false, error: error.message };
      }
      throw error;
    }
    if (!segment) {
      return {
        success: false,
        error: `Context segment "${segmentId}" was not found in the current session.`,
      };
    }

    const requestedBudget = typeof input.max_tokens === 'number' && Number.isFinite(input.max_tokens)
      ? Math.floor(input.max_tokens)
      : DEFAULT_MAX_TOKENS;
    const maxTokens = Math.min(HARD_MAX_TOKENS, Math.max(1, requestedBudget));
    const rendered = segment.messages.map(message => {
      const content = typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content);
      return `[${message.role}]\n${content ?? 'null'}`;
    }).join('\n\n');

    return {
      success: true,
      output: this.truncateToBudget(rendered, maxTokens),
    };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          segment_id: {
            type: 'string',
            description: 'Segment identifier from a [segment:…] marker in a compacted summary.',
          },
          max_tokens: {
            type: 'number',
            description: `Maximum tokens to return (default ${DEFAULT_MAX_TOKENS}, hard maximum ${HARD_MAX_TOKENS}).`,
            minimum: 1,
            maximum: HARD_MAX_TOKENS,
            default: DEFAULT_MAX_TOKENS,
          },
        },
        required: ['segment_id'],
        additionalProperties: false,
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const record = input as Record<string, unknown>;
    if (typeof record.segment_id !== 'string' || !record.segment_id.trim()) {
      return { valid: false, errors: ['segment_id must be a non-empty string'] };
    }
    if (
      record.max_tokens !== undefined &&
      (typeof record.max_tokens !== 'number' || !Number.isFinite(record.max_tokens) || record.max_tokens < 1)
    ) {
      return { valid: false, errors: ['max_tokens must be a positive number'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility',
      keywords: ['context', 'expand', 'segment', 'summary', 'exact', 'archive', 'conversation'],
      priority: 8,
      requiresConfirmation: false,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return isContextZoomEnabled();
  }

  private truncateToBudget(text: string, maxTokens: number): string {
    if (countTokens(text) <= maxTokens) return text;

    const suffix = `\n\n[truncated to ${maxTokens} tokens]`;
    if (countTokens(suffix) > maxTokens) {
      let end = suffix.length;
      while (end > 0 && countTokens(suffix.slice(0, end)) > maxTokens) end--;
      return suffix.slice(0, end);
    }

    let low = 0;
    let high = text.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (countTokens(text.slice(0, middle) + suffix) <= maxTokens) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return text.slice(0, low) + suffix;
  }
}
