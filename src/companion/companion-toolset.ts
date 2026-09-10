/**
 * Companion Toolset definition, authorization and execution gates.
 *
 * Defines which tools Lisa can use based on the interlocutor's identity tier:
 * - 'owner': image_generate, image_edit, remind, web_search, weather, stock_quote,
 *            understand_video, camera_analyze, recall.
 * - 'present': same tools WITHOUT remind and WITHOUT camera (camera_analyze).
 * - 'guest': NO tools (fail-closed, byte-identical to historical turn).
 *
 * Hard security invariants:
 * - NEVER bash, shell_exec, file writing (create_file, edit, patch), MCP, fleet tools.
 * - Circuit-breaker: CODEBUDDY_COMPANION_TOOLS_ENABLED (default: false -> 0 tools).
 * - Surcharge: CODEBUDDY_COMPANION_TOOLS (csv list, filtered against hard constraints).
 *
 * @module companion/companion-toolset
 */

import path from 'path';
import type { CodeBuddyTool } from '../codebuddy/client.js';
import type { ToolResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { ConfirmationService } from '../utils/confirmation-service.js';
import { FormalToolRegistry } from '../tools/registry/tool-registry.js';
import type { CompanionIdentity } from './companion-identity.js';

export const OWNER_COMPANION_TOOLS: readonly string[] = Object.freeze([
  'image_generate',
  'image_edit',
  'remind',
  'web_search',
  'weather',
  'stock_quote',
  'understand_video',
  'camera_analyze',
  'recall',
]);

export const PRESENT_COMPANION_TOOLS: readonly string[] = Object.freeze([
  'image_generate',
  'image_edit',
  'web_search',
  'weather',
  'stock_quote',
  'understand_video',
  'recall',
]);

export const GUEST_COMPANION_TOOLS: readonly string[] = Object.freeze([]);

/** Strictly forbidden tool patterns that can NEVER be exposed to companion */
export const COMPANION_FORBIDDEN_PATTERNS: readonly (string | RegExp)[] = Object.freeze([
  // bash* family (bash, bash_exec, etc.)
  /^bash/i,
  'terminal',
  'interactive_shell',

  // shell* family (shell_exec, shell_git, shell_process, shell_docker, shell_k8s, etc.)
  /^shell/i,

  // *_exec family and code execution (code_exec, shell_exec, execute_code, etc.)
  /(?:^|_)exec(?:$|_)/i,
  /^execute_/i,
  'js_repl',

  // write_* family & file writing
  /^write_/i,
  /^file_write/i,
  'create_file',

  // patch family
  'patch',
  /^apply_patch/i,

  // str_replace* family (str_replace, str_replace_editor, etc.)
  /^str_replace/i,

  // multi_edit and edit_* family (file editing; does NOT match image_edit)
  'multi_edit',
  /^multi_edit/i,
  /^edit_/i,
  /^file_edit/i,

  // delete_* family
  /^delete_/i,

  // system / infra / process / code execution / app server
  'docker',
  'kubernetes',
  'process',
  /^process/i,
  'git',
  /^git_/i,
  'resolve_conflicts',
  'app_server',
  'computer_control',
  'office_macro_execute',
  'codebase_replace',
  'scaffold_app',
  'tool_search',
  'extension_forge',
  'scan_vulnerabilities',
  'env_doctor',
  'port_check',
  'lint_project',
  'test_runner',
  'format_project',
  'build_project',

  // A2A / MCP / orchestration / registration
  /^mcp_/i,
  /^fleet_/i,
  /^peer_/i,
  /^delegate_/i,
  /^register_tool/i,
  'register_tool',
]);

/**
 * Check if a tool is strictly forbidden for the companion.
 */
export function isForbiddenCompanionTool(toolName: string): boolean {
  const norm = toolName.trim().toLowerCase();
  for (const pattern of COMPANION_FORBIDDEN_PATTERNS) {
    if (typeof pattern === 'string') {
      if (norm === pattern.toLowerCase()) return true;
    } else if (pattern instanceof RegExp) {
      if (pattern.test(norm)) return true;
    }
  }
  return false;
}

/**
 * Check if companion tools are enabled via circuit-breaker.
 * Default is FALSE (OFF).
 */
export function isCompanionToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.CODEBUDDY_COMPANION_TOOLS_ENABLED ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/**
 * Resolve allowed tool names for a given identity and environment.
 */
export function getCompanionToolNames(
  identity: CompanionIdentity,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  // 1. Circuit breaker OFF -> zero tools
  if (!isCompanionToolsEnabled(env)) {
    return [];
  }

  // 2. Guest role -> zero tools (fail-closed)
  if (identity.role === 'guest') {
    return [];
  }

  // 3. Baseline per role
  const baseline: readonly string[] =
    identity.role === 'owner' ? OWNER_COMPANION_TOOLS : PRESENT_COMPANION_TOOLS;

  // 4. Surcharge via CODEBUDDY_COMPANION_TOOLS (CSV)
  // Hard invariant: CSV can ONLY INTERSECT the role's baseline tools, NEVER extend it.
  let allowed: string[];
  const configured = (env.CODEBUDDY_COMPANION_TOOLS ?? '').trim();
  if (configured) {
    const requested = new Set(
      configured
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );

    // Strict intersection with role baseline (order preserved from baseline)
    allowed = baseline.filter((tool) => {
      const match = requested.has(tool.toLowerCase());
      if (!match) return false;
      if (isForbiddenCompanionTool(tool)) {
        logger.warn(`[companion-toolset] Surcharge tool "${tool}" rejected: strictly forbidden`);
        return false;
      }
      return true;
    });
  } else {
    allowed = [...baseline];
  }

  // Final sanity filter: eliminate any forbidden tool that could have leaked
  return allowed.filter((tool) => !isForbiddenCompanionTool(tool));
}

/**
 * Human-friendly waiting phrase when a slow tool starts executing.
 */
export function getCompanionToolWaitingWord(toolName: string): string | null {
  switch (toolName) {
    case 'image_generate':
      return 'Je dessine…';
    case 'image_edit':
      return 'Je modifie l’image…';
    case 'camera_analyze':
    case 'camera_snapshot':
      return 'Je regarde…';
    case 'web_search':
      return 'Je cherche sur le web…';
    case 'weather':
      return 'Je regarde la météo…';
    case 'stock_quote':
      return 'Je vérifie les cours de bourse…';
    case 'understand_video':
      return 'J’analyse la vidéo…';
    case 'remind':
      return 'Je note ton rappel…';
    case 'recall':
      return 'Je vérifie dans mes souvenirs…';
    default:
      return null;
  }
}

/**
 * Get OpenAI-compatible function tool definitions for allowed companion tools.
 */
export async function getCompanionToolDefinitions(
  identity: CompanionIdentity,
  options: {
    env?: NodeJS.ProcessEnv;
    registry?: FormalToolRegistry;
  } = {},
): Promise<CodeBuddyTool[]> {
  const env = options.env ?? process.env;
  const toolNames = getCompanionToolNames(identity, env);
  if (toolNames.length === 0) return [];

  const registry = options.registry ?? FormalToolRegistry.getInstance();
  if (registry.getNames().length === 0) {
    const { registerBuiltinTools } = await import('../tools/registry/index.js');
    registerBuiltinTools(registry);
  }

  const definitions: CodeBuddyTool[] = [];
  for (const name of toolNames) {
    const registered = registry.get(name);
    if (!registered) {
      continue;
    }
    const schema = registered.tool.getSchema();
    definitions.push({
      type: 'function',
      function: {
        name: schema.name,
        description: schema.description,
        parameters: {
          type: 'object',
          properties: (schema.parameters?.properties as Record<string, import('../codebuddy/client.js').JsonSchemaProperty>) ?? {},
          required: schema.parameters?.required ?? [],
          ...(schema.parameters?.additionalProperties !== undefined
            ? { additionalProperties: schema.parameters.additionalProperties }
            : {}),
        },
      },
    });
  }

  return definitions;
}

export interface CompanionToolExecutionContext {
  identity: CompanionIdentity;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  signal?: AbortSignal;
  registry?: FormalToolRegistry;
  confirmationService?: ConfirmationService;
}

/**
 * Safely execute a companion tool call.
 */
export async function executeCompanionTool(
  toolName: string,
  args: Record<string, unknown>,
  context: CompanionToolExecutionContext,
): Promise<ToolResult> {
  const env = context.env ?? process.env;

  // 1. Hard invariant: forbidden tool
  if (isForbiddenCompanionTool(toolName)) {
    const err = `Tool "${toolName}" is strictly forbidden in companion mode.`;
    logger.warn(`[companion-toolset] ${err}`);
    return { success: false, error: err };
  }

  // 2. Authorization check against identity role
  const allowedNames = getCompanionToolNames(context.identity, env);
  if (!allowedNames.includes(toolName)) {
    const err = `Tool "${toolName}" is not permitted for companion identity role "${context.identity.role}".`;
    logger.warn(`[companion-toolset] ${err}`);
    return { success: false, error: err };
  }

  // 3. Confirmation gate:
  // Destructive tools are blocked by isForbiddenCompanionTool.
  // For permitted companion read/generation tools, validate against policy engine kill-switch
  // and honor any explicit confirmationService passed in context.
  if (context.confirmationService) {
    const confirmationRes = await context.confirmationService.requestConfirmation(
      {
        operation: `companion:${toolName}`,
        filename: toolName,
        toolName,
        toolArgs: args,
        showVSCodeOpen: false,
        content: `Companion tool: ${toolName}\nArguments:\n${JSON.stringify(args, null, 2)}`,
      },
      'tool',
    );
    if (!confirmationRes.confirmed) {
      return {
        success: false,
        error: confirmationRes.feedback ?? `Execution of "${toolName}" was rejected by confirmation policy.`,
      };
    }
  } else {
    const { PolicyEngine } = await import('../security/policy-engine.js');
    if (PolicyEngine.getInstance().isKilled()) {
      return {
        success: false,
        error: `Security kill-switch active: ${PolicyEngine.getInstance().getKillReason()}`,
      };
    }
  }

  // 4. Retrieve tool from registry
  const registry = context.registry ?? FormalToolRegistry.getInstance();
  if (registry.getNames().length === 0) {
    const { registerBuiltinTools } = await import('../tools/registry/index.js');
    registerBuiltinTools(registry);
  }

  const registered = registry.get(toolName);
  if (!registered) {
    return {
      success: false,
      error: `Companion tool "${toolName}" is not registered in the tool registry.`,
    };
  }

  // 5. Execute
  try {
    return await registered.tool.execute(args, {
      cwd: context.cwd ?? process.cwd(),
      abortSignal: context.signal,
    });
  } catch (execError) {
    const msg = execError instanceof Error ? execError.message : String(execError);
    logger.warn(`[companion-toolset] Error executing tool "${toolName}": ${msg}`);
    return {
      success: false,
      error: `Tool execution error: ${msg}`,
    };
  }
}

/**
 * Extract image path from tool execution result if one was created/returned.
 */
export function extractImagePathFromToolResult(
  result: ToolResult,
  cwd: string = process.cwd(),
): string | undefined {
  if (!result || !result.success) return undefined;

  const isImagePath = (val: unknown): val is string => {
    if (typeof val !== 'string' || !val.trim()) return false;
    const clean = val.trim();
    return /\.(png|jpe?g|webp)$/i.test(clean);
  };

  const toAbs = (filePath: string): string => {
    return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  };

  const data = result.data as Record<string, unknown> | undefined;
  if (data && typeof data === 'object') {
    if (isImagePath(data.mediaPath)) return toAbs(data.mediaPath);
    if (isImagePath(data.imagePath)) return toAbs(data.imagePath);
    if (isImagePath(data.outputPath)) return toAbs(data.outputPath);
    if (isImagePath(data.path)) return toAbs(data.path);
    if (isImagePath(data.image)) return toAbs(data.image);
    if (Array.isArray(data.images) && isImagePath(data.images[0]?.path)) {
      return toAbs(data.images[0].path);
    }
  }

  // Fallback: check output string if JSON
  if (typeof result.output === 'string') {
    try {
      const parsed = JSON.parse(result.output) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        if (isImagePath(parsed.mediaPath)) return toAbs(parsed.mediaPath);
        if (isImagePath(parsed.imagePath)) return toAbs(parsed.imagePath);
        if (isImagePath(parsed.outputPath)) return toAbs(parsed.outputPath);
        if (isImagePath(parsed.path)) return toAbs(parsed.path);
        if (isImagePath(parsed.image)) return toAbs(parsed.image);
      }
    } catch {
      // not JSON
    }
    // search for absolute image path in output
    const match = result.output.match(/(?:^|[\s"'`])(\/[^\s"'`]+\.(?:png|jpe?g|webp))/i);
    if (match && match[1]) {
      return match[1];
    }
  }

  return undefined;
}
