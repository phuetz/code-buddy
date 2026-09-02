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

/**
 * Detect a tool call that the model rendered as text instead of sending as a
 * structured call. Only names from the active built-in tool registry count;
 * ordinary prose containing parentheses must not change the exit status.
 */
export function findUnexecutedProseToolCall(
  resultText: string,
  knownToolNames: Iterable<string>,
  executedToolNames: Iterable<string>,
): UnexecutedProseToolCall | null {
  const known = new Set(knownToolNames);
  const executed = new Set(executedToolNames);
  const callPattern = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*\((.*)\)\s*$/;

  for (const rawLine of resultText.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = callPattern.exec(line);
    const toolName = match?.[1];
    if (!toolName || !known.has(toolName) || executed.has(toolName)) continue;
    return { toolName, line };
  }

  return null;
}
