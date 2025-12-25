/**
 * Multi-Language Code Formatter
 *
 * Provides code formatting for multiple languages:
 * - TypeScript/JavaScript (via built-in or prettier)
 * - Python (via built-in or black)
 * - JSON/YAML
 * - SQL
 * - HTML/CSS
 */

import { execSync } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';

export type Language =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'json'
  | 'yaml'
  | 'sql'
  | 'html'
  | 'css'
  | 'markdown';

export interface FormatOptions {
  /** Indentation size (spaces) */
  indentSize?: number;
  /** Use tabs instead of spaces */
  useTabs?: boolean;
  /** Max line width */
  lineWidth?: number;
  /** Use single quotes (JS/TS) */
  singleQuote?: boolean;
  /** Add trailing commas */
  trailingComma?: 'none' | 'es5' | 'all';
  /** Semicolons (JS/TS) */
  semicolons?: boolean;
}

export interface FormatResult {
  success: boolean;
  formatted?: string;
  error?: string;
  language: Language;
  formatter: string;
}

const DEFAULT_OPTIONS: FormatOptions = {
  indentSize: 2,
  useTabs: false,
  lineWidth: 100,
  singleQuote: true,
  trailingComma: 'es5',
  semicolons: true,
};

/**
 * Detect language from file extension
 */
export function detectLanguage(filePath: string): Language | null {
  const ext = path.extname(filePath).toLowerCase();
  const mapping: Record<string, Language> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.sql': 'sql',
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'css',
    '.md': 'markdown',
  };
  return mapping[ext] || null;
}

/**
 * Format code in a given language
 */
export function formatCode(
  code: string,
  language: Language,
  options: FormatOptions = {}
): FormatResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    switch (language) {
      case 'typescript':
      case 'javascript':
        return formatJavaScript(code, language, opts);
      case 'python':
        return formatPython(code, opts);
      case 'json':
        return formatJson(code, opts);
      case 'yaml':
        return formatYaml(code, opts);
      case 'sql':
        return formatSql(code, opts);
      case 'html':
        return formatHtml(code, opts);
      case 'css':
        return formatCss(code, opts);
      case 'markdown':
        return formatMarkdown(code, opts);
      default:
        return {
          success: false,
          error: `Unsupported language: ${language}`,
          language,
          formatter: 'none',
        };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      language,
      formatter: 'error',
    };
  }
}

/**
 * Format JavaScript/TypeScript
 */
