/**
 * Glob Pattern Matcher
 *
 * Simple glob pattern matching without external dependencies.
 * Supports: *, **, ?, [abc], [a-z], {a,b,c}
 *
 * Used for tool filtering similar to Mistral Vibe's enabled_tools/disabled_tools.
 */

/**
 * Convert a glob pattern to a regular expression
 */
export function globToRegex(pattern: string): RegExp {
  let regexStr = '';
  let i = 0;
  const len = pattern.length;
  let inBracket = false;
  let inBrace = false;
  let braceContent = '';

  while (i < len) {
    const char = pattern[i];

    if (inBracket) {
      // Inside character class [...]
      if (char === ']') {
        regexStr += char;
        inBracket = false;
      } else if (char === '!' && regexStr.endsWith('[')) {
        regexStr += '^';
      } else {
        regexStr += char;
      }
    } else if (inBrace) {
      // Inside brace expansion {...}
      if (char === '}') {
        // Convert brace content to regex alternation
        const alternatives = braceContent.split(',').map(s => escapeRegex(s));
        regexStr += `(?:${alternatives.join('|')})`;
        inBrace = false;
        braceContent = '';
      } else {
        braceContent += char;
      }
    } else {
      switch (char) {
        case '*':
          // Check for **
          if (pattern[i + 1] === '*') {
            // ** matches anything including /
            regexStr += '.*';
            i++; // Skip next *
          } else {
            // * matches anything except /
            regexStr += '[^/]*';
          }
          break;

        case '?':
          // ? matches any single character except /
          regexStr += '[^/]';
          break;

        case '[':
          regexStr += '[';
          inBracket = true;
          break;

        case '{':
          inBrace = true;
          braceContent = '';
          break;

        case '.':
        case '+':
        case '^':
        case '$':
        case '|':
        case '(':
        case ')':
        case '\\':
          // Escape regex special characters
          regexStr += '\\' + char;
          break;

        default:
          regexStr += char;
      }
    }

    i++;
  }

  // Handle unclosed brackets — close to avoid invalid regex
  if (inBracket) {
    regexStr += ']';
  }
  // Handle unclosed braces — treat as literal text
  if (inBrace) {
    regexStr += '\\{' + escapeRegex(braceContent);
  }

  return new RegExp(`^${regexStr}$`);
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Test if a string matches a glob pattern
 */
export function matchGlob(str: string, pattern: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(str);
}

/**
 * Test if a string matches any of the given patterns
 */
export function matchAnyGlob(str: string, patterns: string[]): boolean {
  return patterns.some(pattern => matchGlob(str, pattern));
}

/**
 * Test if a string matches all of the given patterns
 */
export function matchAllGlobs(str: string, patterns: string[]): boolean {
  return patterns.every(pattern => matchGlob(str, pattern));
}

/**
 * Filter an array of strings by glob patterns
 */
export function filterByGlob<T>(
  items: T[],
  patterns: string[],
  accessor: (item: T) => string = (item) => String(item)
): T[] {
  return items.filter(item => matchAnyGlob(accessor(item), patterns));
}

/**
 * Exclude items matching glob patterns
 */
export function excludeByGlob<T>(
  items: T[],
  patterns: string[],
  accessor: (item: T) => string = (item) => String(item)
): T[] {
  return items.filter(item => !matchAnyGlob(accessor(item), patterns));
}

/**
 * Tool filter using glob patterns
 */
export interface ToolFilterConfig {
  /** Tools to enable (glob patterns) */
  enabledTools?: string[];
  /** Tools to disable (glob patterns) */
  disabledTools?: string[];
}

/**
 * Filter tools by glob patterns
 */
export function filterTools(
  tools: string[],
  config: ToolFilterConfig
): string[] {
  let result = [...tools];

  // Apply enabled filter (whitelist)
  if (config.enabledTools && config.enabledTools.length > 0) {
    result = filterByGlob(result, config.enabledTools);
  }

  // Apply disabled filter (blacklist)
  if (config.disabledTools && config.disabledTools.length > 0) {
    result = excludeByGlob(result, config.disabledTools);
  }

  return result;
}

/**
 * Check if a single tool is enabled by the filter config
 */
export function isToolEnabled(toolName: string, config: ToolFilterConfig): boolean {
  // Check disabled first
  if (config.disabledTools && config.disabledTools.length > 0) {
    if (matchAnyGlob(toolName, config.disabledTools)) {
      return false;
    }
  }

  // Check enabled (if empty, all tools enabled by default)
  if (config.enabledTools && config.enabledTools.length > 0) {
    return matchAnyGlob(toolName, config.enabledTools);
  }

  return true;
}

// ============================================================================
// Examples and Documentation
// ============================================================================

/**
 * Example patterns:
 *
 * - "bash" - Exact match
 * - "bash*" - Starts with "bash"
 * - "*search*" - Contains "search"
 * - "*.test.ts" - Ends with ".test.ts"
 * - "**\/*.ts" - Any .ts file
 * - "src/**" - Anything under src/
 * - "file_?" - Single character wildcard
 * - "[abc]*" - Starts with a, b, or c
 * - "{bash,git,npm}" - Any of these exact matches
 * - "!pattern" - Not supported directly (use disabledTools)
 */
