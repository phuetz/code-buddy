/**
 * Bash Command Parser (Vibe-inspired)
 *
 * Parses bash commands to extract individual commands from complex
 * expressions (pipelines, chains, subshells, command substitutions).
 *
 * Uses tree-sitter-bash if available, otherwise falls back to a
 * robust regex/state-machine parser that handles common patterns.
 *
 * This is critical for security: `rm -rf / && echo safe` should
 * detect the `rm -rf /` component, not just see "echo safe".
 */

import { logger } from '../utils/logger.js';

export interface ParsedCommand {
  /** The base command name (e.g., 'rm', 'git', 'npm') */
  command: string;
  /** Full argument list */
  args: string[];
  /** The raw text of this command segment */
  raw: string;
  /** How this command connects to the next: |, &&, ||, ;, or null */
  connector: string | null;
  /** Whether this is inside a subshell or command substitution */
  isSubshell: boolean;
}

export interface ParseResult {
  commands: ParsedCommand[];
  /** Whether tree-sitter was used (false = fallback parser) */
  usedTreeSitter: boolean;
  /** Any parsing warnings */
  warnings: string[];
}

// ============================================================================
// State-machine fallback parser
// ============================================================================

type QuoteState = 'none' | 'single' | 'double' | 'backtick';

/**
 * Parse bash commands using a state-machine approach.
 * Handles quotes, escapes, pipelines, chains, subshells.
 */
