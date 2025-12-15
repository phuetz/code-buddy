/**
 * Web Tool Definitions
 *
 * Tools for web operations:
 * - Web search
 * - URL fetching
 */

import type { GrokTool } from './types.js';

// Web search tool
export const WEB_SEARCH_TOOL: GrokTool = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web for current information, documentation, or answers to questions",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to execute",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return (default: 5)",
        },
      },
      required: ["query"],
    },
  },
};

// Web fetch tool
export const WEB_FETCH_TOOL: GrokTool = {
  type: "function",
  function: {
    name: "web_fetch",
    description: "Fetch and read the content of a web page URL",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL of the web page to fetch",
        },
      },
      required: ["url"],
    },
  },
};

/**
 * All web tools as an array
 */
export const WEB_TOOLS: GrokTool[] = [
  WEB_SEARCH_TOOL,
  WEB_FETCH_TOOL,
];
