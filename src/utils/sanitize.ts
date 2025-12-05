/**
 * Input sanitization utilities to prevent injection attacks
 * and validate user input
 */

import { ValidationError } from './errors.js';

/**
 * Sanitize a file path to prevent directory traversal attacks
 * @param filePath - The file path to sanitize
 * @param allowAbsolute - Whether to allow absolute paths
 * @returns Sanitized file path
 * @throws ValidationError if path is invalid or contains dangerous patterns
 */
export function sanitizeFilePath(
  filePath: string,
  allowAbsolute: boolean = true
): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new ValidationError('File path must be a non-empty string', 'filePath', filePath);
  }

  const trimmed = filePath.trim();

  if (trimmed === '') {
    throw new ValidationError('File path cannot be empty', 'filePath', filePath);
  }

  // Check for null bytes (can be used to bypass security checks)
  if (trimmed.includes('\0')) {
    throw new ValidationError(
      'File path contains null bytes',
      'filePath',
      filePath
    );
  }

  // Check for directory traversal patterns
  const dangerousPatterns = [
    '../',
    '..\\',
    '/..',
    '\\..',
    '....', // Unusual patterns
  ];

  for (const pattern of dangerousPatterns) {
    if (trimmed.includes(pattern)) {
      throw new ValidationError(
        `File path contains dangerous pattern: ${pattern}`,
        'filePath',
        filePath
      );
    }
  }

  // Check if absolute path is allowed
  if (!allowAbsolute) {
    if (trimmed.startsWith('/') || /^[a-zA-Z]:/.test(trimmed)) {
      throw new ValidationError(
        'Absolute paths are not allowed',
        'filePath',
        filePath
      );
    }
  }

  return trimmed;
}

/**
 * Sanitize command arguments to prevent command injection
 * @param arg - The argument to sanitize
 * @returns Sanitized argument
 * @throws ValidationError if argument contains dangerous characters
 */
export function sanitizeCommandArg(arg: string): string {
  if (typeof arg !== 'string') {
    throw new ValidationError('Argument must be a string', 'arg', arg);
  }

  const trimmed = arg.trim();

  // Check for null bytes
  if (trimmed.includes('\0')) {
    throw new ValidationError(
      'Argument contains null bytes',
      'arg',
      arg
    );
  }

  // Check for command injection patterns
  const dangerousChars = [
    ';',  // Command separator
    '&',  // Background execution / AND
    '|',  // Pipe
    '$',  // Variable expansion / command substitution
    '`',  // Command substitution
    '\n', // Newline
    '\r', // Carriage return
  ];

  for (const char of dangerousChars) {
    if (trimmed.includes(char)) {
      throw new ValidationError(
        `Argument contains dangerous character: ${char}`,
        'arg',
        arg
      );
    }
  }

  // Check for command substitution patterns
  if (trimmed.includes('$(') || trimmed.includes('${')) {
    throw new ValidationError(
      'Argument contains command substitution pattern',
      'arg',
      arg
    );
  }

  return trimmed;
}

/**
 * Escape special characters in a string for safe use in regex
 * @param str - The string to escape
 * @returns Escaped string safe for regex
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitize HTML to prevent XSS attacks
 * Basic implementation - for terminal output
 * @param html - The HTML string to sanitize
 * @returns Sanitized HTML
 */
