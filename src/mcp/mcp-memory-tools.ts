/**
 * MCP Memory Tools - Expose Code Buddy's memory system
 *
 * Tools:
 * - memory_search: Search semantic memory
 * - memory_save: Save a memory entry
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Register memory tools with the MCP server.
 */
export function registerMemoryTools(
  server: McpServer,
  shouldRegister: (name: string) => boolean = () => true,
): void {
  // memory_search - Search semantic memory
  if (shouldRegister('memory_search')) server.tool(
    'memory_search',
    'Search Code Buddy\'s semantic memory for relevant stored knowledge, patterns, and context.',
    {
      query: z.string().describe('The search query to find relevant memories'),
      max_results: z.number().optional().describe('Maximum results to return (default: 5)'),
    },
    async (args) => {
      try {
        const { searchAndRetrieve } = await import('../memory/semantic-memory-search.js');
        const results = await searchAndRetrieve(args.query, {
          maxResults: args.max_results ?? 5,
        });

        if (results.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No matching memories found.' }],
          };
        }

        const formatted = results.map((r, i) => {
          const { result, content } = r;
          return [
            `## Result ${i + 1} (score: ${result.score.toFixed(2)})`,
            `**Source:** ${result.entry.metadata?.source || 'unknown'}`,
            `**Snippet:** ${result.snippet}`,
            content ? `**Content:**\n${content}` : '',
          ].filter(Boolean).join('\n');
        }).join('\n\n---\n\n');

        return {
          content: [{ type: 'text' as const, text: formatted }],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Memory search error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // memory_save - Save a memory entry
  if (shouldRegister('memory_save')) server.tool(
    'memory_save',
    'Save a piece of knowledge to Code Buddy\'s persistent memory for future reference.',
    {
      key: z.string().describe('A short key/name for the memory entry'),
      value: z.string().describe('The content to remember'),
      category: z.enum(['project', 'preferences', 'decisions', 'patterns', 'context', 'custom']).optional()
        .describe('Memory category (default: context)'),
      scope: z.enum(['project', 'user']).optional()
        .describe('Memory scope: project-specific or user-global (default: project)'),
    },
    async (args) => {
      try {
        const { getMemoryManager } = await import('../memory/persistent-memory.js');
        const manager = getMemoryManager();
        await manager.initialize();
        await manager.remember(args.key, args.value, {
          category: args.category as 'project' | 'preferences' | 'decisions' | 'patterns' | 'context' | 'custom' | undefined,
          scope: args.scope as 'project' | 'user' | undefined,
        });

        return {
          content: [{ type: 'text' as const, text: `Memory saved: "${args.key}" (${args.scope || 'project'} / ${args.category || 'context'})` }],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Memory save error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