function formatJavaScript(
  code: string,
  language: Language,
  opts: FormatOptions
): FormatResult {
  // Try prettier first
  try {
    const prettierConfig = JSON.stringify({
      parser: language === 'typescript' ? 'typescript' : 'babel',
      tabWidth: opts.indentSize,
      useTabs: opts.useTabs,
      printWidth: opts.lineWidth,
      singleQuote: opts.singleQuote,
      trailingComma: opts.trailingComma,
      semi: opts.semicolons,
    });

    const formatted = execSync(
      `echo ${JSON.stringify(code)} | npx prettier --stdin-filepath=file.${language === 'typescript' ? 'ts' : 'js'} --config -`,
      {
        encoding: 'utf-8',
        input: prettierConfig,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    return {
      success: true,
      formatted: formatted.trim(),
      language,
      formatter: 'prettier',
    };
  } catch {
    // Fallback to basic formatting
    return basicJsFormat(code, language, opts);
  }
}

/**
 * Basic JavaScript formatting fallback
 */
function basicJsFormat(
  code: string,
  language: Language,
  opts: FormatOptions
): FormatResult {
  const indent = opts.useTabs ? '\t' : ' '.repeat(opts.indentSize || 2);
  let formatted = code;
  let level = 0;
  const lines: string[] = [];

  // Split into lines and format
  for (const line of formatted.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      lines.push('');
      continue;
    }

    // Decrease indent for closing braces
    if (trimmed.startsWith('}') || trimmed.startsWith(']') || trimmed.startsWith(')')) {
      level = Math.max(0, level - 1);
    }

    lines.push(indent.repeat(level) + trimmed);

    // Increase indent for opening braces
    const opens = (trimmed.match(/[{[(]/g) || []).length;
    const closes = (trimmed.match(/[}\])]/g) || []).length;
    level = Math.max(0, level + opens - closes);
  }

  return {
    success: true,
    formatted: lines.join('\n'),
    language,
    formatter: 'built-in',
  };
}

/**
 * Format Python code
 */
function formatPython(code: string, opts: FormatOptions): FormatResult {
  // Try black first
  try {
    const formatted = execSync(
      `echo ${JSON.stringify(code)} | python -m black --line-length ${opts.lineWidth || 88} -`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    return {
      success: true,
      formatted: formatted.trim(),
      language: 'python',
      formatter: 'black',
    };
  } catch {
    // Basic Python formatting
    return basicPythonFormat(code, opts);
  }
}

/**
 * Basic Python formatting fallback
 */
function basicPythonFormat(code: string, opts: FormatOptions): FormatResult {
  const indent = ' '.repeat(opts.indentSize || 4);
  let level = 0;
  const lines: string[] = [];

  for (const line of code.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      lines.push('');
      continue;
    }

    // Decrease indent for dedent keywords
    if (/^(else|elif|except|finally|case)\b/.test(trimmed)) {
      level = Math.max(0, level - 1);
    }

    lines.push(indent.repeat(level) + trimmed);

    // Increase indent after colons (blocks)
    if (trimmed.endsWith(':')) {
      level++;
    }
  }

  return {
    success: true,
    formatted: lines.join('\n'),
    language: 'python',
    formatter: 'built-in',
  };
}

/**
 * Format JSON
 */
function formatJson(code: string, opts: FormatOptions): FormatResult {
  try {
    const parsed = JSON.parse(code);
    const indent = opts.useTabs ? '\t' : opts.indentSize || 2;
    const formatted = JSON.stringify(parsed, null, indent);

    return {
      success: true,
      formatted,
      language: 'json',
      formatter: 'built-in',
    };
  } catch (error) {
    return {
      success: false,
      error: `Invalid JSON: ${error instanceof Error ? error.message : error}`,
      language: 'json',
      formatter: 'built-in',
    };
  }
}

/**
 * Format YAML (basic)
 */
function formatYaml(code: string, opts: FormatOptions): FormatResult {
  const indent = ' '.repeat(opts.indentSize || 2);
  const lines: string[] = [];

  for (const line of code.split('\n')) {
    // Preserve original indentation structure
    const match = line.match(/^(\s*)(.*)$/);
    if (!match) continue;

    const [, spaces, content] = match;
    const level = Math.floor(spaces.length / 2);
    lines.push(indent.repeat(level) + content);
  }

  return {
    success: true,
    formatted: lines.join('\n'),
    language: 'yaml',
    formatter: 'built-in',
  };
}

/**
 * Format SQL (basic)
 */
function formatSql(code: string, opts: FormatOptions): FormatResult {
  const indent = opts.useTabs ? '\t' : ' '.repeat(opts.indentSize || 2);
  let formatted = code.toUpperCase();

  // Keywords on their own lines
  const keywords = [
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'ORDER BY', 'GROUP BY',
    'HAVING', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN',
    'ON', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
    'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'UNION', 'LIMIT', 'OFFSET',
  ];

  for (const kw of keywords) {
    formatted = formatted.replace(new RegExp(`\\b${kw}\\b`, 'gi'), `\n${kw}`);
  }

  // Indent after SELECT and nested content
  const lines: string[] = [];
  let level = 0;

  for (const line of formatted.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^(FROM|WHERE|ORDER BY|GROUP BY|HAVING|SET|VALUES)/i.test(trimmed)) {
      level = 1;
    } else if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/i.test(trimmed)) {
      level = 0;
    }

    lines.push(indent.repeat(level) + trimmed);
  }

  return {
    success: true,
    formatted: lines.join('\n').trim(),
    language: 'sql',
    formatter: 'built-in',
  };
}