export function sanitizeHTML(html: string): string {
  if (typeof html !== 'string') {
    return '';
  }

  return html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Validate and sanitize an email address
 * @param email - The email to validate
 * @returns Sanitized email
 * @throws ValidationError if email is invalid
 */
export function sanitizeEmail(email: string): string {
  if (!email || typeof email !== 'string') {
    throw new ValidationError('Email must be a non-empty string', 'email', email);
  }

  const trimmed = email.trim().toLowerCase();

  // Basic email validation pattern
  const emailPattern = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

  if (!emailPattern.test(trimmed)) {
    throw new ValidationError('Invalid email format', 'email', email);
  }

  return trimmed;
}

/**
 * Validate and sanitize a URL
 * @param url - The URL to validate
 * @param allowedProtocols - List of allowed protocols (default: ['http', 'https'])
 * @returns Sanitized URL
 * @throws ValidationError if URL is invalid
 */
export function sanitizeURL(
  url: string,
  allowedProtocols: string[] = ['http', 'https']
): string {
  if (!url || typeof url !== 'string') {
    throw new ValidationError('URL must be a non-empty string', 'url', url);
  }

  const trimmed = url.trim();

  let parsedURL: URL;
  try {
    parsedURL = new URL(trimmed);
  } catch (_error) {
    throw new ValidationError('Invalid URL format', 'url', url);
  }

  // Check protocol
  const protocol = parsedURL.protocol.slice(0, -1); // Remove trailing ':'
  if (!allowedProtocols.includes(protocol)) {
    throw new ValidationError(
      `Protocol '${protocol}' is not allowed. Allowed: ${allowedProtocols.join(', ')}`,
      'url',
      url
    );
  }

  // Check for javascript: protocol (XSS)
  if (trimmed.toLowerCase().startsWith('javascript:')) {
    throw new ValidationError(
      'JavaScript URLs are not allowed',
      'url',
      url
    );
  }

  return parsedURL.toString();
}

/**
 * Validate that a string contains only alphanumeric characters and specific allowed characters
 * @param str - The string to validate
 * @param allowedChars - Additional characters to allow (e.g., '-_')
 * @returns True if valid, false otherwise
 */
export function isAlphanumeric(str: string, allowedChars: string = ''): boolean {
  if (typeof str !== 'string') {
    return false;
  }

  const escapedAllowed = escapeRegex(allowedChars);
  const pattern = new RegExp(`^[a-zA-Z0-9${escapedAllowed}]+$`);

  return pattern.test(str);
}

/**
 * Limit string length and add ellipsis if needed
 * @param str - The string to truncate
 * @param maxLength - Maximum length
 * @param ellipsis - String to append when truncated (default: '...')
 * @returns Truncated string
 */
export function truncateString(
  str: string,
  maxLength: number,
  ellipsis: string = '...'
): string {
  if (typeof str !== 'string') {
    return '';
  }

  if (str.length <= maxLength) {
    return str;
  }

  return str.slice(0, maxLength - ellipsis.length) + ellipsis;
}

/**
 * Remove control characters from a string
 * @param str - The string to clean
 * @returns String without control characters
 */
export function removeControlCharacters(str: string): string {
  if (typeof str !== 'string') {
    return '';
  }

  // Remove all control characters except \n, \r, \t
  // eslint-disable-next-line no-control-regex -- Intentionally matching control characters for sanitization
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Validate JSON string and parse safely
 * @param jsonString - The JSON string to parse
 * @returns Parsed JSON object
 * @throws ValidationError if JSON is invalid
 */
export function sanitizeJSON<T = any>(jsonString: string): T {
  if (!jsonString || typeof jsonString !== 'string') {
    throw new ValidationError('JSON must be a non-empty string', 'json', jsonString);
  }

  try {
    return JSON.parse(jsonString);
  } catch (error) {
    throw new ValidationError(
      `Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}`,
      'json',
      jsonString
    );
  }
}

/**
 * Validate and sanitize a port number
 * @param port - The port number (string or number)
 * @returns Valid port number
 * @throws ValidationError if port is invalid
 */
export function sanitizePort(port: string | number): number {
  const portNum = typeof port === 'string' ? parseInt(port, 10) : port;

  if (isNaN(portNum)) {
    throw new ValidationError('Port must be a number', 'port', port);
  }

  if (portNum < 1 || portNum > 65535) {
    throw new ValidationError(
      'Port must be between 1 and 65535',
      'port',
      port
    );
  }

  return portNum;
}

/**
 * Sanitize LLM output by removing control tokens and internal markers
 * These tokens can leak from models like Grok and should not be displayed
 * @param content - The LLM output content to sanitize
 * @returns Sanitized content without control tokens
 */
export function sanitizeLLMOutput(content: string): string {
  if (!content || typeof content !== 'string') {
    return '';
  }

  let sanitized = content;

  // Control tokens pattern from Grok and other models
  // Matches: <|token_name|>, <|token_name|>content, etc.
  sanitized = sanitized.replace(/<\|[^|>]+\|>/g, '');

  // JSON-escaped control tokens: \u003c|token|\u003e
  sanitized = sanitized.replace(/\\u003c\|[^|>]+\|\\u003e/gi, '');

  // Internal commentary/tool call patterns (multiple formats)
  // Format 1: "commentary to=action json{...}" or "commentary to=action{...}"
  sanitized = sanitized.replace(/\bcommentary\s+to=\w+\s*(?:json)?\s*\{[^]*?\}(?:\s*\n)?/gi, '');

  // Format 2: "commentary to=action" without JSON (simpler tool calls)
  sanitized = sanitized.replace(/\bcommentary\s+to=\w+[^\n]*\n?/gi, '');

  // Tool call JSON patterns that should not be displayed
  // Matches: {"path": "...", ...} or {"content": "...", ...}
  sanitized = sanitized.replace(/\{"(?:path|content|query|max_results|tool|action)":\s*"[^]*?"\s*\}/g, '');

  // Remove standalone tool keywords at start of content
  sanitized = sanitized.replace(/^(search\s+code|create_file|read_file|edit_file|run_command|json)\s*/i, '');

  // IMPORTANT: Do NOT trim or collapse spaces for streaming chunks!
  // Each chunk may contain leading/trailing spaces that are significant
  // for word boundaries. Only remove excessive newlines.
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n'); // More than 2 newlines to 2

  return sanitized;
}

/**
 * Tool call extracted from commentary format
 */
export interface ExtractedToolCall {
  name: string;
  arguments: Record<string, unknown>;
  raw: string;
}

/**
 * Extract tool calls from "commentary to=tool_name {...}" format
 * Used for models that don't support native OpenAI tool calls
 *
 * @param content - Raw LLM output content
 * @returns Array of extracted tool calls and remaining content
 */
export function extractCommentaryToolCalls(content: string): {
  toolCalls: ExtractedToolCall[];
  remainingContent: string;
} {
  const toolCalls: ExtractedToolCall[] = [];
  let remaining = content;

  // Pattern 1: commentary to=tool_name with various token formats
  // Handles: "commentary to=web_search {...}"
  // Handles: "commentary to=web_search <|constrain|>json<|message|>{...}"
  // Handles: "<|channel|>commentary to=web_search <|constrain|>json<|message|>{...}"
  const pattern1 = /(?:<\|[^|>]+\|>)*\s*\bcommentary\s+to=(\w+)\s*(?:<\|[^|>]+\|>)*\s*(?:json)?\s*(?:<\|[^|>]+\|>)*\s*(\{[^]*?\})/gi;
  let match1: RegExpExecArray | null;

  while ((match1 = pattern1.exec(content)) !== null) {
    const toolName = match1[1];
    const argsJson = match1[2];

    try {
      const args = JSON.parse(argsJson);
      toolCalls.push({
        name: toolName,
        arguments: args,
        raw: match1[0],
      });
      remaining = remaining.replace(match1[0], '');
    } catch {
      // Invalid JSON, skip this match
    }
  }

  // Pattern 2: Direct tool name with JSON (e.g., "web_search {...}")
  const pattern2 = /\b(web_search|search|view_file|create_file|bash|git)\s*(\{[^]*?\})/gi;
  let match2: RegExpExecArray | null;

  while ((match2 = pattern2.exec(content)) !== null) {
    // Avoid double-parsing if already extracted via commentary
    if (toolCalls.some(tc => tc.raw.includes(match2![2]))) continue;

    const toolName = match2[1];
    const argsJson = match2[2];

    try {
      const args = JSON.parse(argsJson);
      toolCalls.push({
        name: toolName,
        arguments: args,
        raw: match2[0],
      });
      remaining = remaining.replace(match2[0], '');
    } catch {
      // Invalid JSON, skip
    }
  }

  return {
    toolCalls,
    remainingContent: remaining.trim(),
  };
}
