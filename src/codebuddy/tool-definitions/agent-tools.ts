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
 * - extension_forge
 * - skill_discover
 * - device_manage
 * - spawn_parallel_agents
 * - remember / recall / forget
 * - lead_scout_plan / lead_scout_run / lead_scout_enrichment_plan / lead_scout_lesson_candidates
 * - lessons_add / lessons_propose / lessons_search / lessons_list / lessons_graph
 * - user_model_observe / user_model_recall
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
    description: 'Restore context removed from the model-facing observation. Pass the exact originating tool call ID (call_… or toolu_…) to retrieve the raw output persisted before optimization. Preserved file-path and URL identifiers remain supported.',
    parameters: {
      type: 'object',
      properties: {
        identifier: {
          type: 'string',
          description: 'Exact tool call ID (preferred), or a preserved file path/URL identifier',
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
    description: "Pause execution and ask the user a clarifying question. Use when you need information that cannot be inferred from context, or when multiple interpretations exist. Supports structured multi-choice questions.",
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
          description: 'Optional predefined choices for the user (legacy, prefer choices)',
        },
        choices: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Display label for the choice' },
              value: { type: 'string', description: 'Value returned when selected' },
              description: { type: 'string', description: 'Optional description shown below the label' },
            },
            required: ['label', 'value'],
          },
          description: 'Structured choices with labels, values, and optional descriptions. Max 6 choices.',
        },
        multiSelect: {
          type: 'boolean',
          description: 'If true, user can select multiple choices. Default: false',
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

export const EXTENSION_FORGE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'extension_forge',
    description:
      'Write and install a safe runtime widget, sandboxed executable tool, or reusable skill. ' +
      'The source must be supplied in the call and is accepted only after artifact-specific safety and behavior gates pass.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['widget', 'tool', 'skill'],
          description: 'Extension type to create',
        },
        name: {
          type: 'string',
          description: 'Short extension name; a safe authored namespace is added automatically',
        },
        description: {
          type: 'string',
          description: 'Purpose and when this extension should be used',
        },
        template: {
          type: 'string',
          description: 'Widget only: complete inert Mustache HTML and CSS template',
        },
        sample: {
          type: 'object',
          description: 'Widget only: representative JSON payload used by the validation gate',
        },
        code: {
          type: 'string',
          description: 'Tool only: complete source that reads CODEBUDDY_TOOL_INPUT and writes its result to stdout',
        },
        language: {
          type: 'string',
          enum: ['javascript', 'typescript', 'python'],
          description: 'Tool only: source language',
        },
        parameters: {
          type: 'object',
          description: 'Tool only: JSON Schema describing the generated tool arguments',
        },
        validation_cases: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              input: { type: 'object' },
              expect_includes: { type: 'array', items: { type: 'string' } },
            },
            required: ['input', 'expect_includes'],
          },
          description: 'Tool only: functional examples the implementation must pass',
        },
        robustness_cases: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              input: { type: 'object' },
              expect_includes: { type: 'array', items: { type: 'string' } },
            },
            required: ['input', 'expect_includes'],
          },
          description: 'Tool only: distinct edge inputs that catch hardcoding and fragile behavior',
        },
        body: {
          type: 'string',
          description: 'Skill only: complete reusable SKILL.md instructions',
        },
      },
      required: ['kind', 'name', 'description'],
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

export const SKILLS_LIST_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'skills_list',
    description: 'List installed SKILL.md packages from the local SkillsHub lockfile. Read-only; use to inspect available skills without searching the remote hub.',
    parameters: {
      type: 'object',
      properties: {
        include_disabled: {
          type: 'boolean',
          description: 'Include disabled skills. Default: false.',
        },
        include_usage: {
          type: 'boolean',
          description: 'Include local usage telemetry when present. Default: true.',
        },
      },
      required: [],
    },
  },
};

export const SKILL_VIEW_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'skill_view',
    description: 'Read one installed SKILL.md package from the local SkillsHub, including lockfile metadata, integrity status, and optionally the SKILL.md content.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Installed skill name.',
        },
        include_content: {
          type: 'boolean',
          description: 'Include SKILL.md file content. Default: true.',
        },
      },
      required: ['name'],
    },
  },
};

