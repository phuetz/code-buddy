/**
 * TOOLS.md Generator
 *
 * Auto-generates .codebuddy/TOOLS.md from the tool registry,
 * documenting all available tools with descriptions and parameters.
 * Regenerated on startup if tools have changed.
 */

import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { logger } from '../utils/logger.js';
import type { CodeBuddyTool, JsonSchemaProperty } from '../codebuddy/client.js';
import type { ToolCategory, ToolMetadata } from './types.js';

/**
 * Human-readable display names for tool categories.
 */
const CATEGORY_DISPLAY_NAMES: Record<ToolCategory, string> = {
  file_read: 'File Reading',
  file_write: 'File Writing',
  file_search: 'File Search',
  system: 'System Operations',
  git: 'Git Operations',
  web: 'Web Operations',
  planning: 'Planning & Tasks',
  media: 'Media',
  document: 'Documents',
  utility: 'Utility',
  codebase: 'Codebase Analysis',
  mcp: 'MCP (External)',
};

/**
 * Stable ordering for categories in the generated document.
 */
const CATEGORY_ORDER: ToolCategory[] = [
  'file_read',
  'file_write',
  'file_search',
  'system',
  'git',
  'web',
  'planning',
  'codebase',
  'media',
  'document',
  'utility',
  'mcp',
];

/**
 * Format a single JSON-schema property as a Markdown parameter line.
 */
function formatParam(name: string, prop: JsonSchemaProperty, isRequired: boolean): string {
  const parts: string[] = [];
  parts.push(`- \`${name}\``);

  const qualifiers: string[] = [];
  if (prop.type) qualifiers.push(prop.type);
  if (isRequired) qualifiers.push('required');
  if (qualifiers.length > 0) {
    parts.push(`(${qualifiers.join(', ')})`);
  }

  if (prop.description) {
    // Collapse multi-line descriptions to a single line for the table
    const desc = prop.description.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
    parts.push(`- ${desc}`);
  }

  if (prop.enum && prop.enum.length > 0) {
    parts.push(`  Values: ${prop.enum.map(v => `\`${v}\``).join(', ')}`);
  }

  if (prop.default !== undefined) {
    parts.push(`  Default: \`${String(prop.default)}\``);
  }

  return parts.join(' ');
}

/**
 * Render a single tool as Markdown.
 */
