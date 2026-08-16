/**
 * MCP CKG Tools — expose the Collective Knowledge Graph to any MCP client.
 *
 * WHY THIS FILE EXISTS
 *
 * `mcp-memory-tools.ts` already exposes `memory_search`/`memory_save`, but those
 * reach the PER-SESSION persistent memory (`persistent-memory.ts`) — one agent's
 * notes. The Collective Knowledge Graph is a different thing: the SHARED,
 * cross-agent memory, with bi-temporal supersede, cross-agent corroboration (a
 * fact several independent agents assert gains confidence) and hybrid recall
 * (embeddings + keyword + salience + MMR, no LLM at retrieval time).
 *
 * Until now it had no MCP surface at all. Every fact the fleet had accumulated was
 * invisible to Claude Desktop, ChatGPT, or any other MCP client — the exact
 * "one memory shared between all your tools" promise, sitting behind no door.
 * These two tools are that door.
 *
 * Tools:
 * - ckg_recall: hybrid recall over the shared graph, corroboration included
 * - ckg_ingest: contribute a fact/lesson/decision/discovery to the shared graph
 *
 * NOT gated by CODEBUDDY_COLLECTIVE_MEMORY: that flag governs AUTOMATIC injection
 * into an agent's context, which must stay opt-in. An MCP tool is called
 * deliberately by the client — declaring it changes nothing until someone invokes
 * it, and an empty graph simply returns no results.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const ENTITY_TYPES = ['fact', 'lesson', 'decision', 'discovery'] as const;

/**
 * Register Collective Knowledge Graph tools with the MCP server.
 */
export function registerCkgTools(
  server: McpServer,
  shouldRegister: (name: string) => boolean = () => true,
): void {
  // ckg_recall - hybrid recall over the shared, cross-agent graph
  if (shouldRegister('ckg_recall')) server.tool(
    'ckg_recall',
    "Recall from the Collective Knowledge Graph — the memory SHARED across every agent and tool, "
      + "as opposed to one session's private notes. Results carry how many DISTINCT agents "
      + 'independently asserted each fact (corroboration), which is the signal to trust.',
    {
      query: z.string().describe('What you want to remember'),
      limit: z.number().optional().describe('Maximum results (default: 8)'),
      types: z.array(z.enum(ENTITY_TYPES)).optional()
        .describe('Restrict to these node types (default: all)'),
    },
    async (args) => {
      try {
        const { getCollectiveKnowledgeGraph } = await import('../memory/collective-knowledge-graph.js');
        const ckg = getCollectiveKnowledgeGraph();
        const results = await ckg.recallHybrid(args.query, {
          limit: args.limit ?? 8,
          ...(args.types ? { types: [...args.types] } : {}),
        });

        if (results.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'Nothing in the collective graph matches that query.' }],
          };
        }

        const formatted = results.map((r, i) => {
          // Corroboration is the whole point of a COLLECTIVE graph, so it is stated
          // first and in plain words — "3 agents" means three independent sources
          // reached the same conclusion, which is not the same as one agent
          // repeating itself three times.
          const trust = r.corroborations > 1
            ? `corroborated by ${r.corroborations} independent agents`
            : 'asserted by a single agent';
          return [
            `## ${i + 1}. ${r.name} — ${r.type}`,
            `**Trust:** ${trust} · confidence ${r.confidence.toFixed(2)} · salience ${r.salience.toFixed(2)}`,
            r.agentId ? `**From:** ${r.agentId}${r.source ? ` (${r.source})` : ''}` : '',
            '',
            r.text,
          ].filter(Boolean).join('\n');
        }).join('\n\n---\n\n');

        return {
          content: [{ type: 'text' as const, text: formatted }],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `CKG recall error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ckg_ingest - contribute to the shared graph
  if (shouldRegister('ckg_ingest')) server.tool(
    'ckg_ingest',
    'Contribute a fact, lesson, decision or discovery to the Collective Knowledge Graph, so that '
      + 'every other agent and tool can recall it. Re-stating an existing fact under the same name '
      + 'supersedes it bi-temporally; the same fact from a different agent raises its confidence.',
    {
      text: z.string().describe('The statement to remember, self-contained enough to be useful out of context'),
      type: z.enum(ENTITY_TYPES).optional().describe('Node type (default: fact)'),
      name: z.string().optional()
        .describe('Stable key. Same name + new text = the fact CHANGED (bi-temporal supersede). Omit to derive from the text, which dedups identical statements.'),
      source: z.string().optional().describe("Where this came from: 'chat', 'council', 'worklog', a URL…"),
      agent_id: z.string().optional().describe('Contributing agent, as <host>/<repo>. Defaults to this fleet agent.'),
    },
    async (args) => {
      try {
        const { getCollectiveKnowledgeGraph } = await import('../memory/collective-knowledge-graph.js');
        const ckg = getCollectiveKnowledgeGraph();
        const node = await ckg.ingest({
          text: args.text,
          ...(args.type ? { type: args.type } : {}),
          ...(args.name ? { name: args.name } : {}),
          ...(args.source ? { source: args.source } : {}),
          ...(args.agent_id ? { agentId: args.agent_id } : {}),
        });

        const label = node
          ? `Ingested "${node.name}" (${node.type}) — corroborations: ${node.corroborations}, confidence: ${node.confidence.toFixed(2)}`
          : 'Ingested.';
        return {
          content: [{ type: 'text' as const, text: label }],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `CKG ingest error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
