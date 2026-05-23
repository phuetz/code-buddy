/**
 * User Model Tool Adapters
 *
 * ITool-compliant adapters for the local user model (Hermes "deepening model of
 * who you are"):
 * - UserModelObserveTool (`user_model_observe`) — propose an observation about
 *   the user's working preferences for human review (never a silent write).
 * - UserModelRecallTool  (`user_model_recall`)  — read accepted observations to
 *   tailor behaviour to the user.
 *
 * Privacy: observations are limited to working preferences/traits/expertise/
 * working-style; sensitive content (health, finances, relationships,
 * credentials) is refused by the model's screen.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import {
  getUserModel,
  USER_OBSERVATION_KINDS,
  UserModelPrivacyError,
} from '../../memory/user-model.js';
import type { UserObservationKind } from '../../memory/user-model.js';

// ============================================================================
// UserModelObserveTool
// ============================================================================

export class UserModelObserveTool implements ITool {
  readonly name = 'user_model_observe';
  readonly description = [
    'Propose an observation about the user for human review (does NOT write the model).',
    'Use after you notice a stable working preference, trait, area of expertise, or working style',
    '(e.g. "prefers French", "wants tests before marking done", "expert in TypeScript").',
    'The observation stays pending until a human accepts it via "buddy user-model".',
    'Scope is working preferences only — do NOT record health, finances, relationships, or credentials.',
  ].join(' ');

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const kind = (input.kind as UserObservationKind) ?? 'preference';
    const content = input.content as string;
    const note = input.note as string | undefined;
    const confidence = typeof input.confidence === 'number' ? (input.confidence as number) : undefined;

    if (!content) return { success: false, error: 'content is required' };
    if (!USER_OBSERVATION_KINDS.includes(kind)) {
      return { success: false, error: `kind must be one of: ${USER_OBSERVATION_KINDS.join(', ')}` };
    }

    try {
      const model = getUserModel(process.cwd());

      let runId: string | undefined;
      try {
        const { getActiveRunStore } = await import('../../observability/run-store.js');
        runId = getActiveRunStore()?.getCurrentRunId() ?? undefined;
      } catch {
        // RunStore may not be active — provenance is best-effort.
      }

      const { observation, deduped } = model.observe({
        kind,
        content,
        ...(typeof confidence === 'number' ? { confidence } : {}),
        source: 'self_observed',
        ...(runId || note
          ? { provenance: { ...(runId ? { runId } : {}), ...(note ? { note } : {}) } }
          : {}),
      });

      const verb = deduped ? 'Matched existing observation' : 'Proposed observation';
      return {
        success: true,
        output:
          `${verb} [${observation.id}] (${kind}): ${content}\n` +
          'It is awaiting human review and is NOT yet part of the user model. ' +
          `Accept with: buddy user-model accept ${observation.id} --by <name>`,
      };
    } catch (err) {
      if (err instanceof UserModelPrivacyError) {
        return {
          success: false,
          error: `user_model_observe ${err.message}. Record only working preferences.`,
        };
      }
      return {
        success: false,
        error: `user_model_observe failed: ${err instanceof Error ? err.message : String(err)}`,
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
          kind: {
            type: 'string',
            enum: [...USER_OBSERVATION_KINDS],
            description: 'Observation kind: preference, trait, expertise, or working-style',
          },
          content: {
            type: 'string',
            description: 'The observation about the user (working preferences only)',
          },
          confidence: {
            type: 'number',
            description: 'Optional 0..1 confidence in the observation',
          },
          note: {
            type: 'string',
            description: 'Optional provenance note (e.g. what prompted the observation)',
          },
        },
        required: ['content'],
      },
    };
  }

  validate(input: Record<string, unknown>): IValidationResult {
    if (!input.content) {
      return { valid: false, errors: ['content is required'] };
    }
    if (input.kind && !USER_OBSERVATION_KINDS.includes(input.kind as UserObservationKind)) {
      return { valid: false, errors: [`kind must be one of: ${USER_OBSERVATION_KINDS.join(', ')}`] };
    }
    return { valid: true, errors: [] };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'planning' as ToolCategoryType,
      keywords: ['user', 'model', 'preference', 'observe', 'profile', 'personalization', 'self-improvement'],
      priority: 76,
      version: '1.0.0',
      author: 'Code Buddy',
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// UserModelRecallTool
// ============================================================================

export class UserModelRecallTool implements ITool {
  readonly name = 'user_model_recall';
  readonly description = [
    'Recall what is known about the user (accepted observations only) to tailor your approach.',
    'Optionally filter by kind (preference/trait/expertise/working-style) or a keyword query.',
    'Read-only: this never proposes or writes observations.',
  ].join(' ');

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const kind = input.kind as UserObservationKind | undefined;
    const query = (input.query as string | undefined)?.toLowerCase().trim();

    if (kind && !USER_OBSERVATION_KINDS.includes(kind)) {
      return { success: false, error: `kind must be one of: ${USER_OBSERVATION_KINDS.join(', ')}` };
    }

    try {
      const model = getUserModel(process.cwd());

      if (!query) {
        const summary = model.summarize();
        if (!summary) {
          return { success: true, output: 'No accepted observations about the user yet.' };
        }
        if (!kind) {
          return { success: true, output: summary };
        }
      }

      const matches = model
        .getAccepted(kind)
        .filter((obs) => !query || obs.content.toLowerCase().includes(query));
      if (matches.length === 0) {
        return { success: true, output: 'No matching observations about the user.' };
      }
      const lines = matches.map((obs) => `- [${obs.kind}] ${obs.content}`);
      return { success: true, output: `Known about the user:\n${lines.join('\n')}` };
    } catch (err) {
      return {
        success: false,
        error: `user_model_recall failed: ${err instanceof Error ? err.message : String(err)}`,
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
          kind: {
            type: 'string',
            enum: [...USER_OBSERVATION_KINDS],
            description: 'Optional: filter to a specific observation kind',
          },
          query: {
            type: 'string',
            description: 'Optional keyword to filter accepted observations',
          },
        },
        required: [],
      },
    };
  }

  validate(input: Record<string, unknown>): IValidationResult {
    if (input.kind && !USER_OBSERVATION_KINDS.includes(input.kind as UserObservationKind)) {
      return { valid: false, errors: [`kind must be one of: ${USER_OBSERVATION_KINDS.join(', ')}`] };
    }
    return { valid: true, errors: [] };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'planning' as ToolCategoryType,
      keywords: ['user', 'model', 'preference', 'recall', 'profile', 'personalization'],
      priority: 76,
      version: '1.0.0',
      author: 'Code Buddy',
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createUserModelTools(): ITool[] {
  return [new UserModelObserveTool(), new UserModelRecallTool()];
}
