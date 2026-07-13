/**
 * Code Explorer client — a real, programmatic TS accessor to the Code Explorer / gitnexus
 * code-knowledge-graph, driving the live MCP path (`MCPManager.callTool`). This is the real
 * client, replacing the deleted empty placeholder and the dead HTTP `CodeExplorerTool`.
 *
 * Works regardless of which MCP server name is wired (`code-explorer` or `gitnexus`) via
 * `codeExplorerToolPrefix()`. Never-throws: returns '' (or null available()) when not connected
 * or on error, so callers degrade gracefully.
 *
 * @module plugins/code-explorer/code-explorer-client
 */

import { logger } from '../../utils/logger.js';

interface McpToolContent {
  type?: string;
  text?: string;
}
interface McpCallResult {
  content?: McpToolContent[];
  isError?: boolean;
}

/** Join the text parts of an MCP CallToolResult. */
function extractText(result: McpCallResult): string {
  if (!result?.content) return '';
  return result.content
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n')
    .trim();
}

export interface CodeExplorerClient {
  /** True when a Code Explorer MCP server (code-explorer or gitnexus) is connected. */
  available(): Promise<boolean>;
  /** Raw call to any Code Explorer op (e.g. 'hotspots', 'find_cycles'). Returns '' if unavailable. */
  call(op: string, args?: Record<string, unknown>): Promise<string>;
  /** Natural-language / structural query over the code graph. */
  query(q: string, repo?: string): Promise<string>;
  /** Blast-radius / impact of a symbol. */
  impact(target: string, repo?: string, direction?: 'both' | 'callers' | 'callees'): Promise<string>;
  /** Callers/callees/imports context for a symbol. */
  context(name: string, repo?: string): Promise<string>;
  /** Indexed repos (call first to get the repo path/id). */
  listRepos(): Promise<string>;
}

/**
 * Build a Code Explorer client bound to the live MCP manager. Lazily resolves the active
 * tool prefix on each call so it works whether the server is named `code-explorer` or `gitnexus`.
 */
export function getCodeExplorerClient(): CodeExplorerClient {
  async function prefix(): Promise<string | null> {
    try {
      const { codeExplorerToolPrefix } = await import('../../codebuddy/tools.js');
      return codeExplorerToolPrefix();
    } catch {
      return null;
    }
  }

  async function call(op: string, args: Record<string, unknown> = {}): Promise<string> {
    try {
      const p = await prefix();
      if (!p) return '';
      const { getMCPManager } = await import('../../codebuddy/tools.js');
      const result = (await getMCPManager().callTool(`${p}${op}`, args)) as McpCallResult;
      return extractText(result);
    } catch (err) {
      logger.debug(`[code-explorer] ${op} failed: ${err instanceof Error ? err.message : String(err)}`);
      return '';
    }
  }

  return {
    available: async () => (await prefix()) !== null,
    call,
    query: (q, repo) => call('query', { query: q, ...(repo ? { repo } : {}) }),
    impact: (target, repo, direction) =>
      call('impact', { target, ...(repo ? { repo } : {}), ...(direction ? { direction } : {}) }),
    context: (name, repo) => call('context', { name, ...(repo ? { repo } : {}) }),
    listRepos: () => call('list_repos', {}),
  };
}
