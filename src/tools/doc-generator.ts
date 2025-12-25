/**
 * Documentation Generator Tool
 *
 * Automatically generates documentation from TypeScript/JavaScript code:
 * - JSDoc extraction and parsing
 * - API documentation generation
 * - README generation
 * - Markdown output
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import fg from 'fast-glob';

export interface DocEntry {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'enum';
  description?: string;
  params?: ParamDoc[];
  returns?: ReturnDoc;
  examples?: string[];
  deprecated?: string;
  since?: string;
  see?: string[];
  file: string;
  line: number;
  exported: boolean;
  signature?: string;
}

export interface ParamDoc {
  name: string;
  type?: string;
  description?: string;
  optional?: boolean;
  defaultValue?: string;
}

export interface ReturnDoc {
  type?: string;
  description?: string;
}

export interface ModuleDoc {
  name: string;
  path: string;
  description?: string;
  entries: DocEntry[];
}

export interface GeneratedDocs {
  modules: ModuleDoc[];
  generatedAt: Date;
  totalEntries: number;
}

export interface GeneratorOptions {
  /** Root directory to scan */
  rootDir?: string;
  /** Glob patterns for files to include */
  include?: string[];
  /** Glob patterns for files to exclude */
  exclude?: string[];
  /** Only include exported items */
  exportedOnly?: boolean;
  /** Include private items (starting with _) */
  includePrivate?: boolean;
}

const DEFAULT_OPTIONS: GeneratorOptions = {
  rootDir: process.cwd(),
  include: ['src/**/*.ts', 'src/**/*.tsx'],
  exclude: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**'],
  exportedOnly: true,
  includePrivate: false,
};

/**
 * Generate documentation for a project
 */
export async function generateDocs(
  options: GeneratorOptions = {}
): Promise<GeneratedDocs> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const rootDir = opts.rootDir || process.cwd();

  // Find all source files
  const files = await fg(opts.include || [], {
    cwd: rootDir,
    ignore: opts.exclude,
    absolute: true,
  });

  const modules: ModuleDoc[] = [];

  for (const file of files) {
    const relativePath = path.relative(rootDir, file);
    const content = await fs.readFile(file, 'utf-8');
    const entries = parseFile(content, relativePath, opts);

    if (entries.length > 0) {
      modules.push({
        name: path.basename(file, path.extname(file)),
        path: relativePath,
        description: extractModuleDescription(content),
        entries,
      });
    }
  }

  // Sort modules by path
  modules.sort((a, b) => a.path.localeCompare(b.path));

  return {
    modules,
    generatedAt: new Date(),
    totalEntries: modules.reduce((sum, m) => sum + m.entries.length, 0),
  };
}

/**
 * Parse a single file for documentation entries
 */
function parseFile(
  content: string,
  filePath: string,
  opts: GeneratorOptions
): DocEntry[] {
  const entries: DocEntry[] = [];
  const lines = content.split('\n');

  let currentJsdoc: string[] = [];
  let inJsdoc = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track JSDoc blocks
    if (trimmed.startsWith('/**')) {
      inJsdoc = true;
      currentJsdoc = [trimmed];
    } else if (inJsdoc) {
      currentJsdoc.push(trimmed);
      if (trimmed.endsWith('*/')) {
        inJsdoc = false;
      }
    } else {
      // Check for declarations
      const entry = parseDeclaration(line, currentJsdoc.join('\n'), filePath, i + 1, opts);
      if (entry) {
        entries.push(entry);
      }
      currentJsdoc = [];
    }
  }

  return entries;
}

/**
 * Parse a declaration line
 */
