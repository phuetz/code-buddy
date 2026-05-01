/**
 * Advisor Tool Definitions
 *
 * OpenAI function calling schema for the advisor tool.
 *
 * The advisor forwards the entire conversation history to a stronger model
 * configured via [advisor].model in TOML config (default: claude-opus-4-7),
 * asking for a second opinion on the assistant's approach so far.
 */

import type { CodeBuddyTool } from './types.js';

export const ADVISOR_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'advisor',
    description:
      'Consult a stronger reviewer model (configured via [advisor].model, default claude-opus-4-7) for a second opinion. The full conversation history is forwarded automatically — no parameters needed. ' +
      'Call advisor BEFORE substantive work (writing, declaring an answer, committing to an interpretation), when stuck (recurring errors, approach not converging), or when considering a change of approach. ' +
      'Also call when you believe the task is complete, AFTER making the deliverable durable. ' +
      'On long tasks, call at least once before committing to an approach and once before declaring done.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const ADVISOR_TOOLS: CodeBuddyTool[] = [ADVISOR_TOOL];