export const SKILL_MANAGE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'skill_manage',
    description: 'Hermes-style skill management facade. Supports installed skill list/view/history, direct create/discover, official create/edit/patch/write_file/remove_file aliases, update previews, review-gated enable/disable/deprecate/delete/rollback/reset/update, and review-gated candidate list/view/install through Code Buddy skills primitives.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'list',
            'view',
            'history',
            'create',
            'edit',
            'discover',
            'enable',
            'disable',
            'deprecate',
            'delete',
            'patch',
            'write_file',
            'remove_file',
            'rollback',
            'preview_update',
            'reset',
            'update',
            'candidate_list',
            'candidate_view',
            'candidate_install',
          ],
          description: 'Skill management action to run.',
        },
        name: {
          type: 'string',
          description: 'Skill name. Required for view, history, and create.',
        },
        description: {
          type: 'string',
          description: 'One-sentence skill description. Required for create.',
        },
        body: {
          type: 'string',
          description: 'Full SKILL.md body. Required for create.',
        },
        content: {
          type: 'string',
          description: 'Official Hermes alias: full SKILL.md content for create or edit.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for create or discover.',
        },
        requires: {
          type: 'array',
          items: { type: 'string' },
          description: 'Required tools or capabilities for create.',
        },
        env: {
          type: 'object',
          description: 'Environment variables required by the created skill.',
        },
        overwrite: {
          type: 'boolean',
          description: 'Overwrite an existing workspace skill on create. Default: false.',
        },
        force: {
          type: 'boolean',
          description: 'Force update even when the target version is not newer. Default: false.',
        },
        version: {
          type: 'string',
          description: 'Optional target version for preview_update or update. If omitted, update uses hub or local cache metadata.',
        },
        include_disabled: {
          type: 'boolean',
          description: 'Include disabled installed skills on list. Default: false.',
        },
        include_usage: {
          type: 'boolean',
          description: 'Include local usage telemetry on list. Default: true.',
        },
        include_content: {
          type: 'boolean',
          description: 'Include SKILL.md file content on view/candidate_view. Default: true.',
        },
        query: {
          type: 'string',
          description: 'Search query. Required for discover.',
        },
        auto_install: {
          type: 'boolean',
          description: 'Automatically install the top discovered skill. Default: false.',
        },
        limit: {
          type: 'number',
          description: 'Maximum discovered skills to return. Default: 5.',
        },
        candidate_path: {
          type: 'string',
          description: 'Candidate SKILL.md path or candidate directory. Required for candidate_view and candidate_install.',
        },
        skill_root: {
          type: 'string',
          description: 'Candidate root to scan for candidate_list. Default: .codebuddy/skill-candidates.',
        },
        eligible_only: {
          type: 'boolean',
          description: 'Only show install-eligible candidates on candidate_list. Default: false.',
        },
        approved_by: {
          type: 'string',
          description: 'Human reviewer identity. Required for candidate_install and review-gated lifecycle mutations: enable, disable, deprecate, delete, patch, rollback, reset, update. Not required for preview_update.',
        },
        approved_at: {
          type: 'string',
          description: 'Optional approval timestamp for candidate_install.',
        },
        reason: {
          type: 'string',
          description: 'Optional human-readable reason for enable, disable, deprecate, delete, patch, rollback, reset, or update.',
        },
        old_text: {
          type: 'string',
          description: 'Literal text to replace inside an installed SKILL.md or supporting file. Required for patch unless old_string is provided.',
        },
        new_text: {
          type: 'string',
          description: 'Replacement text for patch. Can be an empty string for deletion. Required unless new_string is provided.',
        },
        old_string: {
          type: 'string',
          description: 'Official Hermes alias for old_text.',
        },
        new_string: {
          type: 'string',
          description: 'Official Hermes alias for new_text.',
        },
        replace_all: {
          type: 'boolean',
          description: 'Official Hermes patch flag: replace all occurrences instead of requiring a unique match. Default: false.',
        },
        expected_replacements: {
          type: 'number',
          description: 'Optional safety check for patch: fail unless exactly this many replacements would be made.',
        },
        file_path: {
          type: 'string',
          description: 'Official Hermes supporting file path for patch/write_file/remove_file. Must be SKILL.md or under references/, templates/, scripts/, or assets/.',
        },
        file_content: {
          type: 'string',
          description: 'Official Hermes supporting file content. Required for write_file.',
        },
        absorbed_into: {
          type: 'string',
          description: 'Official Hermes delete intent hint. Accepted for compatibility; Code Buddy records explicit reason/approval instead.',
        },
        snapshot_id: {
          type: 'string',
          description: 'Optional rollback snapshot id. If omitted, rollback restores the latest snapshot.',
        },
        workspace_skill_root: {
          type: 'string',
          description: 'Workspace skill root for candidate_install. Default: .codebuddy/skills.',
        },
      },
      required: ['action'],
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

