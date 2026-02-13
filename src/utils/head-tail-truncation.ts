/**
 * Head/Tail Output Truncation (Codex-inspired)
 *
 * Keeps the first N and last M lines of large outputs,
 * inserting a "[... X lines omitted ...]" marker in the middle.
 * Better than simple truncation because it preserves both
 * the beginning (setup/context) and end (results/errors) of output.
 */

export interface HeadTailOptions {
  /** Max lines to keep from the start (default: 100) */
  headLines?: number;
  /** Max lines to keep from the end (default: 80) */
  tailLines?: number;
  /** Max total characters allowed (default: 50000) */
  maxChars?: number;
  /** Max output size in bytes before triggering (default: 1MB) */
  maxBytes?: number;
}

export interface TruncationResult {
  output: string;
  truncated: boolean;
  originalLines: number;
  omittedLines: number;
  originalBytes: number;
}

const DEFAULT_HEAD_LINES = 100;
const DEFAULT_TAIL_LINES = 80;
const DEFAULT_MAX_CHARS = 50000;
const DEFAULT_MAX_BYTES = 1024 * 1024; // 1 MiB

/**
 * Apply head/tail truncation to output text.
 * Returns the truncated text with a marker showing omitted lines.
 */
export function headTailTruncate(
  text: string,
  options: HeadTailOptions = {},
): TruncationResult {
  const {
    headLines = DEFAULT_HEAD_LINES,
    tailLines = DEFAULT_TAIL_LINES,
    maxChars = DEFAULT_MAX_CHARS,
    maxBytes = DEFAULT_MAX_BYTES,
  } = options;

  const originalBytes = Buffer.byteLength(text, 'utf-8');

  // Hard byte limit — truncate raw text first if enormous
  let workingText = text;
  if (originalBytes > maxBytes) {
    workingText = text.slice(0, maxBytes);
  }

  const lines = workingText.split('\n');
  const originalLines = lines.length;
  const totalKeep = headLines + tailLines;

  // No truncation needed
  if (lines.length <= totalKeep && workingText.length <= maxChars) {
    return {
      output: workingText,
      truncated: originalBytes > maxBytes,
      originalLines,
      omittedLines: 0,
      originalBytes,
    };
  }

  // Line-based truncation
  if (lines.length > totalKeep) {
    const head = lines.slice(0, headLines);
    const tail = lines.slice(-tailLines);
    const omitted = lines.length - totalKeep;

    const marker = `\n[... ${omitted} lines omitted ...]\n`;
    const result = head.join('\n') + marker + tail.join('\n');

    // Additional char truncation if still too long
    const finalOutput = result.length > maxChars
      ? result.slice(0, maxChars) + '\n[... output truncated at character limit ...]'
      : result;

    return {
      output: finalOutput,
      truncated: true,
      originalLines,
      omittedLines: omitted,
      originalBytes,
    };
  }

  // Char-based truncation only (few long lines)
  if (workingText.length > maxChars) {
    const omittedChars = workingText.length - maxChars;
    const markerText = `\n[... ${omittedChars} characters omitted ...]\n`;
    const availableChars = Math.max(0, maxChars - markerText.length);
    const halfChars = Math.floor(availableChars / 2);
    const head = workingText.slice(0, halfChars);
    const tail = workingText.slice(-halfChars);

    return {
      output: head + markerText + tail,
      truncated: true,
      originalLines,
      omittedLines: 0,
      originalBytes,
    };
  }

  return {
    output: workingText,
    truncated: false,
    originalLines,
    omittedLines: 0,
    originalBytes,
  };
}

/**
 * Quick check if text exceeds thresholds and needs truncation.
 */
export function needsTruncation(
  text: string,
  options: HeadTailOptions = {},
): boolean {
  const {
    headLines = DEFAULT_HEAD_LINES,
    tailLines = DEFAULT_TAIL_LINES,
    maxChars = DEFAULT_MAX_CHARS,
  } = options;

  if (text.length > maxChars) return true;

  // Quick line count without splitting the whole string
  let lineCount = 0;
  const threshold = headLines + tailLines;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lineCount++;
      if (lineCount > threshold) return true;
    }
  }
  return false;
}

// ============================================================================
// Semantic Truncation
// ============================================================================

export interface SemanticTruncationOptions extends HeadTailOptions {
  /** Preserve error lines (stderr patterns) in the middle section */
  preserveErrors?: boolean;
  /** Preserve JSON structure (keep opening/closing braces balanced) */
  preserveJson?: boolean;
  /** Custom patterns to always preserve (regex) */
  preservePatterns?: RegExp[];
}

/**
 * Error-like patterns that should be preserved during truncation.
 */
