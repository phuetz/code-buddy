export interface HeadlessOutputOptions {
  output?: string;
  outputFormat?: string;
}

export interface UnexecutedProseToolCall {
  toolName: string;
  line: string;
}

export function resolveHeadlessOutputFormat(options: HeadlessOutputOptions): string {
  return options.outputFormat || options.output || 'json';
}

export function resolveHeadlessResultExitCode(resultText: string): number {
  const normalized = resultText.trim().toLowerCase();
  if (normalized.startsWith('sorry, i encountered an error:')) {
    return 1;
  }
  return 0;
}

const LINE_CALL_PATTERN = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*\((.*)\)\s*$/;
const XML_TOOL_PATTERNS = [
  /<tool_call\b[^>]*\bname\s*=\s*["']([A-Za-z_][A-Za-z0-9_.-]*)["'][^>]*>/gi,
  /<(?:invoke|function|tool)\b[^>]*\bname\s*=\s*["']([A-Za-z_][A-Za-z0-9_.-]*)["'][^>]*>/gi,
  /<tool_call>\s*([A-Za-z_][A-Za-z0-9_.-]*)\b/gi,
];
const JSON_TOOL_PATTERN = /\{\s*"(?:name|tool)"\s*:\s*"([A-Za-z_][A-Za-z0-9_.-]*)"/g;

function firstKnownUnexecuted(
  candidates: Iterable<{ toolName: string; line: string }>,
  known: Set<string>,
  executed: Set<string>,
): UnexecutedProseToolCall | null {
  for (const candidate of candidates) {
    if (!known.has(candidate.toolName) || executed.has(candidate.toolName)) continue;
    return candidate;
  }
  return null;
}

/**
 * Detect a tool call that the model rendered as text instead of sending as a
 * structured call. Whole-line `name(...)`, indented lines, XML wrappers, and
 * JSON `{"name":"..."}` objects count; ordinary prose with parentheses must
 * not change the exit status.
 */
export function findUnexecutedProseToolCall(
  resultText: string,
  knownToolNames: Iterable<string>,
  executedToolNames: Iterable<string>,
): UnexecutedProseToolCall | null {
  const known = new Set(knownToolNames);
  const executed = new Set(executedToolNames);
  const lineCandidates: UnexecutedProseToolCall[] = [];
  for (const rawLine of resultText.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = LINE_CALL_PATTERN.exec(line);
    const toolName = match?.[1];
    if (!toolName) continue;
    lineCandidates.push({ toolName, line });
  }
  const fromLines = firstKnownUnexecuted(lineCandidates, known, executed);
  if (fromLines) return fromLines;

  const xmlCandidates: UnexecutedProseToolCall[] = [];
  for (const pattern of XML_TOOL_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(resultText)) !== null) {
      const toolName = match[1];
      if (!toolName) continue;
      xmlCandidates.push({ toolName, line: match[0] });
    }
  }
  const fromXml = firstKnownUnexecuted(xmlCandidates, known, executed);
  if (fromXml) return fromXml;

  const jsonCandidates: UnexecutedProseToolCall[] = [];
  JSON_TOOL_PATTERN.lastIndex = 0;
  let jsonMatch: RegExpExecArray | null;
  while ((jsonMatch = JSON_TOOL_PATTERN.exec(resultText)) !== null) {
    const toolName = jsonMatch[1];
    if (!toolName) continue;
    jsonCandidates.push({ toolName, line: jsonMatch[0] });
  }
  return firstKnownUnexecuted(jsonCandidates, known, executed);
}

export function resolveHeadlessTurnExitCode(
  resultText: string,
  knownToolNames: Iterable<string>,
  executedToolNames: Iterable<string>,
): number {
  if (findUnexecutedProseToolCall(resultText, knownToolNames, executedToolNames)) {
    return 3;
  }
  return resolveHeadlessResultExitCode(resultText);
}
