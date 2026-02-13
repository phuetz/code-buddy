/**
 * Pre-Write Syntax Validator
 *
 * Validates code syntax before writing to filesystem.
 * Uses lightweight checks per language to catch obvious errors.
 * Does NOT require the full TypeScript compiler — uses heuristics.
 */

export interface SyntaxCheckResult {
  valid: boolean;
  errors: string[];
  language: string;
}

/**
 * Validate syntax of code content before writing.
 * Returns validation result (best-effort, non-blocking).
 */
export function validateSyntax(code: string, filePath: string): SyntaxCheckResult {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';

  switch (ext) {
    case 'json':
      return validateJson(code);
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return validateJavaScript(code, ext);
    case 'py':
      return validatePython(code);
    case 'yaml':
    case 'yml':
      return validateYaml(code);
    case 'html':
    case 'htm':
      return validateHtml(code);
    case 'css':
    case 'scss':
      return validateCss(code);
    default:
      return { valid: true, errors: [], language: 'unknown' };
  }
}

function validateJson(code: string): SyntaxCheckResult {
  try {
    JSON.parse(code);
    return { valid: true, errors: [], language: 'json' };
  } catch (e) {
    return {
      valid: false,
      errors: [`JSON syntax error: ${e instanceof Error ? e.message : String(e)}`],
      language: 'json',
    };
  }
}

function validateJavaScript(code: string, ext: string): SyntaxCheckResult {
  const errors: string[] = [];
  const language = ext.startsWith('t') ? 'typescript' : 'javascript';

  // Check balanced braces, brackets, parentheses
  const braceErrors = checkBalancedDelimiters(code);
  if (braceErrors.length > 0) {
    errors.push(...braceErrors);
  }

  // Check for unclosed template literals
  let inTemplate = false;
  let templateDepth = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '`' && code[i - 1] !== '\\') {
      if (!inTemplate) {
        inTemplate = true;
        templateDepth++;
      } else {
        templateDepth--;
        if (templateDepth === 0) inTemplate = false;
      }
    }
  }
  if (templateDepth > 0) {
    errors.push(`Unclosed template literal (${templateDepth} unclosed)`);
  }

  // Check for common syntax issues
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Duplicate semicolons
    if (/;;(?!.*for)/.test(line)) {
      errors.push(`Line ${i + 1}: Double semicolons`);
    }
    // Assignment in condition without extra parens
    if (/\bif\s*\(\s*\w+\s*=[^=]/.test(line)) {
      // This is a warning, not necessarily an error
    }
  }

  return { valid: errors.length === 0, errors, language };
}

function validatePython(code: string): SyntaxCheckResult {
  const errors: string[] = [];

  // Check balanced delimiters
  const braceErrors = checkBalancedDelimiters(code);
  if (braceErrors.length > 0) {
    errors.push(...braceErrors);
  }

  // Check for mixing tabs and spaces
  const lines = code.split('\n');
  let usesSpaces = false;
  let usesTabs = false;

  for (const line of lines) {
    if (line.startsWith(' ') && line.trim().length > 0) usesSpaces = true;
    if (line.startsWith('\t') && line.trim().length > 0) usesTabs = true;
  }

  if (usesSpaces && usesTabs) {
    errors.push('Mixed tabs and spaces for indentation');
  }

  // Check for unclosed string literals
  let inTripleSingle = false;
  let inTripleDouble = false;
  for (let i = 0; i < code.length; i++) {
    if (code.slice(i, i + 3) === "'''" && !inTripleDouble) {
      inTripleSingle = !inTripleSingle;
      i += 2;
    } else if (code.slice(i, i + 3) === '"""' && !inTripleSingle) {
      inTripleDouble = !inTripleDouble;
      i += 2;
    }
  }
  if (inTripleSingle) errors.push("Unclosed triple-single-quote string");
  if (inTripleDouble) errors.push("Unclosed triple-double-quote string");

  return { valid: errors.length === 0, errors, language: 'python' };
}

function validateYaml(code: string): SyntaxCheckResult {
  const errors: string[] = [];

  // Check for tabs (YAML doesn't allow tabs for indentation)
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('\t')) {
      errors.push(`Line ${i + 1}: YAML does not allow tabs for indentation`);
      break; // One error is enough
    }
  }

  // Check for duplicate keys at root level (simple check)
  const rootKeys = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([a-zA-Z_][\w-]*):/);
    if (match) {
      if (rootKeys.has(match[1])) {
        errors.push(`Line ${i + 1}: Duplicate root key '${match[1]}'`);
      }
      rootKeys.add(match[1]);
    }
  }

  return { valid: errors.length === 0, errors, language: 'yaml' };
}

