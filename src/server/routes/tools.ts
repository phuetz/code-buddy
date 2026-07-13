/**
 * Tools Routes
 *
 * Handles tool listing and execution API endpoints.
 */

import { Router, Request, Response } from 'express';
import {
  requireScope,
  requireLocalAnonymousAccess,
  asyncHandler,
  ApiServerError,
} from '../middleware/index.js';
import type { ToolExecutionRequest, ToolExecutionResponse, ToolInfo } from '../types.js';
import { createServerAgent, type ServerAgent } from '../agent-adapter.js';
import { WRITE_TOOL_NAMES } from '../../security/write-policy.js';
import { getPolicyManager } from '../../security/tool-policy/policy-manager.js';
import { getToolGroups } from '../../security/tool-policy/tool-groups.js';

// CodeBuddyTool shape from registry (OpenAI function-calling format)
interface CodeBuddyToolShape {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface RegisteredToolShape {
  definition: CodeBuddyToolShape;
  metadata: { category?: string };
  isEnabled(): boolean;
}

interface ToolRegistryAPI {
  getAllTools(): CodeBuddyToolShape[];
  getTool(name: string): RegisteredToolShape | undefined;
}

/** Extract flat info from nested CodeBuddyTool shape */
function toToolInfo(tool: RegisteredToolShape): ToolInfo {
  const definition = tool.definition;
  const name = definition.function.name;
  const policyDecision = getPolicyManager().checkTool(name);
  return {
    name,
    description: definition.function.description || '',
    category: tool.metadata.category || 'general',
    parameters: definition.function.parameters || {},
    // REST has no interactive callback. Require an explicit `confirmed:true`
    // for all known write tools as well as tools the active policy marks confirm.
    requiresConfirmation:
      WRITE_TOOL_NAMES.has(name) || policyDecision.action === 'confirm',
    isDestructive: getToolGroups(name).includes('group:dangerous'),
  };
}

function enabledTool(registry: ToolRegistryAPI, name: string): RegisteredToolShape | undefined {
  const tool = registry.getTool(name);
  return tool?.isEnabled() ? tool : undefined;
}

// Lazy load the tool registry
let toolRegistryInstance: ToolRegistryAPI | null = null;
async function getToolRegistry(): Promise<ToolRegistryAPI> {
  if (!toolRegistryInstance) {
    const { initializeToolRegistry } = await import('../../codebuddy/tools.js');
    const { ToolRegistry } = await import('../../tools/registry.js');
    initializeToolRegistry();
    toolRegistryInstance = ToolRegistry.getInstance() as unknown as ToolRegistryAPI;
  }
  return toolRegistryInstance!;
}

// Lazy load the agent for tool execution
let agentInstance: ServerAgent | null = null;
async function getAgent(): Promise<ServerAgent> {
  if (!agentInstance) {
    agentInstance = await createServerAgent();
  }
  return agentInstance!;
}

const router = Router();

// `--no-auth` is useful for a loopback-only robot stack, but must never turn a
// network bind into an anonymous remote-code/file API. This gate covers list,
// single execution, and batch execution before any registry is initialized.
router.use(requireLocalAnonymousAccess);

/**
 * GET /api/tools
 * List all available tools
 */
router.get(
  '/',
  requireScope('tools'),
  asyncHandler(async (req: Request, res: Response) => {
    const registry = await getToolRegistry();
    const toolInfos: ToolInfo[] = registry
      .getAllTools()
      .map((definition) => enabledTool(registry, definition.function.name))
      .filter((tool): tool is RegisteredToolShape => Boolean(tool))
      .map(toToolInfo);

    res.json({
      tools: toolInfos,
      total: toolInfos.length,
    });
  })
);

/**
 * GET /api/tools/categories
 * List tool categories
 * NOTE: Must be registered before /:name to avoid route shadowing
 */
router.get(
  '/categories',
  requireScope('tools'),
  asyncHandler(async (req: Request, res: Response) => {
    const registry = await getToolRegistry();
    const tools = registry
      .getAllTools()
      .filter((definition) => enabledTool(registry, definition.function.name));

    const categories = new Map<string, number>();
    categories.set('general', tools.length);

    res.json({
      categories: Object.fromEntries(categories),
    });
  })
);

/**
 * GET /api/tools/:name
 * Get details for a specific tool
 */
router.get(
  '/:name',
  requireScope('tools'),
  asyncHandler(async (req: Request, res: Response) => {
    const name = req.params.name as string;
    const registry = await getToolRegistry();
    const tool = enabledTool(registry, name);

    if (!tool) {
      throw ApiServerError.notFound(`Tool '${name}'`);
    }

    res.json(toToolInfo(tool));
  })
);

/**
 * POST /api/tools/:name/execute
 * Execute a specific tool
 */
router.post(
  '/:name/execute',
  requireScope('tools:execute'),
  asyncHandler(async (req: Request, res: Response) => {
    const startTime = Date.now();
    const name = req.params.name as string;
    const body = req.body as ToolExecutionRequest;

    // Require tools:execute scope or admin
    if (!req.auth?.scopes.includes('tools:execute') && !req.auth?.scopes.includes('admin')) {
      throw ApiServerError.forbidden('Tool execution requires tools:execute scope');
    }

    const registry = await getToolRegistry();
    const tool = enabledTool(registry, name);

    if (!tool) {
      throw ApiServerError.notFound(`Tool '${name}'`);
    }

    // Check if tool requires confirmation and it wasn't provided
    if (toToolInfo(tool).requiresConfirmation && !body.confirmed) {
      res.status(200).json({
        toolName: name,
        success: false,
        requiresConfirmation: true,
        confirmationMessage: `Tool '${name}' requires confirmation. Set confirmed=true to execute.`,
        executionTime: Date.now() - startTime,
      });
      return;
    }

    try {
      const agent = await getAgent();
      const result = await agent.executeToolByName(name, body.parameters || {});

      const response: ToolExecutionResponse = {
        toolName: name,
        success: result.success,
        output: result.output,
        error: result.error,
        executionTime: Date.now() - startTime,
      };

      res.json(response);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const response: ToolExecutionResponse = {
        toolName: name,
        success: false,
        error: message,
        executionTime: Date.now() - startTime,
      };

      res.status(500).json(response);
    }
  })
);

/**
 * POST /api/tools/batch
 * Execute multiple tools in sequence
 */
router.post(
  '/batch',
  requireScope('tools:execute'),
  asyncHandler(async (req: Request, res: Response) => {
    const startTime = Date.now();
    const { tools } = req.body as { tools: Array<{ name: string; parameters: Record<string, unknown> }> };

    if (!Array.isArray(tools) || tools.length === 0) {
      throw ApiServerError.badRequest('Tools must be a non-empty array');
    }

    if (tools.length > 10) {
      throw ApiServerError.badRequest('Maximum 10 tools per batch');
    }

    const registry = await getToolRegistry();
    const agent = await getAgent();
    const results: ToolExecutionResponse[] = [];

    for (const toolRequest of tools) {
      const toolStartTime = Date.now();

      const tool = enabledTool(registry, toolRequest.name);
      if (!tool) {
        results.push({
          toolName: toolRequest.name,
          success: false,
          error: `Tool '${toolRequest.name}' not found`,
          executionTime: Date.now() - toolStartTime,
        });
        continue;
      }

      // Batch cannot present an interactive confirmation prompt.
      if (toToolInfo(tool).requiresConfirmation) {
        results.push({
          toolName: toolRequest.name,
          success: false,
          error: 'Tool requires confirmation and cannot be executed in batch mode',
          requiresConfirmation: true,
          executionTime: Date.now() - toolStartTime,
        });
        continue;
      }

      try {
        const result = await agent.executeToolByName(toolRequest.name, toolRequest.parameters || {});
        results.push({
          toolName: toolRequest.name,
          success: result.success,
          output: result.output,
          error: result.error,
          executionTime: Date.now() - toolStartTime,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          toolName: toolRequest.name,
          success: false,
          error: message,
          executionTime: Date.now() - toolStartTime,
        });
      }
    }

    res.json({
      results,
      totalExecutionTime: Date.now() - startTime,
      successCount: results.filter((r) => r.success).length,
      failureCount: results.filter((r) => !r.success).length,
    });
  })
);

export default router;
