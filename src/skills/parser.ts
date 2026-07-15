/**
 * Skill Parser
 *
 * Parses SKILL.md files with YAML frontmatter and markdown body.
 * Extracts metadata, examples, steps, and tool invocations.
 */

import * as yaml from 'yaml';
import type {
  Skill,
  SkillMetadata,
  SkillContent,
  SkillExample,
  SkillStep,
  SkillToolInvocation,
  SkillCodeBlock,
  SkillTier,
} from './types.js';

// ============================================================================
// Parser Constants
// ============================================================================

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
const HEADING_REGEX = /^(#{1,6})\s+(.+)$/gm;
const CODE_BLOCK_REGEX = /```(\w+)?\s*(?:\[([^\]]+)\])?\r?\n([\s\S]*?)```/g;
const LIST_ITEM_REGEX = /^[-*]\s+(.+)$/gm;
const NUMBERED_LIST_REGEX = /^\d+\.\s+(.+)$/gm;

// ============================================================================
// Main Parser Function
// ============================================================================

/**
 * Parse a SKILL.md file content
 */
export function parseSkillFile(
  content: string,
  sourcePath: string,
  tier: SkillTier
): Skill {
  // Extract frontmatter and body
  const match = content.match(FRONTMATTER_REGEX);

  if (!match) {
    throw new Error(`Invalid SKILL.md format: missing YAML frontmatter in ${sourcePath}`);
  }

  const [, frontmatterYaml, markdownBody] = match;

  // Parse metadata
  const metadata = parseMetadata(frontmatterYaml ?? '', sourcePath);

  // Parse content
  const skillContent = parseContent(markdownBody ?? '');

  return {
    metadata,
    content: skillContent,
    sourcePath,
    tier,
    loadedAt: new Date(),
    enabled: true,
  };
}

// ============================================================================
// Metadata Parser
// ============================================================================

/**
 * Parse YAML frontmatter into metadata
 */
function parseMetadata(yamlContent: string, sourcePath: string): SkillMetadata {
  try {
    const parsed = yaml.parse(yamlContent) as Record<string, unknown>;

    if (!parsed.name || typeof parsed.name !== 'string') {
      throw new Error('Skill name is required');
    }

    if (!parsed.description || typeof parsed.description !== 'string') {
      throw new Error('Skill description is required');
    }

    // Parse allowed-tools (Standard compatibility)
    let allowedTools = parsed['allowed-tools'];
    if (typeof allowedTools === 'string') {
      // Native Engine uses comma separated values like: Bash(code-explorer *), Read, Grep, Glob
      const toolsList = allowedTools.split(',').map(t => t.trim());

      const mappedTools: string[] = [];
      for (const t of toolsList) {
         if (t.startsWith('Bash(')) mappedTools.push('run_shell_command');
         else if (t.toLowerCase() === 'read') mappedTools.push('read_file');
         else if (t.toLowerCase() === 'grep') mappedTools.push('grep_search');
         else if (t.toLowerCase() === 'glob') mappedTools.push('glob_search');
         else if (t.toLowerCase() === 'replace') mappedTools.push('edit_file_lines');
         else mappedTools.push(t);
      }

      // Dedup and set in requires
      const dedupedTools = [...new Set(mappedTools)];
      if (!parsed.requires) parsed.requires = {};
      (parsed.requires as any).tools = dedupedTools;
    }

    return {
      name: parsed.name,
      description: parsed.description,
      version: parsed.version as string | undefined,
      author: parsed.author as string | undefined,
      tags: parsed.tags as string[] | undefined,
      requires: parsed.requires as SkillMetadata['requires'],
      config: parsed.config as SkillMetadata['config'],
      nativeEngine: parsed.nativeEngine as SkillMetadata['nativeEngine'],
      // CC11: context fork and disable-model-invocation
      contextFork: parsed.context === 'fork' || parsed.contextFork === true,
      disableModelInvocation: parsed['disable-model-invocation'] === true || parsed.disableModelInvocation === true,
      pinned: parsed.pinned === true,
      imported: parsed.imported === true,
      source: parsed.source as string | undefined,
      exchange: parsed.exchange === true,
      installedAt: parsed.installedAt as string | undefined,
    };  } catch (error) {
    throw new Error(
      `Failed to parse YAML frontmatter in ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ============================================================================
// Content Parser
// ============================================================================

/**
 * Parse markdown body into structured content
 */
function parseContent(markdown: string): SkillContent {
  const content: SkillContent = {
    description: '',
    rawMarkdown: markdown,
  };

  // Split by headings
  const sections = splitByHeadings(markdown);

  for (const section of sections) {
    const lowerHeading = section.heading.toLowerCase();

    if (!section.heading || lowerHeading === 'description' || lowerHeading === 'overview') {
      // Main description (content before first heading or under Description)
      content.description = section.content.trim();
    } else if (lowerHeading === 'usage' || lowerHeading === 'when to use') {
      content.usage = section.content.trim();
    } else if (lowerHeading === 'examples' || lowerHeading === 'example requests') {
      content.examples = parseExamples(section.content);
    } else if (lowerHeading === 'steps' || lowerHeading === 'implementation') {
      content.steps = parseSteps(section.content);
    } else if (lowerHeading === 'tools' || lowerHeading === 'tool invocations') {
      content.tools = parseToolInvocations(section.content);
    }
  }

  // Extract code blocks from entire content
  content.codeBlocks = parseCodeBlocks(markdown);

  return content;
}

// ============================================================================
// Section Parsers
// ============================================================================

interface Section {
  heading: string;
  level: number;
  content: string;
}

/**
 * Split markdown by headings
 */
function splitByHeadings(markdown: string): Section[] {
  const sections: Section[] = [];
  const lines = markdown.split('\n');

  let currentSection: Section = { heading: '', level: 0, content: '' };
  let contentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      // Save previous section
      if (contentLines.length > 0 || currentSection.heading) {
        currentSection.content = contentLines.join('\n');
        sections.push(currentSection);
      }

      // Start new section
      currentSection = {
        heading: (headingMatch[2] ?? '').trim(),
        level: (headingMatch[1] ?? '').length,
        content: '',
      };
      contentLines = [];
    } else {
      contentLines.push(line);
    }
  }

  // Save last section
  currentSection.content = contentLines.join('\n');
  sections.push(currentSection);

  return sections;
}

/**
 * Parse examples from content
 */
function parseExamples(content: string): SkillExample[] {
  const examples: SkillExample[] = [];
  const lines = content.split('\n');

  let currentExample: Partial<SkillExample> = {};

  for (const line of lines) {
    const trimmed = line.trim();

    // List item format: "- User request"
    const listMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      if (currentExample.request) {
        examples.push({ request: currentExample.request, response: currentExample.response });
      }
      currentExample = { request: listMatch[1] };
      continue;
    }

    // Quoted format: "> Response"
    const quoteMatch = trimmed.match(/^>\s+(.+)$/);
    if (quoteMatch && currentExample.request) {
      currentExample.response = quoteMatch[1];
      continue;
    }

    // "Request:" / "Response:" format
    if (trimmed.toLowerCase().startsWith('request:')) {
      if (currentExample.request) {
        examples.push({ request: currentExample.request, response: currentExample.response });
      }
      currentExample = { request: trimmed.slice(8).trim() };
    } else if (trimmed.toLowerCase().startsWith('response:') && currentExample.request) {
      currentExample.response = trimmed.slice(9).trim();
    }
  }

  // Add last example
  if (currentExample.request) {
    examples.push({ request: currentExample.request, response: currentExample.response });
  }

  return examples;
}

/**
 * Parse implementation steps
 */
function parseSteps(content: string): SkillStep[] {
  const steps: SkillStep[] = [];
  const lines = content.split('\n');

  let index = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Numbered list: "1. Do something"
    const numberedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      const step = parseStepLine(numberedMatch[1] ?? '', index++);
      steps.push(step);
      continue;
    }

    // Bullet list with step marker: "- **Step 1**: Do something"
    const bulletMatch = trimmed.match(/^[-*]\s+\*?\*?(?:Step\s+\d+)?:?\*?\*?\s*(.+)$/i);
    if (bulletMatch) {
      const step = parseStepLine(bulletMatch[1] ?? '', index++);
      steps.push(step);
    }
  }

  return steps;
}

/**
 * Parse a single step line
 */
function parseStepLine(text: string, index: number): SkillStep {
  const step: SkillStep = {
    index,
    description: text,
  };

  // Check for tool reference: "Use `tool_name` to..."
  const toolMatch = text.match(/[Uu]se\s+`(\w+)`/);
  if (toolMatch) {
    step.tool = toolMatch[1];
  }

  // Check for condition: "If X, then Y"
  const conditionMatch = text.match(/^[Ii]f\s+(.+?),\s+(?:then\s+)?(.+)$/);
  if (conditionMatch) {
    step.condition = conditionMatch[1];
    step.description = conditionMatch[2] ?? '';
  }

  return step;
}

/**
 * Parse tool invocations
 */
function parseToolInvocations(content: string): SkillToolInvocation[] {
  const tools: SkillToolInvocation[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Format: "- `tool_name`: Description"
    const toolMatch = trimmed.match(/^[-*]\s+`(\w+)`(?:\s*:\s*(.+))?$/);
    if (toolMatch) {
      tools.push({
        name: toolMatch[1] ?? '',
        description: toolMatch[2] || undefined,
      });
      continue;
    }

    // Format: "- tool_name(arg1, arg2): Description"
    const funcMatch = trimmed.match(/^[-*]\s+(\w+)\(([^)]*)\)(?:\s*:\s*(.+))?$/);
    if (funcMatch) {
      const args = parseToolArgs(funcMatch[2] ?? '');
      tools.push({
        name: funcMatch[1] ?? '',
        args,
        description: funcMatch[3] || undefined,
      });
    }
  }

  return tools;
}

/**
 * Parse tool arguments from string
 */
function parseToolArgs(argsStr: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  if (!argsStr.trim()) {
    return args;
  }

  // Simple comma-separated key=value or just values
  const parts = argsStr.split(',').map(s => s.trim());

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined) continue;
    const eqIndex = part.indexOf('=');

    if (eqIndex > 0) {
      const key = part.slice(0, eqIndex).trim();
      const value = part.slice(eqIndex + 1).trim();
      args[key] = parseValue(value);
    } else {
      // Positional argument
      args[`arg${i}`] = parseValue(part);
    }
  }

  return args;
}

/**
 * Parse a value string
 */
function parseValue(value: string): unknown {
  // Remove quotes
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Number
  const num = Number(value);
  if (!isNaN(num)) return num;

  // Template variable: {{variable}}
  if (value.startsWith('{{') && value.endsWith('}}')) {
    return value; // Keep as template
  }

  return value;
}

/**
 * Parse code blocks from markdown
 */
function parseCodeBlocks(markdown: string): SkillCodeBlock[] {
  const blocks: SkillCodeBlock[] = [];
  const regex = /```(\w+)?\s*(?:\[([^\]]+)\])?\r?\n([\s\S]*?)```/g;

  let match;
  while ((match = regex.exec(markdown)) !== null) {
    blocks.push({
      language: match[1] || 'text',
      label: match[2] || undefined,
      code: (match[3] ?? '').trim(),
    });
  }

  return blocks;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a parsed skill
 */
export function validateSkill(skill: Skill): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required metadata
  if (!skill.metadata.name) {
    errors.push('Skill name is required');
  }

  if (!skill.metadata.description) {
    errors.push('Skill description is required');
  }

  // Name format
  if (skill.metadata.name && !/^[a-z0-9-]+$/.test(skill.metadata.name)) {
    errors.push('Skill name must be lowercase alphanumeric with hyphens');
  }

  // Version format (if provided)
  if (skill.metadata.version && !/^\d+\.\d+\.\d+/.test(skill.metadata.version)) {
    errors.push('Version must be semver format (e.g., 1.0.0)');
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serialize a skill back to SKILL.md format
 */
export function serializeSkill(skill: Skill): string {
  const lines: string[] = [];

  // Frontmatter
  lines.push('---');
  lines.push(yaml.stringify(skill.metadata).trim());
  lines.push('---');
  lines.push('');

  // Description
  if (skill.content.description) {
    lines.push(skill.content.description);
    lines.push('');
  }

  // Usage
  if (skill.content.usage) {
    lines.push('## Usage');
    lines.push('');
    lines.push(skill.content.usage);
    lines.push('');
  }

  // Examples
  if (skill.content.examples && skill.content.examples.length > 0) {
    lines.push('## Examples');
    lines.push('');
    for (const example of skill.content.examples) {
      lines.push(`- ${example.request}`);
      if (example.response) {
        lines.push(`  > ${example.response}`);
      }
    }
    lines.push('');
  }

  // Steps
  if (skill.content.steps && skill.content.steps.length > 0) {
    lines.push('## Steps');
    lines.push('');
    for (const step of skill.content.steps) {
      lines.push(`${step.index + 1}. ${step.description}`);
    }
    lines.push('');
  }

  // Tools
  if (skill.content.tools && skill.content.tools.length > 0) {
    lines.push('## Tools');
    lines.push('');
    for (const tool of skill.content.tools) {
      if (tool.description) {
        lines.push(`- \`${tool.name}\`: ${tool.description}`);
      } else {
        lines.push(`- \`${tool.name}\``);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export default parseSkillFile;
