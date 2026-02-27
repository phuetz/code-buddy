/**
 * Tools Routes
 *
 * Handles tool listing and execution API endpoints.
 */

import { Router, Request, Response } from 'express';
import { requireScope, asyncHandler, ApiServerError } from '../middleware/index.js';
import type { ToolExecutionRequest, ToolExecutionResponse, ToolInfo } from '../types.js';

// CodeBuddyTool shape from registry (OpenAI function-calling format)
interface CodeBuddyToolShape {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ToolRegistryAPI {
  getAllTools(): CodeBuddyToolShape[];
  getTool(name: string): CodeBuddyToolShape | undefined;
}

/** Extract flat info from nested CodeBuddyTool shape */
function toToolInfo(tool: CodeBuddyToolShape): ToolInfo {
  return {
    name: tool.function.name,
    description: tool.function.description || '',
    category: 'general',
    parameters: tool.function.parameters || {},
    requiresConfirmation: false,
    isDestructive: false,
  };
}

interface AgentAPI {
  executeTool(name: string, params: Record<string, unknown>): Promise<{
    success: boolean;
    output?: string;
    error?: string;
  }>;
}

// Lazy load the tool registry
let toolRegistryInstance: ToolRegistryAPI | null = null;
async function getToolRegistry(): Promise<ToolRegistryAPI> {
  if (!toolRegistryInstance) {
    const { ToolRegistry } = await import('../../tools/registry.js');
    toolRegistryInstance = ToolRegistry.getInstance() as unknown as ToolRegistryAPI;
  }
  return toolRegistryInstance!;
}

// Lazy load the agent for tool execution
let agentInstance: AgentAPI | null = null;
async function getAgent(): Promise<AgentAPI> {
  if (!agentInstance) {
    const { CodeBuddyAgent } = await import('../../agent/codebuddy-agent.js');
    agentInstance = new CodeBuddyAgent(
      process.env.GROK_API_KEY || '',
      process.env.GROK_BASE_URL,
      process.env.GROK_MODEL || 'grok-3-latest'
    ) as unknown as AgentAPI;
  }
  return agentInstance!;
}

const router = Router();

/**
 * GET /api/tools
 * List all available tools
 */
router.get(
  '/',
  requireScope('tools'),
  asyncHandler(async (req: Request, res: Response) => {
    const registry = await getToolRegistry();
    const tools = registry.getAllTools();

    const toolInfos: ToolInfo[] = tools.map(toToolInfo);

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
    const tools = registry.getAllTools();

    const categories = new Map<string, number>();
    for (const tool of tools) {
      const category = 'general';
      categories.set(category, (categories.get(category) || 0) + 1);
    }

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
    const tool = registry.getTool(name);

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
    const tool = registry.getTool(name);

    if (!tool) {
      throw ApiServerError.notFound(`Tool '${name}'`);
    }

    // Check if tool requires confirmation and it wasn't provided
    if ((tool as any).requiresConfirmation && !body.confirmed) {
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
      const result = await agent.executeTool(name, body.parameters || {});

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

      const tool = registry.getTool(toolRequest.name);
      if (!tool) {
        results.push({
          toolName: toolRequest.name,
          success: false,
          error: `Tool '${toolRequest.name}' not found`,
          executionTime: Date.now() - toolStartTime,
        });
        continue;
      }

      // Skip tools requiring confirmation in batch mode
      // Note: CodeBuddyTool doesn't carry requiresConfirmation; skip for now
      if (false) {
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
        const result = await agent.executeTool(toolRequest.name, toolRequest.parameters || {});
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
