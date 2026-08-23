/**
 * MCP Session & Web Search Tools
 *
 * Tools:
 * - session_list: List recent sessions
 * - session_resume: Resume a previous session
 * - web_search: Search the web
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

type AgentGetter = () => Promise<import('../agent/codebuddy-agent.js').CodeBuddyAgent>;

/**
 * Register session and web search tools with the MCP server.
 */
export function registerSessionTools(
  server: McpServer,
  getAgent: AgentGetter,
  shouldRegister: (name: string) => boolean = () => true,
): void {
  // session_list - List recent sessions
  if (shouldRegister('session_list')) server.tool(
    'session_list',
    'List recent Code Buddy chat sessions with their IDs, names, and timestamps.',
    {
      count: z.number().optional().describe('Number of recent sessions to return (default: 10)'),
    },
    async (args) => {
      try {
        const { getSessionStore } = await import('../persistence/session-store.js');
        const store = getSessionStore();
        const sessions = await store.getRecentSessions(args.count ?? 10);

        if (sessions.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No sessions found.' }],
          };
        }

        const formatted = sessions.map(s => {
          const msgCount = s.messages?.length ?? 0;
          const date = new Date(s.lastAccessedAt || s.createdAt).toISOString();
          return `- **${s.name || s.id}** (${s.id})\n  Model: ${s.model || 'default'} | Messages: ${msgCount} | Last active: ${date}`;
        }).join('\n');

        return {
          content: [{ type: 'text' as const, text: `## Recent Sessions\n\n${formatted}` }],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Session list error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // session_resume - Resume a previous session
  if (shouldRegister('session_resume')) server.tool(
    'session_resume',
    'Resume a previous Code Buddy session by ID, restoring its chat history and context.',
    {
      session_id: z.string().describe('The session ID to resume'),
    },
    async (args) => {
      try {
        const { getSessionStore } = await import('../persistence/session-store.js');
        const store = getSessionStore();
        const session = await store.loadSession(args.session_id);

        if (!session) {
          return {
            content: [{ type: 'text' as const, text: `Session not found: ${args.session_id}` }],
            isError: true,
          };
        }

        const msgCount = session.messages?.length ?? 0;
        const summary = [
          `## Resumed Session: ${session.name || session.id}`,
          `- **ID:** ${session.id}`,
          `- **Model:** ${session.model || 'default'}`,
          `- **Working Directory:** ${session.workingDirectory}`,
          `- **Messages:** ${msgCount}`,
          `- **Created:** ${new Date(session.createdAt).toISOString()}`,
        ].join('\n');

        // Show last few messages as context
        const recentMessages = (session.messages || []).slice(-5).map(m => {
          const role = m.type === 'user' ? 'User' : m.type === 'assistant' ? 'Assistant' : m.type;
          const content = m.content.length > 200 ? m.content.slice(0, 200) + '...' : m.content;
          return `**${role}:** ${content}`;
        }).join('\n\n');

        return {
          content: [{
            type: 'text' as const,
            text: `${summary}\n\n### Recent Messages\n\n${recentMessages || 'No messages yet.'}`,
          }],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Session resume error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // web_search - Search the web
  if (shouldRegister('web_search')) server.tool(
    'web_search',
    'Search the web using Code Buddy\'s configured search providers (Brave, Perplexity, DuckDuckGo, etc.).',
    {
      query: z.string().describe('The search query'),
      max_results: z.number().optional().describe('Maximum results to return (default: 5)'),
      provider: z.enum(['brave', 'perplexity', 'serper', 'duckduckgo', 'brave-mcp']).optional()
        .describe('Force a specific search provider'),
    },
    async (args) => {
      try {
        const { WebSearchTool } = await import('../tools/web-search.js');
        const searchTool = new WebSearchTool();
        const result = await searchTool.search(args.query, {
          maxResults: args.max_results ?? 5,
          provider: args.provider as 'brave' | 'perplexity' | 'serper' | 'duckduckgo' | 'brave-mcp' | undefined,
        });

        return {
          content: [{ type: 'text' as const, text: result.output || result.error || 'No results' }],
          isError: !result.success,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Web search error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