function parseDeclaration(
  line: string,
  jsdoc: string,
  filePath: string,
  lineNumber: number,
  opts: GeneratorOptions
): DocEntry | null {
  const trimmed = line.trim();
  const exported = trimmed.startsWith('export');

  if (opts.exportedOnly && !exported) {
    return null;
  }

  // Function
  let match = trimmed.match(
    /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(<[^>]+>)?\s*\(([^)]*)\)/
  );
  if (match) {
    const name = match[1];
    if (!opts.includePrivate && name.startsWith('_')) return null;
    return createEntry('function', name, jsdoc, filePath, lineNumber, exported, trimmed);
  }

  // Arrow function
  match = trimmed.match(
    /^(?:export\s+)?(?:const|let)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s*)?\(/
  );
  if (match) {
    const name = match[1];
    if (!opts.includePrivate && name.startsWith('_')) return null;
    return createEntry('function', name, jsdoc, filePath, lineNumber, exported, trimmed);
  }

  // Class
  match = trimmed.match(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/);
  if (match) {
    const name = match[1];
    if (!opts.includePrivate && name.startsWith('_')) return null;
    return createEntry('class', name, jsdoc, filePath, lineNumber, exported, trimmed);
  }

  // Interface
  match = trimmed.match(/^(?:export\s+)?interface\s+(\w+)/);
  if (match) {
    const name = match[1];
    if (!opts.includePrivate && name.startsWith('_')) return null;
    return createEntry('interface', name, jsdoc, filePath, lineNumber, exported, trimmed);
  }

  // Type alias
  match = trimmed.match(/^(?:export\s+)?type\s+(\w+)\s*(?:<[^>]+>)?\s*=/);
  if (match) {
    const name = match[1];
    if (!opts.includePrivate && name.startsWith('_')) return null;
    return createEntry('type', name, jsdoc, filePath, lineNumber, exported, trimmed);
  }

  // Enum
  match = trimmed.match(/^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/);
  if (match) {
    const name = match[1];
    if (!opts.includePrivate && name.startsWith('_')) return null;
    return createEntry('enum', name, jsdoc, filePath, lineNumber, exported, trimmed);
  }

  // Variable/constant
  match = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=/);
  if (match && !trimmed.includes('=>') && !trimmed.includes('function')) {
    const name = match[1];
    if (!opts.includePrivate && name.startsWith('_')) return null;
    return createEntry('variable', name, jsdoc, filePath, lineNumber, exported, trimmed);
  }

  return null;
}

/**
 * Create a documentation entry
 */
function createEntry(
  kind: DocEntry['kind'],
  name: string,
  jsdoc: string,
  file: string,
  line: number,
  exported: boolean,
  signature: string
): DocEntry {
  const parsed = parseJsdoc(jsdoc);

  return {
    name,
    kind,
    description: parsed.description,
    params: parsed.params,
    returns: parsed.returns,
    examples: parsed.examples,
    deprecated: parsed.deprecated,
    since: parsed.since,
    see: parsed.see,
    file,
    line,
    exported,
    signature: signature.slice(0, 200), // Truncate long signatures
  };
}

/**
 * Parse JSDoc comment
 */
function parseJsdoc(jsdoc: string): {
  description?: string;
  params?: ParamDoc[];
  returns?: ReturnDoc;
  examples?: string[];
  deprecated?: string;
  since?: string;
  see?: string[];
} {
  if (!jsdoc || !jsdoc.includes('/**')) {
    return {};
  }

  // Extract description (text before first @tag)
  const descMatch = jsdoc.match(/\/\*\*\s*([\s\S]*?)(?:@|\*\/)/);
  const description = descMatch
    ? descMatch[1]
        .replace(/\s*\*\s*/g, ' ')
        .trim()
    : undefined;

  // Extract @param tags
  const params: ParamDoc[] = [];
  const paramRegex = /@param\s*(?:\{([^}]+)\})?\s*(\w+)\s*(?:-?\s*(.*))?/g;
  let paramMatch;
  while ((paramMatch = paramRegex.exec(jsdoc)) !== null) {
    params.push({
      name: paramMatch[2],
      type: paramMatch[1],
      description: paramMatch[3]?.trim(),
    });
  }

  // Extract @returns
  const returnsMatch = jsdoc.match(/@returns?\s*(?:\{([^}]+)\})?\s*(?:-?\s*(.*))?/);
  const returns = returnsMatch
    ? { type: returnsMatch[1], description: returnsMatch[2]?.trim() }
    : undefined;

  // Extract @example
  const examples: string[] = [];
  const exampleRegex = /@example\s*([\s\S]*?)(?=@|$|\*\/)/g;
  let exampleMatch;
  while ((exampleMatch = exampleRegex.exec(jsdoc)) !== null) {
    const example = exampleMatch[1].replace(/\s*\*\s*/g, '\n').trim();
    if (example) examples.push(example);
  }

  // Extract @deprecated
  const deprecatedMatch = jsdoc.match(/@deprecated\s*(.*)/);
  const deprecated = deprecatedMatch ? deprecatedMatch[1].trim() : undefined;

  // Extract @since
  const sinceMatch = jsdoc.match(/@since\s*(.*)/);
  const since = sinceMatch ? sinceMatch[1].trim() : undefined;

  // Extract @see
  const see: string[] = [];
  const seeRegex = /@see\s*(.*)/g;
  let seeMatch;
  while ((seeMatch = seeRegex.exec(jsdoc)) !== null) {
    see.push(seeMatch[1].trim());
  }

  return {
    description: description || undefined,
    params: params.length > 0 ? params : undefined,
    returns,
    examples: examples.length > 0 ? examples : undefined,
    deprecated,
    since,
    see: see.length > 0 ? see : undefined,
  };
}

