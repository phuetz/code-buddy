/**
 * MCP Agent Tools - Expose Code Buddy's AI reasoning capabilities
 *
 * Tools:
 * - agent_chat: Send message to agent, get response
 * - agent_task: Autonomous task execution
 * - agent_plan: Create plan without executing
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ChatEntry } from '../agent/types.js';

type AgentGetter = () => Promise<import('../agent/codebuddy-agent.js').CodeBuddyAgent>;

/**
 * Promise-based queue lock to serialize agent calls (agent is not thread-safe).
 */
let agentLock: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = agentLock.then(fn, fn);
  agentLock = result.then(() => {}, () => {});
  return result;
}

/**
 * Format ChatEntry[] into readable text for MCP responses.
 */
export function formatAgentResponse(entries: ChatEntry[]): string {
  const parts: string[] = [];

  for (const entry of entries) {
    switch (entry.type) {
      case 'assistant':
        if (entry.content) parts.push(entry.content);
        break;
      case 'tool_call':
        if (entry.toolCall) {
          parts.push(`[Tool Call: ${entry.toolCall.function?.name || 'unknown'}]`);
        }
        break;
      case 'tool_result':
        if (entry.toolResult) {
          const status = entry.toolResult.success ? 'Success' : 'Error';
          const output = entry.toolResult.output || entry.toolResult.error || '';
          if (output) {
            parts.push(`[Tool Result: ${status}]\n${output}`);
          }
        }
        break;
      case 'reasoning':
        if (entry.content) parts.push(`[Reasoning] ${entry.content}`);
        break;
      case 'plan_progress':
        if (entry.content) parts.push(`[Plan Progress] ${entry.content}`);
        break;
    }
  }

  const response = parts.join('\n\n').trim();
  if (!response) {
    throw new Error('Agent returned no response content.');
  }
  return response;
}

/**
 * Register agent intelligence tools with the MCP server.
 */
export function registerAgentTools(server: McpServer, getAgent: AgentGetter): void {
  // agent_chat - Send message to agent, get response
  server.tool(
    'agent_chat',
    'Send a message to the Code Buddy AI agent and get a response with tool call results. Use for conversational interactions.',
    {
      message: z.string().describe('The message to send to the agent'),
      mode: z.enum(['code', 'ask', 'plan', 'architect']).optional()
        .describe('Agent mode: code (default), ask (no tools), plan (planning only), architect (design)'),
    },
    async (args) => {
      try {
        return await withLock(async () => {
          const agent = await getAgent();
          if (args.mode) {
            (agent as unknown as Record<string, unknown>).agentMode = args.mode;
          }
          const entries = await agent.processUserMessage(args.message);
          return {
            content: [{ type: 'text' as const, text: formatAgentResponse(entries) }],
          };
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Agent chat error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // agent_task - Autonomous task execution
  server.tool(
    'agent_task',
    'Execute an autonomous task using Code Buddy agent. For complex tasks, uses DAG-based planning; for simple tasks, processes directly. Returns all tool calls and results.',
    {
      task: z.string().describe('The task to execute autonomously'),
      working_directory: z.string().optional()
        .describe('Working directory for task execution (defaults to cwd)'),
    },
    async (args) => {
      try {
        return await withLock(async () => {
          const agent = await getAgent();
          if (args.working_directory) {
            process.chdir(args.working_directory);
          }

          let entries: ChatEntry[];
          if (agent.needsOrchestration(args.task)) {
            entries = await agent.executePlan(args.task);
          } else {
            entries = await agent.processUserMessage(args.task);
          }

          return {
            content: [{ type: 'text' as const, text: formatAgentResponse(entries) }],
          };
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Agent task error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // agent_plan - Create plan without executing
  server.tool(
    'agent_plan',
    'Create an execution plan for a task without executing it. Returns the DAG-based task plan with dependencies.',
    {
      task: z.string().describe('The task to plan'),
    },
    async (args) => {
      try {
        return await withLock(async () => {
          const agent = await getAgent();
          // Set plan mode so agent creates plan without executing
          (agent as unknown as Record<string, unknown>).agentMode = 'plan';
          const entries = await agent.processUserMessage(args.task);
          return {
            content: [{ type: 'text' as const, text: formatAgentResponse(entries) }],
          };
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Agent plan error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
