import { SELF_DESCRIBE_TOOL } from '../../codebuddy/tool-definitions/self-describe-tools.js';
/**
 * Self-describe tool adapter.
 *
 * ITool exposing `self_describe` — "de quoi es-tu fait ?": the robot's live
 * manifest of the bricks that compose it (buddy-sense, buddy-vision,
 * buddy-memory) plus its registered/configured faculties (tools, providers,
 * sensors), without inferring runtime liveness. Read-only,
 * auto-approved. The result text flows back through the normal agent→voice path
 * so the companion can speak it. See src/tools/self-describe.ts.
 */

import type { ToolResult } from '../../types/index.js';
import type {
  ITool,
  ToolSchema,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
  IToolExecutionContext,
} from './types.js';
import { buildSelfDescription } from '../self-describe.js';
import {
  buildOperationalSelfModel,
  resolveCodeBuddyCoreRoot,
  type CompanionRuntimeEvidence,
  type OperationalSelfDepth,
} from '../../identity/operational-self-model.js';

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const name = entry.trim();
    if (!name) continue;
    names.add(name);
    if (names.size >= 500) break;
  }
  return [...names];
}

function contextString(context: IToolExecutionContext | undefined, key: string): string | undefined {
  const value = context?.extra?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export class SelfDescribeTool implements ITool {
  readonly name = 'self_describe';
  readonly description = SELF_DESCRIBE_TOOL.function.description;

  async execute(
    input: Record<string, unknown>,
    context?: IToolExecutionContext,
  ): Promise<ToolResult> {
    // Resolve registered/configured faculties best-effort — a failure just omits that detail.
    let toolNames: string[] | undefined;
    try {
      const { getFormalToolRegistry } = await import('./tool-registry.js');
      toolNames = getFormalToolRegistry().getNames();
    } catch {
      toolNames = undefined;
    }

    // Never initialise the global PersonaManager from an auto-approved read.
    // Its constructor creates directories and a filesystem watcher. A host may
    // transport an already-attested name (or configure it in the process
    // environment); otherwise identity remains omitted.
    const personaRobotName =
      contextString(context, 'robotName') ?? process.env.CODEBUDDY_ROBOT_NAME?.trim();
    const exposedToolNames = stringList(context?.extra?.exposedToolNames);
    const { getRuntimeSettingsSnapshot } = await import('../../services/runtime-settings-context.js');
    const settings = getRuntimeSettingsSnapshot({
      surface: contextString(context, 'surface'), model: contextString(context, 'model'),
      provider: contextString(context, 'provider'),
      maxToolRounds: typeof context?.extra?.maxToolRounds === 'number' ? context.extra.maxToolRounds : undefined,
    });
    const runtime: CompanionRuntimeEvidence = {
      ...(settings.theme ? { theme: settings.theme.active } : {}),
      ...(contextString(context, 'model') ? { model: contextString(context, 'model') } : {}),
      ...(contextString(context, 'provider') ? { provider: contextString(context, 'provider') } : {}),
      ...(contextString(context, 'surface') ? { surface: contextString(context, 'surface') } : {}),
      ...(contextString(context, 'permissionMode')
        ? { permissionMode: contextString(context, 'permissionMode') }
        : {}),
      ...(toolNames ? { registeredToolNames: toolNames } : {}),
      ...(exposedToolNames ? { exposedToolNames } : {}),
    };

    const focus = typeof input.focus === 'string' ? input.focus : 'fonctionnement général';
    const depth: OperationalSelfDepth = input.depth === 'deep' ? 'deep' : 'summary';
    const core = resolveCodeBuddyCoreRoot(context?.cwd);
    const description = buildSelfDescription({
      coreResolution: core,
      toolNames,
      exposedToolNames,
      personaRobotName,
    });
    if (input.operation) {
      try {
        const { inspectCoreCode } = await import('../core-code-inspection.js');
        const inspection = inspectCoreCode(core, {
          operation: input.operation as 'list' | 'read' | 'search',
          path: typeof input.path === 'string' ? input.path : undefined,
          query: typeof input.query === 'string' ? input.query : undefined,
          line: typeof input.line === 'number' ? input.line : undefined,
          offset: typeof input.offset === 'number' ? input.offset : undefined,
        });
        return { success: true, output: JSON.stringify({ settings, inspection }), data: { settings, inspection } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    const operational = buildOperationalSelfModel({
      coreResolution: core,
      focus,
      depth,
      robotName: personaRobotName,
      runtime,
    });
    return {
      success: true,
      output: `${description.text}\n\n${operational.text}\n\nCurrent runtime settings: ${JSON.stringify(settings)}`,
      data: {
        settings,
        description: description as unknown as Record<string, unknown>,
        operational: operational as unknown as Record<string, unknown>,
      },
    };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: SELF_DESCRIBE_TOOL.function.parameters as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { valid: false, errors: ['input must be an object'] };
    }
    const value = input as Record<string, unknown>;
    if (value.focus !== undefined && (typeof value.focus !== 'string' || value.focus.length > 320)) {
      return { valid: false, errors: ['focus must be a string of at most 320 characters'] };
    }
    if (value.depth !== undefined && value.depth !== 'summary' && value.depth !== 'deep') {
      return { valid: false, errors: ['depth must be summary or deep'] };
    }
    if (value.operation !== undefined && !['list', 'read', 'search'].includes(String(value.operation))) {
      return { valid: false, errors: ['operation must be list, read or search'] };
    }
    for (const key of ['path', 'query']) {
      if (value[key] !== undefined && (typeof value[key] !== 'string' || (value[key] as string).length > 160)) {
        return { valid: false, errors: [`${key} must be a string of at most 160 characters`] };
      }
    }
    if (value.line !== undefined && (!Number.isSafeInteger(value.line) || Number(value.line) < 1)) {
      return { valid: false, errors: ['line must be a positive integer'] };
    }
    if (value.offset !== undefined && (!Number.isSafeInteger(value.offset) || Number(value.offset) < 0)) {
      return { valid: false, errors: ['offset must be a non-negative integer'] };
    }
    const unknown = Object.keys(value).filter((key) => !['focus', 'depth', 'operation', 'path', 'query', 'line', 'offset'].includes(key));
    if (unknown.length > 0) {
      return { valid: false, errors: [`unknown input field(s): ${unknown.join(', ')}`] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'file_read' as ToolCategoryType,
      keywords: [
        'self', 'describe', 'components', 'composants', 'briques', 'bricks', 'architecture',
        'de quoi es-tu fait', 'de quoi es-tu compose', 'qui es-tu', 'capabilities', 'capacites',
        'capteur', 'capteurs', 'sensors', 'modules', 'introspection', 'auto inspection',
        'etudie', 'examine', 'inspecte',
        'propre code', 'ton code', 'fonctionne', 'fonctionnes', 'fonctionnement',
        'limites', 'version', 'conscient', 'consciente', 'conscience', 'consciousness',
        'modele de soi',
      ],
      priority: 50,
      modifiesFiles: false,
      makesNetworkRequests: false,
      requiresConfirmation: false,
      fleetSafe: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

/** Create the self-describe tool adapters. */
export function createSelfDescribeTools(): ITool[] {
  return [new SelfDescribeTool()];
}