function fallbackParse(input: string, depth: number = 0): ParseResult {
  if (depth > 10) { return { commands: [{ command: input, args: [], raw: input, connector: null, isSubshell: false }], usedTreeSitter: false, warnings: ['Parse depth limit exceeded'] }; }
  const commands: ParsedCommand[] = [];
  const warnings: string[] = [];

  // First, handle `bash -c "..."` and `sh -c "..."` wrapper
  const bashCMatch = input.match(/^(bash|sh|zsh)\s+(-[a-z]*c)\s+(['"])([\s\S]*?)\3\s*$/);
  if (bashCMatch) {
    const innerResult = fallbackParse(bashCMatch[4], depth + 1);
    // Also add the outer shell command
    return {
      commands: [
        { command: bashCMatch[1], args: [bashCMatch[2], bashCMatch[4]], raw: input, connector: null, isSubshell: false },
        ...innerResult.commands.map(c => ({ ...c, isSubshell: true })),
      ],
      usedTreeSitter: false,
      warnings: innerResult.warnings,
    };
  }

  // Tokenize: split on unquoted separators (&&, ||, |, ;)
  const segments: { text: string; connector: string | null }[] = [];
  let current = '';
  let quoteState: QuoteState = 'none';
  let escaped = false;
  let parenDepth = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      current += ch;
      continue;
    }

    // Quote handling
    if (quoteState === 'none') {
      if (ch === "'") { quoteState = 'single'; current += ch; continue; }
      if (ch === '"') { quoteState = 'double'; current += ch; continue; }
      if (ch === '`') { quoteState = 'backtick'; current += ch; continue; }
    } else if (quoteState === 'single' && ch === "'") {
      quoteState = 'none'; current += ch; continue;
    } else if (quoteState === 'double' && ch === '"') {
      quoteState = 'none'; current += ch; continue;
    } else if (quoteState === 'backtick' && ch === '`') {
      quoteState = 'none'; current += ch; continue;
    }

    if (quoteState !== 'none') {
      current += ch;
      continue;
    }

    // Subshell/group tracking
    if (ch === '(' || ch === '{') { parenDepth++; current += ch; continue; }
    if (ch === ')' || ch === '}') { parenDepth--; current += ch; continue; }

    if (parenDepth > 0) {
      current += ch;
      continue;
    }

    // Separators (only at top level, outside quotes)
    if (ch === '&' && next === '&') {
      segments.push({ text: current.trim(), connector: '&&' });
      current = '';
      i++; // skip next &
      continue;
    }
    if (ch === '|' && next === '|') {
      segments.push({ text: current.trim(), connector: '||' });
      current = '';
      i++; // skip next |
      continue;
    }
    if (ch === '|') {
      segments.push({ text: current.trim(), connector: '|' });
      current = '';
      continue;
    }
    if (ch === ';') {
      segments.push({ text: current.trim(), connector: ';' });
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    segments.push({ text: current.trim(), connector: null });
  }

  // Parse each segment into a command
  for (const seg of segments) {
    if (!seg.text) continue;

    // Handle command substitution $(...) recursively
    // Extract all $(...) command substitutions (non-greedy to handle multiple)
    const subCmdRegex = /\$\((.+?)\)/g;
    let subCmdMatch;
    while ((subCmdMatch = subCmdRegex.exec(seg.text)) !== null) {
      const innerResult = fallbackParse(subCmdMatch[1], depth + 1);
      commands.push(...innerResult.commands.map(c => ({ ...c, isSubshell: true })));
    }

    // Handle subshell (...)
    const subshellMatch = seg.text.match(/^\((.+)\)$/);
    if (subshellMatch) {
      const innerResult = fallbackParse(subshellMatch[1], depth + 1);
      commands.push(...innerResult.commands.map(c => ({ ...c, isSubshell: true })));
      continue;
    }

    // Strip env var assignments at the start: VAR=value cmd args
    let cmdText = seg.text;
    while (/^\w+=\S*\s/.test(cmdText)) {
      cmdText = cmdText.replace(/^\w+=\S*\s+/, '');
    }

    // Strip redirections from the end for command detection
    const cleanText = cmdText
      .replace(/\s*[0-9]*>[>&]*\s*\S+/g, '')
      .replace(/\s*<\s*\S+/g, '')
      .trim();

    if (!cleanText) continue;

    // Split into command and args
    const parts = tokenizeSimple(cleanText);
    if (parts.length === 0) continue;

    commands.push({
      command: parts[0],
      args: parts.slice(1),
      raw: seg.text,
      connector: seg.connector,
      isSubshell: false,
    });
  }

  if (quoteState !== 'none') {
    warnings.push(`Unclosed ${quoteState} quote`);
  }

  return { commands, usedTreeSitter: false, warnings };
}

/**
 * Simple tokenizer that respects quotes.
 */
function tokenizeSimple(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (ch === ' ' && !inSingle && !inDouble) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a bash command string into individual commands.
 * Uses tree-sitter if available, falls back to state-machine parser.
 */
export function parseBashCommand(input: string): ParseResult {
  if (!input || !input.trim()) {
    return { commands: [], usedTreeSitter: false, warnings: [] };
  }

  // Try tree-sitter first (optional dependency)
  try {
    // Dynamic import — only works if tree-sitter + tree-sitter-bash are installed
     
    const Parser = require('tree-sitter');
     
    const Bash = require('tree-sitter-bash');

    const parser = new Parser();
    parser.setLanguage(Bash);
    const tree = parser.parse(input);

    const commands = extractCommandsFromTree(tree.rootNode, input);
    logger.debug('Parsed bash with tree-sitter', { commandCount: commands.length });

    return { commands, usedTreeSitter: true, warnings: [] };
  } catch {
    // tree-sitter not available — use fallback
  }

  return fallbackParse(input);
}

/**
 * Extract commands from a tree-sitter AST node.
 */
function extractCommandsFromTree(
  node: { type: string; text: string; children: unknown[]; childCount: number; child(i: number): { type: string; text: string; children: unknown[]; childCount: number; child(i: number): unknown } },
  _source: string,
  isSubshell = false,
): ParsedCommand[] {
  const commands: ParsedCommand[] = [];

  function walk(n: typeof node, subshell: boolean): void {
    switch (n.type) {
      case 'command': {
        const parts: string[] = [];
        for (let i = 0; i < n.childCount; i++) {
          const child = n.child(i) as typeof node;
          if (child.type === 'command_name' || child.type === 'word' || child.type === 'string') {
            parts.push(child.text);
          }
        }
        if (parts.length > 0) {
          commands.push({
            command: parts[0],
            args: parts.slice(1),
            raw: n.text,
            connector: null,
            isSubshell: subshell,
          });
        }
        break;
      }
      case 'pipeline':
      case 'list':
      case 'compound_statement':
        for (let i = 0; i < n.childCount; i++) {
          walk(n.child(i) as typeof node, subshell);
        }
        break;
      case 'subshell':
      case 'command_substitution':
        for (let i = 0; i < n.childCount; i++) {
          walk(n.child(i) as typeof node, true);
        }
        break;
      default:
        for (let i = 0; i < n.childCount; i++) {
          walk(n.child(i) as typeof node, subshell);
        }
    }
  }

  walk(node, isSubshell);
  return commands;
}

/**
 * Extract just the command names from a bash string (convenience).
 */
export function extractCommandNames(input: string): string[] {
  const result = parseBashCommand(input);
  return result.commands.map(c => c.command);
}

/**
 * Check if a bash command string contains any of the given commands.
 */
export function containsCommand(input: string, commands: string[]): boolean {
  const names = extractCommandNames(input);
  return names.some(name => commands.includes(name));
}

/**
 * Check if a bash command string contains dangerous commands.
 */
export function containsDangerousCommand(input: string): { dangerous: boolean; commands: string[] } {
  const DANGEROUS = [
    'rm', 'rmdir', 'mkfs', 'dd', 'fdisk', 'parted',
    'shutdown', 'reboot', 'poweroff', 'halt',
    'kill', 'killall', 'pkill',
    'chmod', 'chown', 'chgrp',
    'iptables', 'ip6tables', 'nft',
    'useradd', 'userdel', 'usermod', 'groupadd',
    'mount', 'umount',
    'systemctl', 'service',
    'crontab',
  ];

  const result = parseBashCommand(input);
  const found = result.commands
    .map(c => c.command)
    .filter(name => DANGEROUS.includes(name));

  return { dangerous: found.length > 0, commands: [...new Set(found)] };
}
