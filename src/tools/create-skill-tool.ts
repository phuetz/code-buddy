/**
 * CreateSkill Tool (OpenClaw self-authoring inspired)
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
 *   .codebuddy/skills/workspace/<slug>/SKILL.md
 *
 * The tool generates valid SKILL.md frontmatter and validates that
 * the slug does not already exist before writing.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import type { ToolResult } from '../types/index.js';
import { validateGeneratedCode, formatValidationReport } from '../security/code-validator.js';

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
  private get workspaceDir(): string {
    return path.join(process.cwd(), '.codebuddy', 'skills', 'workspace');
  }

  async execute(input: CreateSkillInput): Promise<ToolResult> {
    const {
      name,
      description,
      body,
      tags = [],
      env = {},
      requires = [],
      overwrite = false,
    } = input;

    if (!name?.trim()) {
      return { success: false, error: 'name is required' };
    }
    if (!description?.trim()) {
      return { success: false, error: 'description is required' };
    }
    if (!body?.trim()) {
      return { success: false, error: 'body is required' };
    }

    // Derive a filesystem-safe slug
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const skillDir = path.join(this.workspaceDir, slug);
    const skillFile = path.join(skillDir, 'SKILL.md');

    // Check for existing skill
    if (existsSync(skillFile) && !overwrite) {
      return {
        success: false,
        error: `Skill "${slug}" already exists. Set overwrite: true to replace it.`,
      };
    }

    // Build YAML frontmatter
    const fm: string[] = ['---', `name: ${name}`, `version: 1.0.0`, `description: ${description}`];

    if (tags.length > 0) {
      fm.push(`tags: [${tags.join(', ')}]`);
    }

    if (Object.keys(env).length > 0) {
      fm.push('env:');
      for (const [k, v] of Object.entries(env)) {
        fm.push(`  ${k}: ${v}`);
      }
    }

    if (requires.length > 0) {
      fm.push(`requires: [${requires.join(', ')}]`);
    }

    fm.push('---');

    const skillContent = `${fm.join('\n')}\n\n${body.trim()}\n`;

    // Validate skill body for security (prevent malicious code in LLM-generated skills)
    const validation = validateGeneratedCode(body);
    if (!validation.safe) {
      return {
        success: false,
        error: `Code validation failed:\n${formatValidationReport(validation)}\nSkill creation blocked for security reasons.`,
      };
    }

    // Write to disk
    try {
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(skillFile, skillContent, 'utf-8');
    } catch (err) {
      return {
        success: false,
        error: `Failed to write skill: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    return {
      success: true,
      output: [
        `✅ Skill created: ${name}`,
        `   Path: ${skillFile}`,
        `   Tags: ${tags.join(', ') || 'none'}`,
        '',
        'The skill is now available in the workspace registry.',
        'Run `buddy hub search ${name}` or `/skills` to verify.',
      ].join('\n'),
    };
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
