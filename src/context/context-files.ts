/**
 * Context Files - Automatic Project Context (Gemini CLI inspired)
 *
 * Automatically loads context from special files:
 * - .grok/CONTEXT.md - Project-specific context
 * - GROK.md - Alternative location (project root)
 * - ~/.grok/CONTEXT.md - Global user context
 *
 * These files are read at startup and injected into the system prompt.
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';

export interface ContextFile {
  path: string;
  content: string;
  source: 'project' | 'global';
  priority: number; // Lower = higher priority
}

export interface LoadedContext {
  files: ContextFile[];
  combinedContent: string;
  totalSize: number;
}

/**
 * Context file locations in order of priority
 */
const CONTEXT_FILE_LOCATIONS = [
  { pattern: '.grok/CONTEXT.md', source: 'project' as const, priority: 1 },
  { pattern: 'GROK.md', source: 'project' as const, priority: 2 },
  { pattern: '.grok/context.md', source: 'project' as const, priority: 3 },
  { pattern: 'CLAUDE.md', source: 'project' as const, priority: 4 }, // Compatibility
];

const GLOBAL_CONTEXT_FILE = {
  pattern: path.join(os.homedir(), '.grok', 'CONTEXT.md'),
  source: 'global' as const,
  priority: 10,
};

/**
 * Load context files from project directory
 */
export async function loadProjectContextFiles(
  projectDir: string = process.cwd()
): Promise<ContextFile[]> {
  const files: ContextFile[] = [];

  // Load project-specific context files
  for (const location of CONTEXT_FILE_LOCATIONS) {
    const filePath = path.join(projectDir, location.pattern);
    try {
      if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath, 'utf-8');
        files.push({
          path: filePath,
          content,
          source: location.source,
          priority: location.priority,
        });
      }
    } catch {
      // Ignore read errors
    }
  }

  // Load global context file
  try {
    if (await fs.pathExists(GLOBAL_CONTEXT_FILE.pattern)) {
      const content = await fs.readFile(GLOBAL_CONTEXT_FILE.pattern, 'utf-8');
      files.push({
        path: GLOBAL_CONTEXT_FILE.pattern,
        content,
        source: GLOBAL_CONTEXT_FILE.source,
        priority: GLOBAL_CONTEXT_FILE.priority,
      });
    }
  } catch {
    // Ignore read errors
  }

  // Sort by priority (lower = higher priority)
  return files.sort((a, b) => a.priority - b.priority);
}

/**
 * Load and combine all context files
 */
export async function loadContext(
  projectDir: string = process.cwd()
): Promise<LoadedContext> {
  const files = await loadProjectContextFiles(projectDir);

  if (files.length === 0) {
    return {
      files: [],
      combinedContent: '',
      totalSize: 0,
    };
  }

  // Combine content with headers
  const sections = files.map(f => {
    const sourceLabel = f.source === 'global' ? '(global)' : '(project)';
    const fileName = path.basename(f.path);
    return `<!-- Context from ${fileName} ${sourceLabel} -->\n${f.content}`;
  });

  const combinedContent = sections.join('\n\n---\n\n');

  return {
    files,
    combinedContent,
    totalSize: combinedContent.length,
  };
}

/**
 * Format context for inclusion in system prompt
 */
export function formatContextForPrompt(context: LoadedContext): string {
  if (!context.combinedContent) {
    return '';
  }

  return `<project_context>
${context.combinedContent}
</project_context>`;
}

/**
 * Initialize context file in project
 */
export async function initContextFile(
  projectDir: string = process.cwd()
): Promise<string> {
  const contextDir = path.join(projectDir, '.grok');
  const contextFile = path.join(contextDir, 'CONTEXT.md');

  await fs.ensureDir(contextDir);

  if (await fs.pathExists(contextFile)) {
    return contextFile; // Already exists
  }

  const template = `# Project Context

This file is automatically loaded by Grok CLI to provide project context.

## Project Overview

<!-- Describe your project here -->

## Architecture

<!-- Key architectural decisions -->

## Conventions

<!-- Coding conventions and patterns -->

## Important Files

<!-- Key files and their purposes -->

## Common Tasks

<!-- How to build, test, deploy -->
`;

  await fs.writeFile(contextFile, template, 'utf-8');
  return contextFile;
}

/**
 * Check if context files exist
 */
export async function hasContextFiles(
  projectDir: string = process.cwd()
): Promise<boolean> {
  const files = await loadProjectContextFiles(projectDir);
  return files.length > 0;
}

/**
 * Get context file summary for display
 */
export function formatContextSummary(context: LoadedContext): string {
  if (context.files.length === 0) {
    return 'No context files found';
  }

  const lines = ['Context files loaded:'];
  for (const file of context.files) {
    const size = Math.round(file.content.length / 1024);
    const sourceLabel = file.source === 'global' ? '(global)' : '';
    lines.push(`  ${path.basename(file.path)} ${sourceLabel} - ${size}KB`);
  }
  lines.push(`  Total: ${Math.round(context.totalSize / 1024)}KB`);

  return lines.join('\n');
}