export const SPAWN_PARALLEL_AGENTS_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'spawn_parallel_agents',
    description: 'Execute multiple sub-tasks concurrently using parallel sub-agents. Best for independent tasks.',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'List of tasks to execute in parallel',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique identifier for this task' },
              type: {
                type: 'string',
                enum: ['code-reviewer', 'debugger', 'test-runner', 'explorer', 'refactorer', 'documenter'],
                description: 'Type of specialized agent to use',
              },
              task: { type: 'string', description: 'The specific instructions for this sub-agent' },
              context: { type: 'string', description: 'Additional context for this specific task' },
              yield: {
                type: 'boolean',
                description: 'If true, parent agent yields its turn and waits for this sub-agent to complete before resuming (default: false)',
              },
            },
            required: ['task'],
          },
        },
      },
      required: ['tasks'],
    },
  },
};

export const REMEMBER_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'remember',
    description: 'Store important information, decisions, or preferences in persistent memory.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short unique key for this memory' },
        value: { type: 'string', description: 'The information to be remembered' },
        scope: {
          type: 'string',
          enum: ['project', 'user'],
          description: 'Scope for this memory (default: project)',
        },
        category: {
          type: 'string',
          enum: ['project', 'preferences', 'decisions', 'patterns', 'custom'],
          description: 'Type of information being stored',
        },
      },
      required: ['key', 'value'],
    },
  },
};

export const RECALL_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'recall',
    description: 'Retrieve a specific memory entry by its key.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key to retrieve' },
        scope: {
          type: 'string',
          enum: ['project', 'user'],
          description: 'Optional scope filter',
        },
      },
      required: ['key'],
    },
  },
};

export const FORGET_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'forget',
    description: 'Remove a memory entry that is no longer valid.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key to remove' },
        scope: {
          type: 'string',
          enum: ['project', 'user'],
          description: 'Scope to remove from (default: project)',
        },
      },
      required: ['key'],
    },
  },
};

// ============================================================================
// Relationship Intelligence
// ============================================================================

