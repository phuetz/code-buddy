import { getToolWorkingDirectory } from '../utils/tool-execution-context.js';
/**
 * register_tool — lets Code Buddy author a NEW tool for itself at runtime.
 *
 * This is the "the code it builds can call its own tools" capability. On a
 * passing static safety scan it writes BOTH tool registries (via LiveToolMutator):
 *   - FormalToolRegistry  → the authored tool is immediately CALLABLE (dispatch),
 *   - legacy ToolRegistry → its schema becomes VISIBLE to the model next turn.
 *
 * Authored tools are namespaced `authored__<name>` and run SANDBOXED. Gated
 * overall by `CODEBUDDY_SELF_IMPROVE=true` at the registration site (tools.ts).
 *
 * The static scan here is the same G1 used by the self-improvement engine
 * (authored-artifact-gate). The fuller behavioural held-out gate (which proves a
 * tool actually works on fresh inputs) is applied by the engine's tool-gate when
 * a tool is proposed as a self-improvement against a benchmark scenario.
 */

import type { ITool, IToolExecutionContext, ToolSchema } from './registry/types.js';
import type { ToolResult } from '../types/index.js';
import {
  AUTHORED_LANGUAGES,
  toAuthoredName,
  type AuthoredToolSpec,
} from '../agent/self-improvement/authored-tool-runtime.js';
import { inspectAuthoredCode } from '../agent/self-improvement/authored-artifact-gate.js';
import { AuthoredToolStore } from '../agent/self-improvement/authored-tool-store.js';
import { LiveToolMutator } from '../agent/self-improvement/tool-skill-mutator.js';
import type { ExecuteCodeLanguage } from './execute-code-runner.js';
import { logger } from '../utils/logger.js';

export class RegisterToolTool implements ITool {
  readonly name = 'register_tool';
  readonly description =
    'Author a NEW tool for yourself at runtime. Provide a name, description, JSON-schema params, ' +
    'a language (javascript|typescript|python) and the code. The code reads its call arguments as ' +
    'JSON from the CODEBUDDY_TOOL_INPUT env var and prints its result to stdout. On a passing safety ' +
    'check the tool is registered as `authored__<name>` and becomes callable in the same conversation.';

  async execute(
    input: Record<string, unknown>,
    context?: IToolExecutionContext,
  ): Promise<ToolResult> {
    const rawName = String(input.name ?? '').trim();
    const description = String(input.description ?? '').trim();
    const language = String(input.language ?? 'javascript').toLowerCase() as ExecuteCodeLanguage;
    const code = typeof input.code === 'string' ? input.code : '';
    const parameters =
      input.params && typeof input.params === 'object'
        ? (input.params as Record<string, unknown>)
        : { type: 'object', properties: {} };

    if (!rawName) return { success: false, error: 'register_tool: `name` is required.' };
    if (!description) return { success: false, error: 'register_tool: `description` is required.' };
    if (!code.trim()) return { success: false, error: 'register_tool: `code` is required.' };
    if (!AUTHORED_LANGUAGES.includes(language)) {
      return { success: false, error: `register_tool: language must be one of ${AUTHORED_LANGUAGES.join(', ')}.` };
    }

    // Static safety scan (engine G1): dangerous patterns, secrets, no-src/-write, omissions.
    const scan = inspectAuthoredCode(code, 'code');
    if (!scan.ok) {
      return { success: false, error: `register_tool: refused — ${scan.reasons.join('; ')}.` };
    }

    const spec: AuthoredToolSpec = {
      name: toAuthoredName(rawName),
      description,
      parameters,
      language,
      code,
    };

    try {
      const store = new AuthoredToolStore({ workDir: context?.cwd ?? getToolWorkingDirectory() });
      new LiveToolMutator({ store }).register(spec);
    } catch (err) {
      return {
        success: false,
        error: `register_tool: registration failed — ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    logger.info(`[self-improve] authored tool registered: ${spec.name}`);
    return {
      success: true,
      output:
        `Registered tool \`${spec.name}\`. It is now callable in this conversation — ` +
        `call it with arguments matching its params.`,
      data: { artifactKind: 'tool', name: spec.name, createdTools: [spec.name] },
    };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Tool name (namespaced to authored__<name>)' },
          description: { type: 'string', description: 'What the tool does and when to use it' },
          params: { type: 'object', description: 'JSON Schema for the tool arguments' },
          language: {
            type: 'string',
            enum: ['javascript', 'typescript', 'python'],
            description: 'Implementation language (default javascript)',
          },
          code: {
            type: 'string',
            description: 'Code that reads its args as JSON from env CODEBUDDY_TOOL_INPUT and prints its result to stdout',
          },
        },
        required: ['name', 'description', 'code'],
      },
    };
  }
}

export function createRegisterToolTool(): RegisterToolTool {
  return new RegisterToolTool();
}