function validateHtml(code: string): SyntaxCheckResult {
  const errors: string[] = [];

  // Check for unclosed tags (simple check)
  const tagStack: { tag: string; line: number }[] = [];
  const selfClosing = new Set([
    'br', 'hr', 'img', 'input', 'meta', 'link', 'source',
    'track', 'wbr', 'area', 'base', 'col', 'embed', 'param',
  ]);

  const tagRegex = /<\/?([a-zA-Z][\w-]*)[^>]*\/?>/g;
  const lines = code.split('\n');
  let lineNum = 1;
  let charsSoFar = 0;

  let match;
  while ((match = tagRegex.exec(code)) !== null) {
    // Calculate line number
    while (charsSoFar + lines[lineNum - 1].length + 1 <= match.index && lineNum < lines.length) {
      charsSoFar += lines[lineNum - 1].length + 1;
      lineNum++;
    }

    const fullTag = match[0];
    const tagName = match[1].toLowerCase();

    if (selfClosing.has(tagName) || fullTag.endsWith('/>')) continue;

    if (fullTag.startsWith('</')) {
      // Closing tag
      if (tagStack.length > 0 && tagStack[tagStack.length - 1].tag === tagName) {
        tagStack.pop();
      }
      // Don't report mismatched closing tags to avoid noise
    } else {
      // Opening tag
      tagStack.push({ tag: tagName, line: lineNum });
    }
  }

  // Only report if there are few unclosed tags (many = likely a fragment)
  if (tagStack.length > 0 && tagStack.length < 5) {
    for (const unclosed of tagStack) {
      errors.push(`Unclosed <${unclosed.tag}> tag at line ${unclosed.line}`);
    }
  }

  return { valid: errors.length === 0, errors, language: 'html' };
}

function validateCss(code: string): SyntaxCheckResult {
  const errors: string[] = [];
  const braceErrors = checkBalancedDelimiters(code, ['{', '}']);
  if (braceErrors.length > 0) {
    errors.push(...braceErrors);
  }
  return { valid: errors.length === 0, errors, language: 'css' };
}

/**
 * Check for balanced delimiters (braces, brackets, parentheses).
 * Respects strings and comments.
 */
function checkBalancedDelimiters(
  code: string,
  pairs?: string[],
): string[] {
  const errors: string[] = [];
  const stack: { char: string; line: number }[] = [];
  const openers = pairs ? [pairs[0]] : ['{', '[', '('];
  const closers = pairs ? [pairs[1]] : ['}', ']', ')'];
  const matchMap: Record<string, string> = pairs
    ? { [pairs[1]]: pairs[0] }
    : { '}': '{', ']': '[', ')': '(' };

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let lineNum = 1;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const prev = code[i - 1];
    const next = code[i + 1];

    if (ch === '\n') {
      lineNum++;
      inLineComment = false;
      continue;
    }

    // Skip strings and comments
    if (inLineComment) continue;
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingleQuote) {
      if (ch === "'" && prev !== '\\') inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (ch === '"' && prev !== '\\') inDoubleQuote = false;
      continue;
    }

    if (ch === "'" && prev !== '\\') { inSingleQuote = true; continue; }
    if (ch === '"' && prev !== '\\') { inDoubleQuote = true; continue; }
    if (ch === '/' && next === '/') { inLineComment = true; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }

    if (openers.includes(ch)) {
      stack.push({ char: ch, line: lineNum });
    } else if (closers.includes(ch)) {
      const expected = matchMap[ch];
      if (stack.length === 0) {
        errors.push(`Line ${lineNum}: Unexpected '${ch}' without matching '${expected}'`);
      } else if (stack[stack.length - 1].char !== expected) {
        const top = stack[stack.length - 1];
        errors.push(`Line ${lineNum}: Mismatched '${ch}' — expected closing for '${top.char}' at line ${top.line}`);
      } else {
        stack.pop();
      }
    }
  }

  for (const unclosed of stack) {
    errors.push(`Unclosed '${unclosed.char}' at line ${unclosed.line}`);
  }

  return errors;
}
