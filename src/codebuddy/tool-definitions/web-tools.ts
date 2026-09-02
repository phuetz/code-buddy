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

// Local, heavy-duty scraping via the optional Scrapling Python sidecar.
export const WEB_SCRAPE_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "web_scrape",
    description: "Scrape a web page locally with Scrapling. Supports fast HTTP extraction, stealth/Cloudflare browser mode, dynamic JavaScript rendering, and CSS selectors. Falls back to web_fetch when Scrapling is unavailable.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Public HTTP or HTTPS URL to scrape",
        },
        mode: {
          type: "string",
          enum: ["http", "stealth", "dynamic"],
          description: "Scraping engine (default: http)",
        },
        format: {
          type: "string",
          enum: ["markdown", "text", "html"],
          description: "Primary output format (default: markdown)",
        },
        css: {
          type: "object",
          description: "Named CSS selectors to extract, for example { title: 'h1', prices: '.price' }",
          additionalProperties: { type: "string" },
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: CODEBUDDY_SCRAPLING_TIMEOUT_MS or 60000)",
        },
        impersonate: {
          type: "string",
          description: "Optional browser identity for HTTP mode",
        },
        solveCloudflare: {
          type: "boolean",
          description: "Attempt Cloudflare challenge handling in stealth mode",
        },
      },
      required: ["url"],
    },
  },
};

// Hermes-compatible web_extract alias
export const WEB_EXTRACT_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "web_extract",
    description: "Fetch and extract text content from a web page URL. Hermes-compatible alias for web_fetch.",
    parameters: WEB_FETCH_TOOL.function.parameters,
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

// Weather tool — real data via Open-Meteo (no API key), replaces the old
// hardcoded weather card inside web_search.
export const WEATHER_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "weather",
    description:
      "Get current weather and forecast for a city via Open-Meteo (no API key). " +
      "Returns temperature, feels-like, sky condition, wind and humidity, plus a daily forecast. " +
      "ALWAYS use this tool (never web_search) for weather/météo/forecast questions.",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "City name as the user said it (e.g. 'Paris', 'La Roche-sur-Yon')",
        },
        days: {
          type: "number",
          description: "Forecast days 1-7 (default 1 = today only)",
        },
        units: {
          type: "string",
          enum: ["metric", "imperial"],
          description: "Units (default metric: °C, km/h)",
        },
      },
      required: ["location"],
    },
  },
};

// Stock quote tool — real market data via Yahoo Finance → Nasdaq → Stooq (free,
// no API key), optional Finnhub. Emits a structured payload that renders the
// curated stock widget inline.
export const STOCK_QUOTE_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "stock_quote",
    description:
      "Get a real stock or index market quote (price, change, day range, volume) via Yahoo Finance / Nasdaq (free, no API key). " +
      "ALWAYS use this tool (never web_search) for stock price / cours de bourse / market index questions.",
    parameters: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description:
            "Ticker symbol. US stocks plain (e.g. 'AAPL', 'TSLA', 'NVDA'); other exchanges suffixed (e.g. 'MC.PA' for LVMH, 'BMW.DE'); indices prefixed with ^ (e.g. '^FCHI' for CAC 40, '^GSPC' for S&P 500). Map the company/index name the user says to its ticker.",
        },
      },
      required: ["symbol"],
    },
  },
};

// Community discussion search (HN / SO / GitHub / arXiv / Reddit).
// Dispatch: src/tools/registry/web-tools.ts CommunitySearchExecuteTool.
export const COMMUNITY_SEARCH_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "community_search",
    description:
      "Search what people say — Hacker News, Stack Overflow, GitHub, arXiv and Reddit — ranked by real engagement (votes, points, stars) over a recent window. Complements web_search, which indexes what publishers write. Free, no API key required.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to look for. Plain words work best — this searches discussions, not pages.",
        },
        days: {
          type: "number",
          description: "How far back to look, in days (1-365, default 30). Beyond ~30 it stops being current.",
        },
        limit: {
          type: "number",
          description: "How many results to return (1-60, default 25)",
        },
        sources: {
          type: "array",
          items: {
            type: "string",
            enum: ["hackernews", "stackexchange", "github", "arxiv", "reddit"],
          },
          description: "Restrict to specific sources. All by default.",
        },
      },
      required: ["query"],
    },
  },
};

/**
 * All web tools as an array
 */
export const WEB_TOOLS: CodeBuddyTool[] = [
  WEB_SEARCH_TOOL,
  WEB_FETCH_TOOL,
  WEB_SCRAPE_TOOL,
  WEB_EXTRACT_TOOL,
  WEATHER_TOOL,
  STOCK_QUOTE_TOOL,
  COMMUNITY_SEARCH_TOOL,
  // BROWSER_TOOL omitted — superseded by the richer browser-tools.ts (40+ actions)
];