export const RELATIONSHIP_CONTEXT_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'relationship_context',
    description:
      'Build a safe relationship/world-memory context card for a person, organization, place, or concept. Uses public facts, relationship memory, evidence, confidence, and permissions without performing web search or identification by itself.',
    parameters: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description: 'Name or label of the entity being discussed.',
        },
        subjectType: {
          type: 'string',
          enum: ['public_person', 'known_person', 'unknown_person', 'organization', 'place', 'concept'],
          description: 'Relationship class. Defaults to unknown_person when omitted.',
        },
        mode: {
          type: 'string',
          enum: ['general', 'robot_conversation', 'prospecting'],
          description: 'Use-case posture for the context card.',
        },
        confidence: {
          type: 'number',
          description: 'Recognition confidence from 0 to 1.',
        },
        publicFacts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Public or encyclopedic facts safe to use when permitted.',
        },
        relationshipFacts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Private relationship memory, used only for confirmed known people.',
        },
        sensitiveFacts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Sensitive facts withheld unless explicitly permitted.',
        },
        visibleSignals: {
          type: 'array',
          items: { type: 'string' },
          description: 'Visible, non-identifying context such as badge text or current setting.',
        },
        evidence: {
          type: 'array',
          description: 'Evidence attached to public facts or recognition.',
          items: {
            type: 'object',
            properties: {
              sourceType: {
                type: 'string',
                enum: ['public_web', 'user_provided', 'local_memory', 'perception', 'conversation', 'manual'],
                description: 'Where this evidence came from.',
              },
              label: { type: 'string', description: 'Short source label.' },
              url: { type: 'string', description: 'Source URL, if public.' },
              excerpt: { type: 'string', description: 'Short source excerpt.' },
              observedAt: { type: 'string', description: 'ISO timestamp or human-readable time.' },
              confidence: { type: 'number', description: 'Evidence confidence from 0 to 1.' },
            },
            required: ['sourceType'],
          },
        },
        permissions: {
          type: 'object',
          description: 'Explicit permissions controlling what context may be used.',
          properties: {
            usePublicKnowledge: { type: 'boolean' },
            useRelationshipMemory: { type: 'boolean' },
            identifyUnknownPeople: { type: 'boolean' },
            persistNewMemory: { type: 'boolean' },
            useSensitiveFacts: { type: 'boolean' },
          },
        },
      },
      required: ['subject'],
    },
  },
};

// ============================================================================
// Lead Scout
// ============================================================================

export const LEAD_SCOUT_PLAN_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'lead_scout_plan',
    description:
      'Build a safe B2B lead-discovery plan for public professional data: sources, schema, scoring, script recipe, evidence requirements, and human-review gates.',
    parameters: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: 'Prospecting objective, e.g. find architects near a city for a renovation offer.',
        },
        target: {
          type: 'string',
          enum: [
            'architectes',
            'syndics',
            'agences_immobilieres',
            'maitres_oeuvre',
            'promoteurs',
            'bureaux_etudes',
            'custom',
          ],
          description: 'Lead category. Use custom with customTarget for another B2B target.',
        },
        customTarget: {
          type: 'string',
          description: 'Custom B2B lead category label when target is custom.',
        },
        zone: {
          type: 'string',
          description: 'Geographic scope such as city, postal code, department, region, or radius text.',
        },
        offer: {
          type: 'string',
          description: 'Offer or service to qualify leads against.',
        },
        maxProspects: {
          type: 'number',
          description: 'Maximum lead budget for review. Defaults to 50; tool validation accepts 1 to 500.',
        },
        sources: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['local_dataset', 'sirene', 'rnc', 'official_directory', 'public_website', 'web_search'],
          },
          description: 'Optional source strategy. Defaults depend on target.',
        },
        exportFormats: {
          type: 'array',
          items: { type: 'string', enum: ['csv', 'json', 'markdown'] },
          description: 'Desired review output formats. Defaults to csv and json.',
        },
        localDatasetPaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Existing CSV/JSON lead datasets to import before web discovery.',
        },
        requireHumanApprovalBeforeContact: {
          type: 'boolean',
          description: 'Whether a human must approve source evidence and outreach before contact. Defaults true.',
        },
      },
      required: ['goal'],
    },
  },
};

