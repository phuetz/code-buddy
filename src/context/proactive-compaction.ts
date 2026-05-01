/**
 * Proactive Context Compaction
 *
 * Predicts whether a tool execution will overflow the context window
 * and triggers compaction BEFORE the tool runs, rather than reacting
 * after the overflow has already occurred.
 *
 * Uses heuristic-based token estimation per tool type — no LLM call needed.
 */

import { logger } from '../utils/logger.js';

/**
 * Heuristic token estimates for common tool types.
 * These are conservative averages based on observed outputs.
 */
const TOOL_TOKEN_ESTIMATES: Record<string, number> = {
  bash: 2000,
  shell_exec: 2000,
  view_file: 1500,
  file_read: 1500,
  read_file: 1500,
  create_file: 200,
  file_write: 200,
  str_replace_editor: 300,
  multi_edit: 400,
  search: 1000,
  grep: 1000,
  search_files: 1000,
  search_multi: 2000,
  find_symbols: 800,
  find_references: 800,
  find_definition: 500,
  glob: 600,
  list_directory: 500,
  web_search: 2000,
  web_fetch: 3000,
  firecrawl_search: 2500,
  firecrawl_scrape: 3000,
  browser: 2000,
  git: 1000,
  docker: 800,
  kubernetes: 800,
  pdf: 2000,
  document: 2000,
  archive: 1500,
  codebase_map: 2000,
  code_graph: 1500,
  run_script: 2000,
  js_repl: 1000,
  reason: 3000,
  plan: 500,
  find_bugs: 2000,
};

/** Default estimate for unknown tools */
const DEFAULT_TOKEN_ESTIMATE = 1000;

/**
 * Estimate the token count of a tool result based on tool name and arguments.
 *
 * Uses heuristics:
 * - `bash`: ~2000 tokens average
 * - `view_file`: ~file_size / 4 tokens (if file_path arg hints at size)
 * - `search`/`grep`: ~500 tokens per expected match
 * - `web_fetch`: ~3000 tokens
 *
 * @param toolName - Name of the tool being called
 * @param args - Tool call arguments
 * @returns Estimated token count for the tool result
 */
export function estimateToolResultTokens(
  toolName: string,
  args: Record<string, unknown>
): number {
  const baseEstimate = TOOL_TOKEN_ESTIMATES[toolName] ?? DEFAULT_TOKEN_ESTIMATE;

  // Refine estimate based on args
  switch (toolName) {
    case 'view_file':
    case 'file_read':
    case 'read_file': {
      // If limit (line count) is specified, scale estimate
      const limit = typeof args.limit === 'number' ? args.limit : 0;
      if (limit > 0) {
        // Rough: ~10 tokens per line on average
        return Math.min(limit * 10, 8000);
      }
      return baseEstimate;
    }

    case 'search':
    case 'grep':
    case 'search_files': {
      // Scale by expected matches — if pattern is very specific, fewer results
      const pattern = typeof args.pattern === 'string' ? args.pattern : '';
      // Longer/more specific patterns tend to yield fewer results
      if (pattern.length > 30) return 500;
      if (pattern.length > 15) return 800;
      return baseEstimate;
    }

    case 'search_multi': {
      // Multiple queries — scale by count
      const queries = Array.isArray(args.queries) ? args.queries.length : 1;
      return Math.min(queries * 800, 5000);
    }

    case 'bash':
    case 'shell_exec': {
      // Commands that produce large output
      const command = typeof args.command === 'string' ? args.command : '';
      if (command.includes('find') || command.includes('ls -R') || command.includes('tree')) {
        return 4000;
      }
      if (command.includes('cat ') || command.includes('head ') || command.includes('tail ')) {
        return 3000;
      }
      if (command.includes('npm test') || command.includes('npm run') || command.includes('vitest')) {
        return 5000;
      }
      return baseEstimate;
    }

    case 'web_fetch':
    case 'firecrawl_scrape': {
      return 3000;
    }

    case 'list_directory': {
      // Recursive listings produce more output
      const recursive = args.recursive === true;
      return recursive ? 2000 : baseEstimate;
    }

    default:
      return baseEstimate;
  }
}

/**
 * Determine whether context should be compacted before executing a tool.
 *
 * If the current token usage plus the estimated tool result size would
 * exceed the context window minus a reserve ratio, compaction should
 * be triggered proactively.
 *
 * @param currentTokens - Current total token count in the context
 * @param estimatedToolResultTokens - Estimated tokens the tool will produce
 * @param contextWindow - Total context window size in tokens
 * @param reserveRatio - Fraction of context to keep reserved (default 0.15)
 * @returns true if compaction should be triggered before tool execution
 */
export function shouldCompactBeforeToolExec(
  currentTokens: number,
  estimatedToolResultTokens: number,
  contextWindow: number,
  reserveRatio: number = 0.15
): boolean {
  if (contextWindow <= 0) return false;
  if (currentTokens <= 0) return false;

  const threshold = contextWindow * (1 - reserveRatio);
  const projectedTokens = currentTokens + estimatedToolResultTokens;

  if (projectedTokens > threshold) {
    logger.debug('Proactive compaction triggered', {
      currentTokens,
      estimatedToolResultTokens,
      projectedTokens,
      threshold,
      contextWindow,
      reserveRatio,
    });
    return true;
  }

  return false;
}
