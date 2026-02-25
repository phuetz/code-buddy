/**
 * Agent Tool Definitions
 *
 * OpenAI function-calling schemas for tools that were previously
 * registered as ITool adapters but had no LLM-facing schema:
 * - todo_update (Manus-style attention management)
 * - restore_context (restorable compression)
 * - knowledge_search / knowledge_add
 * - ask_human
 * - create_skill
 * - skill_discover
 * - device_manage
 * - lessons_add / lessons_search / lessons_list
 * - task_verify
 */

import type { CodeBuddyTool } from './types.js';

// ============================================================================
// Attention Tools
// ============================================================================

export const TODO_UPDATE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'todo_update',
    description: 'Manage the persistent task list (todo.md). Track progress on complex tasks. The current list is automatically shown each turn.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'complete', 'update', 'remove', 'clear_done', 'list'],
          description: 'Action to perform',
        },
        text: {
          type: 'string',
          description: 'Item text (required for add; optional for update)',
        },
        id: {
          type: 'string',
          description: 'Item ID (required for complete/update/remove)',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'done', 'blocked'],
          description: 'New status (for update)',
        },
        priority: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Priority (for add/update, default: medium)',
        },
      },
      required: ['action'],
    },
  },
};

export const RESTORE_CONTEXT_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'restore_context',
    description: 'Restore compressed context content by identifier (file path or URL). When context is compressed, identifiers are preserved — use this to retrieve the full original content.',
    parameters: {
      type: 'object',
      properties: {
        identifier: {
          type: 'string',
          description: 'File path (e.g. "src/agent/types.ts") or URL to restore',
        },
      },
      required: ['identifier'],
    },
  },
};

// ============================================================================
// Knowledge Tools
// ============================================================================

export const KNOWLEDGE_SEARCH_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'knowledge_search',
    description: 'Search the agent knowledge base for domain knowledge, conventions, or procedures. Returns ranked excerpts from loaded Knowledge.md files.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords or phrase to search for in knowledge bases',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 5)',
        },
        scope: {
          type: 'string',
          description: 'Filter by agent mode scope (e.g. "code", "review")',
        },
      },
      required: ['query'],
    },
  },
};

export const KNOWLEDGE_ADD_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'knowledge_add',
    description: 'Add a new entry to the user-level knowledge base (~/.codebuddy/knowledge/). Persist learned conventions, procedures, or domain knowledge across sessions.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title for this knowledge entry (becomes the filename)',
        },
        content: {
          type: 'string',
          description: 'Markdown content of the knowledge entry',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for discovery',
        },
        scope: {
          type: 'array',
          items: { type: 'string' },
          description: 'Agent modes this applies to (e.g. ["code", "review"])',
        },
      },
      required: ['title', 'content'],
    },
  },
};

export const ASK_HUMAN_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'ask_human',
    description: "Pause execution and ask the user a clarifying question. Use when you need information that cannot be inferred from context, or when multiple interpretations exist.",
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask the user',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional predefined choices for the user',
        },
        default: {
          type: 'string',
          description: 'Default answer if user provides no input',
        },
      },
      required: ['question'],
    },
  },
};

export const CREATE_SKILL_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'create_skill',
    description: 'Create a new SKILL.md file in the workspace skills directory. Codify reusable workflows or procedures for future sessions. Skills are hot-reloaded immediately.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name (becomes the filename)',
        },
        description: {
          type: 'string',
          description: 'Short description of what the skill does',
        },
        body: {
          type: 'string',
          description: 'Markdown body of the skill (instructions, steps, etc.)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for discovery',
        },
        requires: {
          type: 'array',
          items: { type: 'string' },
          description: 'Required tools or capabilities',
        },
        overwrite: {
          type: 'boolean',
          description: 'Overwrite if skill already exists (default: false)',
        },
      },
      required: ['name', 'description', 'body'],
    },
  },
};

// ============================================================================
// Discovery & Device Tools
// ============================================================================

