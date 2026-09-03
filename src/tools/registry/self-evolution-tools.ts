/** Read-only formal adapter for the structured CHANGELOG self-model. */

import type { ToolResult } from '../../types/index.js';
import type {
  ITool,
  ToolSchema,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
  IToolExecutionContext,
} from './types.js';
import {
  formatEvolutionNotesSummary,
  queryEvolutionNotes,
  readEvolutionNotes,
} from '../../self-model/evolution-notes.js';

function stringInput(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function validDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

export class SelfEvolutionTool implements ITool {
  readonly name = 'self_evolution';
  readonly description =
    "Read documented changes in Code Buddy's own CHANGELOG, filtered by recency or subject. Read-only, local, and never fleet-safe.";

  async execute(
    input: Record<string, unknown>,
    context?: IToolExecutionContext,
  ): Promise<ToolResult> {
    const since = stringInput(input.since);
    const subject = stringInput(input.subject);
    const limit = typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.floor(input.limit)
      : 5;
    try {
      const notes = queryEvolutionNotes(
        await readEvolutionNotes({ workDir: context?.cwd }),
        {
          ...(since ? { since } : {}),
          ...(subject ? { subject } : {}),
          limit,
        },
      );
      return {
        success: true,
        output: formatEvolutionNotesSummary(notes),
        data: { notes },
      };
    } catch (error) {
      return {
        success: false,
        error: `self_evolution failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          since: { type: 'string', description: 'Inclusive YYYY-MM-DD start date.', maxLength: 10 },
          subject: { type: 'string', description: 'Subject filter, for example voice or memory.', maxLength: 120 },
          limit: { type: 'number', description: 'Maximum number of notes (1–20).', minimum: 1, maximum: 20 },
        },
        required: [],
        additionalProperties: false,
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { valid: false, errors: ['input must be an object'] };
    }
    const value = input as Record<string, unknown>;
    if (value.since !== undefined && (typeof value.since !== 'string' || !validDate(value.since.trim()))) {
      return { valid: false, errors: ['`since` must be a valid YYYY-MM-DD date'] };
    }
    if (value.subject !== undefined && (typeof value.subject !== 'string' || value.subject.trim().length > 120)) {
      return { valid: false, errors: ['`subject` must be a string of at most 120 characters'] };
    }
    if (
      value.limit !== undefined &&
      (typeof value.limit !== 'number' || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 20)
    ) {
      return { valid: false, errors: ['`limit` must be an integer between 1 and 20'] };
    }
    const unknown = Object.keys(value).filter((key) => !['since', 'subject', 'limit'].includes(key));
    return unknown.length > 0
      ? { valid: false, errors: [`unknown input field(s): ${unknown.join(', ')}`] }
      : { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'file_read' as ToolCategoryType,
      keywords: [
        'self', 'evolution', 'evolutions', 'changement', 'changements', 'recent', 'récemment',
        'release', 'changelog', 'notes de version', 'version', 'appris', 'learned', 'voice',
        'voix', 'memory', 'mémoire', 'companion', 'fiabilité', 'reliability',
      ],
      priority: 50,
      modifiesFiles: false,
      makesNetworkRequests: false,
      requiresConfirmation: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createSelfEvolutionTools(): ITool[] {
  return [new SelfEvolutionTool()];
}