function renderTool(tool: CodeBuddyTool, meta: ToolMetadata | undefined): string {
  const fn = tool.function;
  const lines: string[] = [];

  lines.push(`### ${fn.name}`);
  lines.push('');

  // Use metadata description if shorter / cleaner; fall back to tool definition
  const desc = meta?.description || fn.description || '';
  // Take only the first sentence / line for the summary
  const summary = desc.split('\n')[0].trim();
  lines.push(summary);
  lines.push('');

  const props = fn.parameters?.properties;
  const required = new Set(fn.parameters?.required ?? []);

  if (props && Object.keys(props).length > 0) {
    lines.push('**Parameters:**');
    for (const [name, prop] of Object.entries(props)) {
      lines.push(formatParam(name, prop, required.has(name)));
    }
    lines.push('');
  }

  if (meta?.keywords && meta.keywords.length > 0) {
    lines.push(`**Keywords:** ${meta.keywords.join(', ')}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

/**
 * Build the full Markdown content from the tool definitions and metadata.
 */
function buildMarkdown(
  tools: CodeBuddyTool[],
  metadataMap: Map<string, ToolMetadata>,
): string {
  const lines: string[] = [];

  lines.push('# Available Tools');
  lines.push('');
  lines.push('> Auto-generated tool reference for CodeBuddy. Do not edit manually.');
  lines.push(`> Generated: ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');

  // Group tools by category
  const grouped = new Map<ToolCategory, { tool: CodeBuddyTool; meta: ToolMetadata | undefined }[]>();

  for (const tool of tools) {
    const meta = metadataMap.get(tool.function.name);
    const category: ToolCategory = meta?.category ?? 'utility';
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category)!.push({ tool, meta });
  }

  // Table of contents
  lines.push('## Table of Contents');
  lines.push('');
  for (const cat of CATEGORY_ORDER) {
    const items = grouped.get(cat);
    if (!items || items.length === 0) continue;
    const displayName = CATEGORY_DISPLAY_NAMES[cat] || cat;
    const anchor = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
    lines.push(`- [${displayName}](#${anchor}) (${items.length})`);
  }
  lines.push('');

  // Emit each category
  for (const cat of CATEGORY_ORDER) {
    const items = grouped.get(cat);
    if (!items || items.length === 0) continue;

    const displayName = CATEGORY_DISPLAY_NAMES[cat] || cat;
    lines.push(`## ${displayName}`);
    lines.push('');

    // Sort tools within a category by priority (desc), then name (asc)
    items.sort((a, b) => {
      const pa = a.meta?.priority ?? 5;
      const pb = b.meta?.priority ?? 5;
      if (pb !== pa) return pb - pa;
      return a.tool.function.name.localeCompare(b.tool.function.name);
    });

    for (const { tool, meta } of items) {
      lines.push(renderTool(tool, meta));
    }
  }

  // Append any tools that didn't match a known category
  Array.from(grouped.entries()).forEach(([cat, items]) => {
    if (CATEGORY_ORDER.includes(cat)) return;
    if (items.length === 0) return;
    const displayName = CATEGORY_DISPLAY_NAMES[cat as ToolCategory] || cat;
    lines.push(`## ${displayName}`);
    lines.push('');
    for (const { tool, meta } of items) {
      lines.push(renderTool(tool, meta));
    }
  });

  lines.push(`_Total tools: ${tools.length}_`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Compute a short content hash for change detection.
 */
function computeHash(tools: CodeBuddyTool[]): string {
  const payload = tools.map(t => {
    const fn = t.function;
    return `${fn.name}:${fn.description}:${JSON.stringify(fn.parameters)}`;
  }).join('|');
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Extract the hash stored in a previously generated TOOLS.md.
 * The hash is stored as an HTML comment on the last line.
 */
function extractStoredHash(content: string): string | null {
  const match = content.match(/<!-- hash:([a-f0-9]+) -->/);
  return match ? match[1] : null;
}

/**
 * Generate .codebuddy/TOOLS.md from the tool registry.
 *
 * Only regenerates if the file is missing or tools have changed
 * (compared via a content hash).
 */
export async function generateToolsMd(): Promise<void> {
  try {
    // Lazy-import to avoid pulling tool definitions into the critical startup path
    const { initializeToolRegistry } = await import('../codebuddy/tools.js');
    const { getToolRegistry } = await import('./registry.js');
    const { TOOL_METADATA } = await import('./metadata.js');

    // Ensure registry is populated
    initializeToolRegistry();

    const registry = getToolRegistry();
    const tools = registry.getEnabledTools();

    if (tools.length === 0) {
      logger.debug('TOOLS.md generation skipped: no tools registered');
      return;
    }

    // Compute hash for change detection
    const hash = computeHash(tools);

    // Resolve output path
    const dir = join(process.cwd(), '.codebuddy');
    const filePath = join(dir, 'TOOLS.md');

    // Check if regeneration is needed
    if (existsSync(filePath)) {
      try {
        const existing = await readFile(filePath, 'utf-8');
        const storedHash = extractStoredHash(existing);
        if (storedHash === hash) {
          logger.debug('TOOLS.md is up to date, skipping regeneration');
          return;
        }
      } catch (_err) {
        // File exists but couldn't be read - regenerate
      }
    }

    // Build metadata map
    const metadataMap = new Map<string, ToolMetadata>(
      TOOL_METADATA.map(m => [m.name, m])
    );

    // Generate markdown
    const markdown = buildMarkdown(tools, metadataMap);

    // Append hash as HTML comment for change detection
    const content = markdown + `<!-- hash:${hash} -->\n`;

    // Ensure directory exists
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    await writeFile(filePath, content, 'utf-8');
    logger.debug(`TOOLS.md generated with ${tools.length} tools`);
  } catch (err) {
    // Never let TOOLS.md generation break startup
    logger.debug('TOOLS.md generation failed', { error: err });
  }
}
