/**
 * Research Tool Definitions
 *
 * LLM-facing definition for the Deep Research pipeline (`deep_research`), the
 * agent-callable counterpart of `buddy research --deep/--iterations/
 * --perspectives/--ckg`. Bounded conservatively for in-chat use (see the
 * adapter in src/tools/deep-research-tool.ts).
 */

import type { CodeBuddyTool } from './types.js';

// Deep Research — multi-source, cited research pipeline.
export const DEEP_RESEARCH_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'deep_research',
    description:
      'Run a bounded, multi-source, CITED research pipeline on a topic and return a structured report with a "## Références" section. ' +
      'Use this (not web_search) when a question needs SEVERAL web sources cross-checked into one report: state of the art, comparisons, ' +
      '"what does the literature say", due diligence. The report carries inline [n] citation markers and a numbered references list. ' +
      "It is bounded for in-chat use (a few sub-questions, a low source cap, one iteration by default); raise 'iterations', " +
      "'perspectives' or 'max_sources' ONLY when the user explicitly needs a broader/deeper investigation (slower).",
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'The research question or topic to investigate.',
        },
        mode: {
          type: 'string',
          enum: ['deep', 'wide'],
          description:
            "'deep' (default): deterministic cited pipeline (plan → search → scrape → dedup → synthesize). 'wide': parallel sub-agent research fan-out (broader, less citation-strict).",
        },
        iterations: {
          type: 'number',
          description:
            'Deep only: number of gap-analysis rounds (1-3, default 1). >1 re-searches to fill gaps in the draft. Higher = slower/more thorough.',
        },
        perspectives: {
          type: 'number',
          description:
            'Deep only: research the topic from N diversified perspectives (2-6) and co-write an outline-first cited article (STORM). Activates the multi-perspective pipeline.',
        },
        ckg: {
          type: 'boolean',
          description:
            'Deep only: bridge the run to the Collective Knowledge Graph — recall prior collective knowledge and ingest the deduped sources for cross-run accumulation.',
        },
        max_sources: {
          type: 'number',
          description:
            'Deep only: global cap on scraped sources (1-20, default 6). Raise only when the topic explicitly needs broader coverage (slower).',
        },
      },
      required: ['topic'],
    },
  },
};

/**
 * All research tools as an array.
 */
export const RESEARCH_TOOLS: CodeBuddyTool[] = [DEEP_RESEARCH_TOOL];