/**
 * Extract module-level description from file header comment
 */
function extractModuleDescription(content: string): string | undefined {
  const headerMatch = content.match(/^\/\*\*\s*([\s\S]*?)\*\//);
  if (headerMatch) {
    return headerMatch[1]
      .replace(/\s*\*\s*/g, ' ')
      .replace(/@\w+.*$/gm, '')
      .trim();
  }
  return undefined;
}

/**
 * Format documentation as Markdown
 */
export function formatDocsAsMarkdown(docs: GeneratedDocs): string {
  const lines: string[] = [
    '# API Documentation',
    '',
    `Generated on: ${docs.generatedAt.toISOString()}`,
    '',
    `Total documented items: ${docs.totalEntries}`,
    '',
    '## Table of Contents',
    '',
  ];

  // Table of contents
  for (const mod of docs.modules) {
    lines.push(`- [${mod.name}](#${mod.name.toLowerCase().replace(/[^a-z0-9]/g, '-')})`);
  }
  lines.push('');

  // Module documentation
  for (const mod of docs.modules) {
    lines.push(`## ${mod.name}`);
    lines.push('');
    lines.push(`**File:** \`${mod.path}\``);
    lines.push('');

    if (mod.description) {
      lines.push(mod.description);
      lines.push('');
    }

    // Group by kind
    const byKind = new Map<string, DocEntry[]>();
    for (const entry of mod.entries) {
      const list = byKind.get(entry.kind) || [];
      list.push(entry);
      byKind.set(entry.kind, list);
    }

    const kindOrder = ['class', 'interface', 'type', 'enum', 'function', 'variable'];
    for (const kind of kindOrder) {
      const entries = byKind.get(kind);
      if (!entries || entries.length === 0) continue;

      lines.push(`### ${kind.charAt(0).toUpperCase() + kind.slice(1)}s`);
      lines.push('');

      for (const entry of entries) {
        lines.push(`#### ${entry.name}`);
        lines.push('');

        if (entry.deprecated) {
          lines.push(`> **Deprecated:** ${entry.deprecated}`);
          lines.push('');
        }

        if (entry.description) {
          lines.push(entry.description);
          lines.push('');
        }

        if (entry.signature) {
          lines.push('```typescript');
          lines.push(entry.signature);
          lines.push('```');
          lines.push('');
        }

        if (entry.params && entry.params.length > 0) {
          lines.push('**Parameters:**');
          lines.push('');
          lines.push('| Name | Type | Description |');
          lines.push('|------|------|-------------|');
          for (const param of entry.params) {
            const type = param.type || 'unknown';
            const desc = param.description || '';
            lines.push(`| ${param.name} | \`${type}\` | ${desc} |`);
          }
          lines.push('');
        }

        if (entry.returns) {
          lines.push(`**Returns:** \`${entry.returns.type || 'unknown'}\``);
          if (entry.returns.description) {
            lines.push(`  ${entry.returns.description}`);
          }
          lines.push('');
        }

        if (entry.examples && entry.examples.length > 0) {
          lines.push('**Examples:**');
          lines.push('');
          for (const example of entry.examples) {
            lines.push('```typescript');
            lines.push(example);
            lines.push('```');
            lines.push('');
          }
        }

        if (entry.see && entry.see.length > 0) {
          lines.push('**See also:**');
          for (const ref of entry.see) {
            lines.push(`- ${ref}`);
          }
          lines.push('');
        }

        if (entry.since) {
          lines.push(`*Since: ${entry.since}*`);
          lines.push('');
        }

        lines.push('---');
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

/**
 * Format documentation as JSON
 */
export function formatDocsAsJson(docs: GeneratedDocs): string {
  return JSON.stringify(docs, null, 2);
}

/**
 * Generate and write documentation to file
 */
export async function generateDocsToFile(
  outputPath: string,
  options: GeneratorOptions = {},
  format: 'markdown' | 'json' = 'markdown'
): Promise<void> {
  const docs = await generateDocs(options);

  const content =
    format === 'markdown' ? formatDocsAsMarkdown(docs) : formatDocsAsJson(docs);

  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, content, 'utf-8');
}

export default generateDocs;