export const SKILL_DISCOVER_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'skill_discover',
    description: 'Search the Skills Hub for capabilities matching a query. Optionally auto-install the top result to expand the agent toolset at runtime.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query to find relevant skills',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to filter by',
        },
        auto_install: {
          type: 'boolean',
          description: 'Automatically install the top matching skill (default: false)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 5)',
        },
      },
      required: ['query'],
    },
  },
};

export const DEVICE_MANAGE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'device_manage',
    description: 'Manage paired devices (SSH/ADB/local). List, pair, remove, screenshot, camera snap, screen record, get location, run commands.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'pair', 'remove', 'snap', 'screenshot', 'record', 'location', 'run'],
          description: 'Device action to perform',
        },
        deviceId: { type: 'string', description: 'Device identifier' },
        name: { type: 'string', description: 'Display name for pairing' },
        transport: { type: 'string', enum: ['ssh', 'adb', 'local'], description: 'Transport type' },
        address: { type: 'string', description: 'Connection address (host/IP)' },
        port: { type: 'number', description: 'Connection port' },
        username: { type: 'string', description: 'SSH username' },
        keyPath: { type: 'string', description: 'Path to SSH key' },
        command: { type: 'string', description: 'Command to run (for run action)' },
        duration: { type: 'number', description: 'Recording duration in seconds (for record action)' },
      },
      required: ['action'],
    },
  },
};

// ============================================================================
// Lessons & Verification Tools
// ============================================================================

export const LESSONS_ADD_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'lessons_add',
    description: 'Capture a lesson learned into the persistent lessons.md file. Use PATTERN for corrections, RULE for invariants, CONTEXT for project facts, INSIGHT for observations. Call immediately after any user correction.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'],
          description: 'Lesson category',
        },
        content: {
          type: 'string',
          description: 'The lesson content',
        },
        context: {
          type: 'string',
          description: 'Additional context or file path where this applies',
        },
        source: {
          type: 'string',
          enum: ['user_correction', 'self_observed', 'manual'],
          description: 'How the lesson was discovered (default: manual)',
        },
      },
      required: ['category', 'content'],
    },
  },
};

export const LESSONS_SEARCH_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'lessons_search',
    description: 'Search lessons learned for relevant patterns, rules, or context before starting a task. Helps avoid repeating past mistakes.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms to match against lessons',
        },
        category: {
          type: 'string',
          enum: ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'],
          description: 'Filter by lesson category',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 10)',
        },
      },
      required: ['query'],
    },
  },
};

export const LESSONS_LIST_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'lessons_list',
    description: 'List all lessons learned, optionally filtered by category. Shows lesson content, category, timestamps, and decay scores.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'],
          description: 'Filter by lesson category',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 20)',
        },
      },
      required: [],
    },
  },
};

export const TASK_VERIFY_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'task_verify',
    description: 'Run the verification contract: TypeScript check (tsc --noEmit), tests (npm test), and lint (npm run lint). Returns pass/fail for each step. Use after completing code changes.',
    parameters: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: { type: 'string', enum: ['typecheck', 'test', 'lint'] },
          description: 'Which verification steps to run (default: all)',
        },
        fix: {
          type: 'boolean',
          description: 'Auto-fix lint issues (default: false)',
        },
      },
      required: [],
    },
  },
};

// ============================================================================
// Grouped Export
// ============================================================================

export const AGENT_TOOLS: CodeBuddyTool[] = [
  TODO_UPDATE_TOOL,
  RESTORE_CONTEXT_TOOL,
  KNOWLEDGE_SEARCH_TOOL,
  KNOWLEDGE_ADD_TOOL,
  ASK_HUMAN_TOOL,
  CREATE_SKILL_TOOL,
  SKILL_DISCOVER_TOOL,
  DEVICE_MANAGE_TOOL,
  LESSONS_ADD_TOOL,
  LESSONS_SEARCH_TOOL,
  LESSONS_LIST_TOOL,
  TASK_VERIFY_TOOL,
];