export const LEAD_SCOUT_RUN_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'lead_scout_run',
    description:
      'Run a local-first B2B lead discovery pipeline over JSON/CSV datasets: normalize, dedupe, score, draft optional outreach, and optionally export a human review queue. Does not browse or send emails.',
    parameters: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: 'Prospecting objective, e.g. rank architects near a city for a renovation offer.',
        },
        localDatasetPaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'JSON or CSV datasets to load. This runner is local-first and does not browse by itself.',
        },
        target: {
          type: 'string',
          enum: [
            'architectes',
            'syndics',
            'agences_immobilieres',
            'maitres_oeuvre',
            'promoteurs',
            'bureaux_etudes',
            'custom',
          ],
          description: 'Lead category. Use custom with customTarget for another B2B target.',
        },
        customTarget: {
          type: 'string',
          description: 'Custom B2B lead category label when target is custom.',
        },
        zone: {
          type: 'string',
          description: 'Geographic scope such as city, postal code, department, region, or radius text.',
        },
        offer: {
          type: 'string',
          description: 'Offer or service to qualify leads against.',
        },
        maxProspects: {
          type: 'number',
          description: 'Maximum lead budget for review. Defaults to 50; tool validation accepts 1 to 500.',
        },
        minScore: {
          type: 'number',
          description: 'Minimum score to keep in the review queue. Defaults to 0; tool validation accepts 0 to 100.',
        },
        includeOutreachDrafts: {
          type: 'boolean',
          description: 'Include draft-only outreach text. It never sends email. Defaults true.',
        },
        outputFormat: {
          type: 'string',
          enum: ['csv', 'json', 'markdown'],
          description: 'Format to write when path is provided. Defaults from path extension.',
        },
        path: {
          type: 'string',
          description: 'Optional output file path (.json, .csv, or .md). Omit to return results without writing.',
        },
        requireHumanApprovalBeforeContact: {
          type: 'boolean',
          description: 'Whether a human must approve source evidence and outreach before contact. Defaults true.',
        },
      },
      required: ['goal', 'localDatasetPaths'],
    },
  },
};

export const LEAD_SCOUT_ENRICHMENT_PLAN_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'lead_scout_enrichment_plan',
    description:
      'Plan a multi-hop public B2B enrichment job: profile page -> official website -> contact/legal/about pages -> phone/email/contact URL, with principles, evidence chain, and a protected run_script contract.',
    parameters: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: 'Enrichment objective, e.g. find architect phones by following official website links.',
        },
        target: {
          type: 'string',
          enum: [
            'architectes',
            'syndics',
            'agences_immobilieres',
            'maitres_oeuvre',
            'promoteurs',
            'bureaux_etudes',
            'custom',
          ],
          description: 'Lead category. Defaults to custom.',
        },
        sourceUrlField: {
          type: 'string',
          description: 'Field containing the seed profile/directory URL. Defaults to source_url.',
        },
        websiteField: {
          type: 'string',
          description: 'Field containing or receiving the official website URL. Defaults to site_web.',
        },
        nameField: {
          type: 'string',
          description: 'Field containing the business/person name. Defaults to nom.',
        },
        missingFields: {
          type: 'array',
          items: { type: 'string', enum: ['email', 'telephone', 'site_web', 'contact_url'] },
          description: 'Fields to enrich. Defaults to email, telephone, and site_web.',
        },
        maxHops: {
          type: 'number',
          description: 'Maximum evidence hops from source profile to official site/contact pages. Defaults to 3.',
        },
        pageBudget: {
          type: 'number',
          description: 'Maximum public pages per lead for the generated script. Defaults to 8; validation accepts 1 to 30.',
        },
        delayMs: {
          type: 'number',
          description: 'Delay between requests in the generated script. Defaults to 1500ms.',
        },
        allowedDomains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional domain allowlist. Empty means public web except ignored domains.',
        },
        ignoredDomains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional domains to treat as generic portals or off-limits.',
        },
        allowGeneratedScript: {
          type: 'boolean',
          description: 'Include the generated Python script in the output. Defaults true.',
        },
      },
      required: ['goal'],
    },
  },
};

