/**
 * CreateSkill Tool (Native Engine self-authoring inspired)
 *
 * Allows the agent to write new SKILL.md files to the workspace
 * skills directory at runtime. The SkillRegistry's hot-reload watcher
 * picks up the new file within ~250ms, making the skill immediately
 * available in subsequent turns without restart.
 *
 * This is a form of self-extension: the agent can observe what
 * commands it uses repeatedly and codify them as reusable skills.
 *
 * Skill file location:
 *   .codebuddy/skills/<authored-slug>/SKILL.md
 *
 * The tool generates valid SKILL.md frontmatter and validates that
 * the slug does not already exist before writing.
 */

import * as path from 'path';
import * as yaml from 'yaml';
import type { ToolResult } from '../types/index.js';
import { LiveSkillMutator, toAuthoredSkillName } from '../agent/self-improvement/skill-mutator.js';

export interface CreateSkillInput {
  /** Human-readable skill name (e.g. "Deploy to Railway") */
  name: string;
  /** One-sentence description for the skill index */
  description: string;
  /**
   * Full Markdown body of the skill.
   * Should describe WHEN to use the skill and HOW (step-by-step or example prompts).
   */
  body: string;
  /** Tags for hub search / filtering */
  tags?: string[];
  /** Environment variables the skill requires */
  env?: Record<string, string>;
  /** Binaries/tools the skill requires (e.g. ["docker", "kubectl"]) */
  requires?: string[];
  /** Overwrite if a skill with this name already exists */
  overwrite?: boolean;
}

export class CreateSkillTool {
  async execute(input: CreateSkillInput, cwd = process.cwd()): Promise<ToolResult> {
    try {
      for (const field of ['name', 'description', 'body'] as const) {
        if (typeof input[field] !== 'string' || !input[field].trim()) return { success: false, error: `${field} is required` };
      }
      const name = toAuthoredSkillName(input.name);
      const root = path.join(cwd, '.codebuddy', 'skills');
      // Serialize metadata, including names containing ':' or YAML control characters.
      const content = `---\n${yaml.stringify({ name, description: input.description, tags: input.tags ?? [], env: input.env ?? {}, requires: input.requires ?? [] })}---\n\n${input.body.trim()}\n`;
      new LiveSkillMutator(root).create({ name, description: input.description, content }, { overwrite: input.overwrite === true });
      return { success: true, output: `Skill created and loaded: ${name}\nPath: ${path.join(root, name, 'SKILL.md')}`, data: { name, loaded: true } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  getSchema() {
    return {
      name: 'create_skill',
      description:
        'Create a new SKILL.md file in the workspace skills directory. Use this to codify reusable workflows, idioms, or domain-specific procedures so they are available in future sessions. The skill is immediately hot-reloaded into the registry.',
      parameters: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string',
            description: 'Human-readable skill name (e.g. "Deploy to Railway")',
          },
          description: {
            type: 'string',
            description: 'One-sentence description shown in skill search results',
          },
          body: {
            type: 'string',
            description:
              'Full Markdown body: describe WHEN to use this skill and HOW (steps, examples, commands)',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for discovery (e.g. ["deploy", "devops", "railway"])',
          },
          env: {
            type: 'object',
            description:
              'Environment variables required: { "VAR_NAME": "description" }',
          },
          requires: {
            type: 'array',
            items: { type: 'string' },
            description: 'CLI tools required (e.g. ["docker", "kubectl"])',
          },
          overwrite: {
            type: 'boolean',
            description: 'Overwrite existing skill with the same name (default: false)',
          },
        },
        required: ['name', 'description', 'body'],
      },
    };
  }
}

let instance: CreateSkillTool | null = null;

export function getCreateSkillTool(): CreateSkillTool {
  if (!instance) {
    instance = new CreateSkillTool();
  }
  return instance;
}

export function resetCreateSkillTool(): void {
  instance = null;
}
