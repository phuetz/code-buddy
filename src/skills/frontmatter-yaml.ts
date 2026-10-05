/**
 * Tolerant parsing of a SKILL.md YAML frontmatter, aligned on Claude Code.
 *
 * Claude Code skills commonly write `argument-hint: [world-name] [optional prompt]`
 * unquoted. That is not valid YAML (a flow sequence followed by more text) and the
 * strict parser rejects it, yet Claude Code loads such skills: its frontmatter parser
 * (verified in @anthropic-ai/claude-code 2.1.289, the public npm build) parses
 * strictly first and, ONLY when that fails, retries once after:
 *   1. double-quoting every top-level `key: value` line (key matching
 *      /^[a-zA-Z_-]+$/) whose plain value contains a YAML indicator
 *      (/[{}[\]*&#!|>%@`]|: /), escaping `\` and `"`;
 *      values already wrapped in matching quotes, and `[..]` values that parse
 *      as a flow sequence, are left untouched;
 *   2. expanding leading tabs to two spaces each.
 * The documentation shows the very shape this repairs ("argument-hint ... Example:
 * `[issue-number]` or `[filename] [format]`", https://code.claude.com/docs/en/skills).
 *
 * Differences, on purpose:
 *   - a trailing `\r` (CRLF files) is set aside before matching a line, so CRLF
 *     and LF frontmatter repair identically;
 *   - when the repaired text still fails, Claude Code loads the skill with an
 *     empty frontmatter; here the error is thrown, so callers (the importer)
 *     keep refusing the skill as before.
 *
 * Security: the repair only changes the YAML *type* of the values it quotes (they
 * become strings); it never adds or renames a key, and it runs on the frontmatter
 * text only. The import firewall still scans the raw SKILL.md bytes, unchanged.
 *
 * @module skills/frontmatter-yaml
 */

import * as yaml from 'yaml';

/** YAML indicator characters that make an unquoted value unsafe (same set as Claude Code). */
export const YAML_INDICATOR_RE = /[{}[\]*&#!|>%@`]|: /;
const TOP_LEVEL_KEY_RE = /^([a-zA-Z_-]+):\s+(\S.*)$/;

export interface FrontmatterParseResult {
  data: unknown;
  /** True when the strict parse failed and the Claude Code-compatible repair was used. */
  repaired: boolean;
  /** Keys whose value was quoted by the repair. */
  quotedKeys: string[];
}

function isFlowSequence(value: string): boolean {
  try {
    return Array.isArray(yaml.parse(value));
  } catch {
    return false;
  }
}

/** Quote top-level plain values holding a YAML indicator (Claude Code's fallback, step 1). */
export function quoteProblematicValues(text: string): { text: string; quotedKeys: string[] } {
  const quotedKeys: string[] = [];
  const out = text.split('\n').map((rawLine) => {
    const cr = rawLine.endsWith('\r');
    const line = cr ? rawLine.slice(0, -1) : rawLine;
    const m = line.match(TOP_LEVEL_KEY_RE);
    if (!m) return rawLine;
    const [, key, value] = m;
    if (!key || !value) return rawLine;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return rawLine;
    if (value.startsWith('[') && value.endsWith(']') && isFlowSequence(value)) return rawLine;
    if (!YAML_INDICATOR_RE.test(value)) return rawLine;
    quotedKeys.push(key);
    const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    return `${key}: "${escaped}"${cr ? '\r' : ''}`;
  });
  return { text: out.join('\n'), quotedKeys };
}

/**
 * Parse frontmatter YAML: strict first, then (only on failure) the Claude Code-compatible
 * repair. Throws the ORIGINAL strict error when the repaired text does not parse either.
 */
export function parseFrontmatterYaml(text: string): FrontmatterParseResult {
  try {
    return { data: yaml.parse(text), repaired: false, quotedKeys: [] };
  } catch (strictError) {
    const quoted = quoteProblematicValues(text);
    const repairedText = quoted.text.replace(/^\t+/gm, (tabs) => '  '.repeat(tabs.length));
    if (repairedText === text) throw strictError;
    try {
      return { data: yaml.parse(repairedText), repaired: true, quotedKeys: quoted.quotedKeys };
    } catch {
      throw strictError;
    }
  }
}