export const LEAD_SCOUT_LESSON_CANDIDATES_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'lead_scout_lesson_candidates',
    description:
      'Generate reviewed lesson candidates from Lead Scout runs or sandboxed enrichment scripts. Returns lessons_add payloads but does not persist them automatically.',
    parameters: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: 'Lead Scout task or run goal that produced observations.',
        },
        context: {
          type: 'string',
          description: 'Optional lesson context label, e.g. "Lead Scout architect enrichment".',
        },
        stats: {
          type: 'object',
          description: 'Run stats such as processed, enriched, skipped, blocked, selectedLeads, needsPublicEnrichment, and contact coverage.',
          properties: {
            processed: { type: 'number', description: 'Rows or leads processed.' },
            enriched: { type: 'number', description: 'Rows enriched.' },
            skipped: { type: 'number', description: 'Rows skipped.' },
            blocked: { type: 'number', description: 'Rows blocked by safety/access stops.' },
            selectedLeads: { type: 'number', description: 'Leads selected in review queue.' },
            needsPublicEnrichment: { type: 'number', description: 'Selected leads with no email, phone, or website.' },
            leadsWithEmail: { type: 'number', description: 'Selected leads with email.' },
            leadsWithPhone: { type: 'number', description: 'Selected leads with phone.' },
            leadsWithWebsite: { type: 'number', description: 'Selected leads with website.' },
          },
        },
        warnings: {
          type: 'array',
          items: { type: 'string' },
          description: 'Warnings from a Lead Scout run.',
        },
        blockers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Safety or access blockers observed, such as captcha, login, 403, 429.',
        },
        successfulPatterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Patterns that worked and may be reusable.',
        },
        failedPatterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Patterns that failed and should not be retried blindly.',
        },
        contactPathsThatWorked: {
          type: 'array',
          items: { type: 'string' },
          description: 'Same-domain contact paths that yielded public contact data.',
        },
        domainsToIgnore: {
          type: 'array',
          items: { type: 'string' },
          description: 'Generic or non-official domains to ignore in future enrichment.',
        },
        scriptChanges: {
          type: 'array',
          items: { type: 'string' },
          description: 'Potential generated-script improvements observed during the run.',
        },
      },
      required: ['goal'],
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

export const LESSONS_PROPOSE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'lessons_propose',
    description:
      'Propose a lesson candidate for human review instead of writing it directly. Use this (not lessons_add) when you noticed a reusable pattern after a complex successful task without a user correction. The candidate stays pending until a human approves, edits, or discards it via "buddy lessons candidate", so procedural memory is never silently mutated.',
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
          description: 'The proposed lesson content',
        },
        context: {
          type: 'string',
          description: 'Additional context or file path where this applies',
        },
        note: {
          type: 'string',
          description: 'Optional provenance note, e.g. why this pattern is worth keeping',
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

export const LESSONS_GRAPH_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'lessons_graph',
    description: 'Build a mini-Obsidian concept graph over lessons.md. Derives concepts from [[wiki links]], Markdown links, #tags, context, related/tags metadata, and keywords, then returns nearby lessons and connected notions.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional text filter before graphing lessons',
        },
        concept: {
          type: 'string',
          description: 'Only graph lessons linked to this concept slug, label, wiki link, or Markdown target',
        },
        category: {
          type: 'string',
          enum: ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'],
          description: 'Filter by lesson category',
        },
        limit: {
          type: 'number',
          description: 'Maximum lessons to graph (default: 50, max: 200)',
        },
        includeKeywords: {
          type: 'boolean',
          description: 'Whether to include fallback keyword concepts. Set false for a cleaner explicit-link/tag graph.',
        },
        format: {
          type: 'string',
          enum: ['summary', 'json', 'markdown', 'mermaid'],
          description: 'Return concise Markdown summary, full graph JSON, Obsidian-friendly Markdown index, or Mermaid diagram text',
        },
      },
      required: [],
    },
  },
};

export const USER_MODEL_OBSERVE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'user_model_observe',
    description:
      'Propose an observation about the user for human review (does NOT write the model). Use after noticing a stable working preference, trait, expertise, or working style. The observation stays pending until a human accepts it via "buddy user-model". Scope is working preferences ONLY — never record health, finances, relationships, or credentials.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['preference', 'trait', 'expertise', 'working-style'],
          description: 'Observation kind',
        },
        content: {
          type: 'string',
          description: 'The observation about the user (working preferences only)',
        },
        confidence: {
          type: 'number',
          description: 'Optional 0..1 confidence in the observation',
        },
        note: {
          type: 'string',
          description: 'Optional provenance note (what prompted the observation)',
        },
      },
      required: ['kind', 'content'],
    },
  },
};

