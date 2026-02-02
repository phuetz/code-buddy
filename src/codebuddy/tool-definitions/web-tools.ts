/**
 * Web Tool Definitions
 *
 * Tools for web operations:
 * - Web search
 * - URL fetching
 */

import type { CodeBuddyTool } from './types.js';

// Web search tool
export const WEB_SEARCH_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web for current information. Returns URLs and snippets. IMPORTANT: After getting search results, you MUST call web_fetch on the most relevant URL(s) to get the actual content and provide a detailed answer to the user. Never just return links - always fetch and summarize the content.",
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
export const WEB_FETCH_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "web_fetch",
    description: "Fetch and read the full content of a web page URL. Use this after web_search to get the actual article content, news details, or information. Always summarize the fetched content for the user.",
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

// Browser automation tool
export const BROWSER_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "browser",
    description: "Automate web browser for navigation, interaction, screenshots, form filling, and testing. Requires Playwright to be installed (npm install playwright).",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "navigate",
            "click",
            "fill",
            "screenshot",
            "getText",
            "getHtml",
            "evaluate",
            "waitForSelector",
            "getLinks",
            "getForms",
            "submit",
            "select",
            "hover",
            "scroll",
            "goBack",
            "goForward",
            "reload",
            "close",
          ],
          description: "The browser action to perform",
        },
        url: {
          type: "string",
          description: "URL to navigate to (for navigate action)",
        },
        selector: {
          type: "string",
          description: "CSS selector for element operations (click, fill, waitForSelector, etc.)",
        },
        value: {
          type: "string",
          description: "Value for fill/select operations",
        },
        script: {
          type: "string",
          description: "JavaScript code for evaluate action",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000)",
        },
        screenshotOptions: {
          type: "object",
          description: "Options for screenshot: { fullPage?: boolean, path?: string, type?: 'png' | 'jpeg' }",
        },
        scrollOptions: {
          type: "object",
          description: "Options for scroll: { x?: number, y?: number, behavior?: 'auto' | 'smooth' }",
        },
      },
      required: ["action"],
    },
  },
};

/**
 * All web tools as an array
 */
export const WEB_TOOLS: CodeBuddyTool[] = [
  WEB_SEARCH_TOOL,
  WEB_FETCH_TOOL,
  BROWSER_TOOL,
];