/**
 * Format HTML (basic)
 */
function formatHtml(code: string, opts: FormatOptions): FormatResult {
  const indent = opts.useTabs ? '\t' : ' '.repeat(opts.indentSize || 2);
  let level = 0;
  const lines: string[] = [];

  // Simple tag-based formatting
  const tagPattern = /<\/?[\w-]+[^>]*>/g;
  let lastIndex = 0;
  let match;

  while ((match = tagPattern.exec(code)) !== null) {
    const before = code.slice(lastIndex, match.index).trim();
    if (before) {
      lines.push(indent.repeat(level) + before);
    }

    const tag = match[0];
    const isClosing = tag.startsWith('</');
    const isSelfClosing = tag.endsWith('/>') || /^<(br|hr|img|input|meta|link)/i.test(tag);

    if (isClosing) {
      level = Math.max(0, level - 1);
    }

    lines.push(indent.repeat(level) + tag);

    if (!isClosing && !isSelfClosing) {
      level++;
    }

    lastIndex = match.index + tag.length;
  }

  // Add remaining content
  const remaining = code.slice(lastIndex).trim();
  if (remaining) {
    lines.push(indent.repeat(level) + remaining);
  }

  return {
    success: true,
    formatted: lines.join('\n'),
    language: 'html',
    formatter: 'built-in',
  };
}

/**
 * Format CSS (basic)
 */
function formatCss(code: string, opts: FormatOptions): FormatResult {
  const indent = opts.useTabs ? '\t' : ' '.repeat(opts.indentSize || 2);
  let formatted = code;

  // Add newlines after braces
  formatted = formatted.replace(/\{/g, ' {\n');
  formatted = formatted.replace(/\}/g, '\n}\n');
  formatted = formatted.replace(/;/g, ';\n');

  // Format lines
  const lines: string[] = [];
  let level = 0;

  for (const line of formatted.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === '}') {
      level = Math.max(0, level - 1);
    }

    lines.push(indent.repeat(level) + trimmed);

    if (trimmed.endsWith('{')) {
      level++;
    }
  }

  return {
    success: true,
    formatted: lines.join('\n'),
    language: 'css',
    formatter: 'built-in',
  };
}

/**
 * Format Markdown (basic cleanup)
 */
function formatMarkdown(code: string, _opts: FormatOptions): FormatResult {
  let formatted = code;

  // Normalize line endings
  formatted = formatted.replace(/\r\n/g, '\n');

  // Ensure single blank line between paragraphs
  formatted = formatted.replace(/\n{3,}/g, '\n\n');

  // Add space after headers
  formatted = formatted.replace(/^(#{1,6})([^\s#])/gm, '$1 $2');

  // Ensure blank line before headers
  formatted = formatted.replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2');

  return {
    success: true,
    formatted: formatted.trim() + '\n',
    language: 'markdown',
    formatter: 'built-in',
  };
}

/**
 * Format a file in place
 */
export async function formatFile(
  filePath: string,
  options: FormatOptions = {}
): Promise<FormatResult> {
  const language = detectLanguage(filePath);
  if (!language) {
    return {
      success: false,
      error: `Cannot detect language for: ${filePath}`,
      language: 'typescript',
      formatter: 'none',
    };
  }

  const content = await fs.readFile(filePath, 'utf-8');
  const result = formatCode(content, language, options);

  if (result.success && result.formatted) {
    await fs.writeFile(filePath, result.formatted, 'utf-8');
  }

  return result;
}

/**
 * Check if external formatters are available
 */
export function checkFormatters(): Record<string, boolean> {
  const formatters: Record<string, { check: string }> = {
    prettier: { check: 'npx prettier --version' },
    black: { check: 'python -m black --version' },
    eslint: { check: 'npx eslint --version' },
  };

  const available: Record<string, boolean> = {};

  for (const [name, { check }] of Object.entries(formatters)) {
    try {
      execSync(check, { stdio: 'pipe' });
      available[name] = true;
    } catch {
      available[name] = false;
    }
  }

  return available;
}

export default formatCode;