export const USER_MODEL_RECALL_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'user_model_recall',
    description:
      'Recall what is known about the user (accepted observations only) to tailor your approach. Optionally filter by kind or a keyword query. Read-only: never proposes or writes observations.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['preference', 'trait', 'expertise', 'working-style'],
          description: 'Optional: filter to a specific observation kind',
        },
        query: {
          type: 'string',
          description: 'Optional keyword to filter accepted observations',
        },
      },
      required: [],
    },
  },
};

// ============================================================================
// Browser Operator (live-web session proposal)
// ============================================================================

export const BROWSER_OPERATOR_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'browser_operator',
    description:
      'Propose a consent-gated Browser Operator session for a live web goal that web_search/web_fetch cannot satisfy (interaction, login-gated, multi-step). Returns a reviewable plan — action log, consent scopes, stop control, proof export — WITHOUT launching a browser. Resolve and pass sourceUrl for an executable runtime; drafts without it remain review-only. The operator reviews and runs it; local/interactive/login-gated sessions require explicit consent. Prefer web_search/web_fetch for read-only lookups; use this only when a live, interactive browser session is genuinely needed.',
    parameters: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description:
            'What the browser session should accomplish, e.g. "log into the dashboard and export the monthly report".',
        },
        query: {
          type: 'string',
          description: 'Optional search query seed. Defaults to the goal.',
        },
        sourceUrl: {
          type: 'string',
          description:
            'Explicit credential-free HTTP(S) starting URL. Required by the executable runtime; resolve it with web_search first when unknown.',
        },
        intent: {
          type: 'string',
          enum: ['research', 'prospecting', 'profile_enrichment', 'page_verification', 'lead_discovery'],
          description: 'Plan intent. Defaults to research.',
        },
        mode: {
          type: 'string',
          enum: ['isolated', 'local'],
          description:
            'Browser surface. "isolated" (default) is headless; "local" opens a fresh visible dedicated browser owned by Code Buddy. Attaching existing logged-in tabs is not yet supported.',
        },
        requiresInteraction: {
          type: 'boolean',
          description:
            'Set true when the goal needs clicking/typing (mutating interaction). Adds an interact stage and consent scope.',
        },
        interactionInstruction: {
          type: 'string',
          description:
            'Exact single visible browser action to bind to the reviewed plan and confirm again immediately before execution. Defaults to goal.',
        },
        allowLoginPages: {
          type: 'boolean',
          description: 'Set true when the session may pass authenticated/login pages. Requires consent.',
        },
        expectedText: {
          type: 'string',
          description: 'Optional text whose presence proves the goal was reached (verification evidence).',
        },
        maxPages: {
          type: 'number',
          description: 'Maximum pages the session may visit. Defaults to 5.',
        },
      },
      required: ['goal'],
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
  EXTENSION_FORGE_TOOL,
  SKILL_DISCOVER_TOOL,
  SKILLS_LIST_TOOL,
  SKILL_VIEW_TOOL,
  SKILL_MANAGE_TOOL,
  DEVICE_MANAGE_TOOL,
  SPAWN_PARALLEL_AGENTS_TOOL,
  REMEMBER_TOOL,
  RECALL_TOOL,
  FORGET_TOOL,
  RELATIONSHIP_CONTEXT_TOOL,
  LEAD_SCOUT_PLAN_TOOL,
  LEAD_SCOUT_RUN_TOOL,
  LEAD_SCOUT_ENRICHMENT_PLAN_TOOL,
  LEAD_SCOUT_LESSON_CANDIDATES_TOOL,
  LESSONS_ADD_TOOL,
  LESSONS_PROPOSE_TOOL,
  LESSONS_SEARCH_TOOL,
  LESSONS_LIST_TOOL,
  LESSONS_GRAPH_TOOL,
  USER_MODEL_OBSERVE_TOOL,
  USER_MODEL_RECALL_TOOL,
  BROWSER_OPERATOR_TOOL,
  TASK_VERIFY_TOOL,
];