const ERROR_PATTERNS: RegExp[] = [
  /\b(?:Error|error|ERROR)\b/,
  /\b(?:Warning|warning|WARN)\b/,
  /\b(?:FAIL|FAILED|fail|failed)\b/,
  /\b(?:Exception|exception)\b/,
  /^\s*at\s+/,                    // Stack trace lines
  /\b(?:TypeError|ReferenceError|SyntaxError|RangeError)\b/,
  /\b(?:ENOENT|EACCES|EPERM|ECONNREFUSED)\b/,
  /\b(?:✗|✘|×|⨯)\b/,           // Failure markers
  /^\s*\^+\s*$/,                  // Caret error pointer
  /exit\s+code\s+\d+/i,
];

/**
 * Semantic truncation: preserves important content in the middle.
 *
 * Unlike basic head/tail truncation, this:
 * 1. Scans the middle section for error patterns
 * 2. Preserves those error lines in the output
 * 3. Attempts to keep JSON structure balanced
 * 4. Preserves custom user-defined patterns
 */
export function semanticTruncate(
  text: string,
  options: SemanticTruncationOptions = {},
): TruncationResult {
  const {
    headLines = DEFAULT_HEAD_LINES,
    tailLines = DEFAULT_TAIL_LINES,
    maxChars = DEFAULT_MAX_CHARS,
    maxBytes = DEFAULT_MAX_BYTES,
    preserveErrors = true,
    preserveJson = true,
    preservePatterns = [],
  } = options;

  const originalBytes = Buffer.byteLength(text, 'utf-8');

  // Hard byte limit
  let workingText = text;
  if (originalBytes > maxBytes) {
    workingText = text.slice(0, maxBytes);
  }

  const lines = workingText.split('\n');
  const originalLines = lines.length;
  const totalKeep = headLines + tailLines;

  // No truncation needed
  if (lines.length <= totalKeep && workingText.length <= maxChars) {
    return {
      output: workingText,
      truncated: originalBytes > maxBytes,
      originalLines,
      omittedLines: 0,
      originalBytes,
    };
  }

  if (lines.length <= totalKeep) {
    // Only char truncation needed — use basic approach
    return headTailTruncate(text, options);
  }

  const head = lines.slice(0, headLines);
  const tail = lines.slice(-tailLines);
  const middle = lines.slice(headLines, lines.length - tailLines);

  // Collect all patterns to check
  const allPatterns = [
    ...(preserveErrors ? ERROR_PATTERNS : []),
    ...preservePatterns,
  ];

  // Scan middle for important lines
  const importantLines: string[] = [];
  const maxImportantLines = 30; // Cap to avoid re-bloating

  for (let i = 0; i < middle.length && importantLines.length < maxImportantLines; i++) {
    const line = middle[i];
    const isImportant = allPatterns.some(p => p.test(line));

    if (isImportant) {
      importantLines.push(line);
      // Also grab 1 line of context after errors
      if (i + 1 < middle.length && importantLines.length < maxImportantLines) {
        importantLines.push(middle[i + 1]);
        i++; // Skip next
      }
    }
  }

  // Check JSON structure if needed
  let jsonNote = '';
  if (preserveJson && isLikelyJson(workingText)) {
    const depth = countJsonDepth(workingText);
    if (depth > 0) {
      jsonNote = `\n[Note: JSON structure depth=${depth}, may be incomplete]`;
    }
  }

  // Build output
  const omitted = middle.length - importantLines.length;
  const parts: string[] = [
    ...head,
    '',
    `[... ${omitted} lines omitted ...]`,
  ];

  if (importantLines.length > 0) {
    parts.push(`[${importantLines.length} important lines preserved:]`);
    parts.push(...importantLines);
    parts.push(`[... end preserved lines ...]`);
  }

  if (jsonNote) {
    parts.push(jsonNote);
  }

  parts.push('', ...tail);

  let result = parts.join('\n');

  // Final char limit
  if (result.length > maxChars) {
    result = result.slice(0, maxChars) + '\n[... output truncated at character limit ...]';
  }

  return {
    output: result,
    truncated: true,
    originalLines,
    omittedLines: omitted,
    originalBytes,
  };
}

function isLikelyJson(text: string): boolean {
  const trimmed = text.trim();
  return (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
         (trimmed.endsWith('}') || trimmed.endsWith(']'));
}

function countJsonDepth(text: string): number {
  let depth = 0;
  let maxDepth = 0;
  for (const ch of text) {
    if (ch === '{' || ch === '[') { depth++; maxDepth = Math.max(maxDepth, depth); }
    if (ch === '}' || ch === ']') depth--;
  }
  return depth; // Unclosed depth (0 = balanced)
}
