/**
 * Knowledge Tool Adapters
 *
 * ITool-compliant adapters exposing the KnowledgeManager to the agent:
 *  - knowledge_search: semantic keyword search across loaded knowledge bases
 *  - knowledge_add: create a new knowledge entry from within a session
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { getKnowledgeManager } from '../../knowledge/knowledge-manager.js';

// ============================================================================
// knowledge_search
// ============================================================================

export class KnowledgeSearchTool implements ITool {
  readonly name = 'knowledge_search';
  readonly description =
    'Search the agent knowledge base for domain knowledge, conventions, or procedures. Returns ranked excerpts from loaded Knowledge.md files.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const km = getKnowledgeManager();

    if (!km.isLoaded) {
      await km.load();
    }

    const query = input.query as string;
    const limit = (input.limit as number | undefined) ?? 5;
    const scope = input.scope as string | undefined;

    const results = km.search(query, limit);

    if (results.length === 0) {
      // Try to give context about what's loaded
      const all = km.list();
      if (all.length === 0) {
        return {
          success: true,
          output:
            'No knowledge entries loaded. Create a Knowledge.md file in the project root or ~/.codebuddy/knowledge/ to add domain knowledge.',
        };
      }
      return {
        success: true,
        output: `No matches found for "${query}". Available knowledge entries: ${all.map(e => e.title).join(', ')}`,
      };
    }

    const lines: string[] = [`Found ${results.length} knowledge entries for "${query}":\n`];

    for (const { entry, score, excerpt } of results) {
      lines.push(`### ${entry.title} (score: ${score.toFixed(2)}, source: ${entry.source})`);
      if (entry.tags.length > 0) {
        lines.push(`Tags: ${entry.tags.join(', ')}`);
      }
      lines.push('');
      lines.push(excerpt);
      lines.push('');
    }

    return { success: true, output: lines.join('\n') };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Keywords or phrase to search for in knowledge bases',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 5)',
          },
          scope: {
            type: 'string',
            description: 'Filter by agent mode scope (e.g. "code", "review")',
          },
        },
        required: ['query'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.query !== 'string' || !data.query.trim()) {
      return { valid: false, errors: ['query must be a non-empty string'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['knowledge', 'search', 'conventions', 'docs', 'domain'],
      priority: 4,
      requiresConfirmation: false,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// knowledge_add
// ============================================================================

export class KnowledgeAddTool implements ITool {
  readonly name = 'knowledge_add';
  readonly description =
    'Add a new entry to the user-level knowledge base (~/.codebuddy/knowledge/). Use this to persist learned conventions, procedures, or domain knowledge across sessions.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const km = getKnowledgeManager();

    const title = input.title as string;
    const content = input.content as string;
    const tags = (input.tags as string[] | undefined) ?? [];
    const scope = (input.scope as string[] | undefined) ?? [];

    try {
      const filePath = await km.add(title, content, tags, scope);
      return {
        success: true,
        output: `Knowledge entry "${title}" saved to ${filePath}`,
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to save knowledge: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
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
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.title !== 'string' || !data.title.trim()) {
      return { valid: false, errors: ['title must be a non-empty string'] };
    }
    if (typeof data.content !== 'string' || !data.content.trim()) {
      return { valid: false, errors: ['content must be a non-empty string'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['knowledge', 'add', 'save', 'persist', 'conventions'],
      priority: 3,
      requiresConfirmation: false,
      modifiesFiles: true,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// AskHuman ITool adapter
// ============================================================================

import { getAskHumanTool } from '../ask-human-tool.js';

export class AskHumanExecuteTool implements ITool {
  readonly name = 'ask_human';
  readonly description =
    "Pause execution and ask the user a clarifying question. Use when you need information that cannot be inferred from context, or when multiple interpretations exist. Returns the user's response.";

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await getAskHumanTool().execute({
      question: input.question as string,
      options: input.options as string[] | undefined,
      timeout: input.timeout as number | undefined,
      default: input.default as string | undefined,
    });
  }

  getSchema(): ToolSchema {
    return getAskHumanTool().getSchema() as ToolSchema;
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.question !== 'string' || !data.question.trim()) {
      return { valid: false, errors: ['question must be a non-empty string'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['ask', 'human', 'input', 'clarify', 'pause', 'question'],
      priority: 6,
      requiresConfirmation: false,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// CreateSkill ITool adapter
// ============================================================================

import { getCreateSkillTool } from '../create-skill-tool.js';

export class CreateSkillExecuteTool implements ITool {
  readonly name = 'create_skill';
  readonly description =
    'Create a new SKILL.md file in the workspace skills directory. Use this to codify reusable workflows or procedures for future sessions. Skills are hot-reloaded immediately.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await getCreateSkillTool().execute({
      name: input.name as string,
      description: input.description as string,
      body: input.body as string,
      tags: input.tags as string[] | undefined,
      env: input.env as Record<string, string> | undefined,
      requires: input.requires as string[] | undefined,
      overwrite: input.overwrite as boolean | undefined,
    });
  }

  getSchema(): ToolSchema {
    return getCreateSkillTool().getSchema() as ToolSchema;
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.name !== 'string' || !data.name.trim()) {
      return { valid: false, errors: ['name is required'] };
    }
    if (typeof data.description !== 'string' || !data.description.trim()) {
      return { valid: false, errors: ['description is required'] };
    }
    if (typeof data.body !== 'string' || !data.body.trim()) {
      return { valid: false, errors: ['body is required'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['skill', 'create', 'write', 'self-author', 'extension', 'workflow'],
      priority: 3,
      requiresConfirmation: false,
      modifiesFiles: true,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createKnowledgeTools(): ITool[] {
  return [
    new KnowledgeSearchTool(),
    new KnowledgeAddTool(),
    new AskHumanExecuteTool(),
    new CreateSkillExecuteTool(),
  ];
}
