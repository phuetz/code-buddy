import { stripVTControlCharacters } from 'node:util';
import { TOOL_METADATA } from '../tools/metadata.js';
import { TOOL_ALIASES } from '../tools/registry/tool-alias-map.js';

export interface TaskEvidenceEntry {
  type: string;
  content: string;
  toolCall?: { id: string; function: { name: string; arguments: string } };
  toolResult?: { success: boolean; output?: string; error?: string };
}

export interface HeadlessTaskOutcome {
  status: 'success' | 'failed' | 'unverified';
  success: boolean;
  exitCode: number;
  reasons: string[];
  actionTools: string[];
  checks: Array<{ tool: string; command?: string; success: boolean }>;
}

/** The CLI reports evidence of completion, never infers execution from prose. */
export function requestsRepositoryAction(prompt: string): boolean {
  const text = prompt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/^(?:please|can you|could you|peux-tu|pourrais-tu|s'il te plait)\s+/, '');
  const informational = /^(?:explain|describe|summari[sz]e|analy[sz]e|compare|review|audit|read|show|list|what|how|why|tell|reply|respond|answer|say|translate|explique|decris|resume|analyse|compare|audite|lis|montre|liste|comment|pourquoi|reponds|dis|traduis)\b/;
  const compoundAction = /\b(?:and|et|puis|then|ensuite)\s+(?:please\s+)?(?:fix|repair|refactor|scaffold|resolve|build|write|delete|replace|edit|change|create|run|execute|implement|add|remove|update|make|ensure|correct|modify|prepare|deploy|install|configure|start|stop|corrige|repare|refactorise|remplace|ecris|execute|modifie|cree|lance|ajoute|supprime|mets|installe|demarre|rends|fais)\b/.test(text)
    || [...text.matchAll(/\b(?:then|puis|ensuite)\s+(?:please\s+)?(\S+)/g)].some(match => !informational.test(match[1]!));
  if (!compoundAction && informational.test(text)) return false;
  if (/^(?:hi|hello|hey|bonjour|salut)[!.?]*$/.test(text)) return false;
  if (/^write (?:a |an )?(?:poem|story|essay|email|sql query)\b/.test(text) && !compoundAction) return false;
  // An ambiguous request is not evidence that this is merely a conversation.
  // Fail closed: only an explicit informational request can succeed without
  // an action. This also covers imperative languages not in the verb list.
  return true;
}

function argumentsOf(entry: TaskEvidenceEntry): Record<string, unknown> {
  try {
    const args: unknown = JSON.parse(entry.toolCall?.function.arguments ?? '{}');
    return args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {};
  } catch { return {}; }
}

/** Recognize only an immediate echo of the preceding command's real status. */
function echoedCheckStatus(entry: TaskEvidenceEntry, command: string): { command: string; code?: number } | undefined {
  const suffix = command.match(/;\s*echo\s+(?:"(exit|status|code)\s*[:=]\s*\$\?"|(exit|status|code)\s*[:=]\s*\$\?)\s*$/i);
  if (!suffix) return undefined;
  const label = suffix[1] ?? suffix[2];
  const output = stripVTControlCharacters(entry.toolResult?.output ?? entry.content).trim()
    .replace(/\n\[sandbox:[^\n]*\]\s*$/, '').trim();
  const lastLine = output.split('\n').at(-1) ?? '';
  const observed = lastLine.match(new RegExp(`^\\s*${label}\\s*[:=]\\s*(\\d+)\\s*$`, 'i'));
  return { command: command.slice(0, suffix.index).trim(), ...(observed ? { code: Number(observed[1]) } : {}) };
}

function hasRedVerification(entry: TaskEvidenceEntry, name: string, command?: string): boolean {
  const verifies = name === 'lint_project' || name === 'test_runner'
    || /(?:^|[\s;&|])(?:npm|pnpm|yarn|bun|npx|node|vitest|jest|eslint|tsc|pytest|cargo|go|dotnet)(?=\s|$)/.test(command ?? '')
      && /\b(?:test|tests|lint|eslint|vitest|jest|tsc|pytest|check|typecheck)\b/.test(command ?? '');
  if (!verifies) return false;
  if (command && (echoedCheckStatus(entry, command)?.code ?? 0) > 0) return true;
  const output = stripVTControlCharacters([entry.toolResult?.output, entry.toolResult?.error, entry.content].filter(Boolean).join('\n'));
  return /^\s*# fail [1-9]\d*\b/m.test(output)
    || /^\s*not ok \d+\b/m.test(output)
    || /\b(?:Test Files|Tests|Test Suites):?\s+[1-9]\d*\s+failed\b/i.test(output)
    || /\([1-9]\d* errors?,\s*\d+ warnings?\)/i.test(output)
    || /\berror TS\d+:/i.test(output)
    || /^FAILED(?:\s|$)/m.test(output)
    || /(?:npm ERR!|npm error|Error: Cannot find module|(?:eslint|vitest|jest|tsc|pytest): command not found)/i.test(output);
}

/** Match only a literal directory and harmless formatting of a completed check. */
function checkIdentity(entry: TaskEvidenceEntry, command: string | undefined, success: boolean): { command?: string; directory?: string } {
  if (!command) return {};
  const echoed = echoedCheckStatus(entry, command);
  const checkCommand = echoed?.command ?? command;
  const scoped = checkCommand.match(/^cd\s+(\/[^\s;&|<>$`'"\\]+|"\/[^"$`\\]+"|'\/[^'\\]+')\s*&&\s*(.+)$/);
  const directory = scoped?.[1]?.replace(/^['"]|['"]$/g, '');
  let body = scoped?.[2] ?? checkCommand;
  const formatter = /\s*\|\s*(?:head|tail)(?:\s+(?:-\d+|-n\s*\d+))?\s*$/;
  let formatted = false;
  while (formatter.test(body)) { body = body.replace(formatter, ''); formatted = true; }
  body = body.replace(/\s*2>&1\s*$/, '').trim();
  const simpleCheck = /^(?:npm|pnpm|yarn|bun|npx|node|vitest|jest|eslint|tsc|pytest|cargo|go|dotnet)\s/.test(body)
    && /\b(?:test|tests|lint|eslint|vitest|jest|tsc|pytest|check|typecheck)\b/.test(body)
    && !/[;&|<>$`\n]/.test(body);
  const output = stripVTControlCharacters([entry.toolResult?.output, entry.content].filter(Boolean).join('\n'));
  const completedGreen = /^\s*# tests [1-9]\d*\b/m.test(output) && /^\s*# fail 0\b/m.test(output)
    || /\bTest (?:Files|Suites):?\s+[1-9]\d*\s+passed\b/i.test(output) && /\bTests:?\s+[1-9]\d*\s+passed\b/i.test(output);
  // A successful pipeline can hide a runner's exit code. It may clear a
  // previous failure only when the runner's completed green summary is seen.
  const observedStatus = !echoed || !success || echoed.code === 0;
  if (simpleCheck && observedStatus && (!formatted || !success || completedGreen)) return { command: body, ...(directory ? { directory } : {}) };
  return { command, ...(directory ? { directory } : {}) };
}

export function evaluateHeadlessTaskOutcome(
  prompt: string,
  entries: readonly TaskEvidenceEntry[],
  responseExitCode = 0,
): HeadlessTaskOutcome {
  const actionTools: string[] = [];
  // A later success clears only the SAME command/check, in the SAME directory.
  // Thus a passing unit test cannot erase a failed linter or a different suite.
  const checks = new Map<string, { tool: string; command?: string; success: boolean }>();
  let shellDirectoryGeneration = 0;
  for (const entry of entries) {
    if (entry.type !== 'tool_result' || !entry.toolCall || !entry.toolResult) continue;
    const name = TOOL_ALIASES[entry.toolCall.function.name] ?? entry.toolCall.function.name;
    const args = argumentsOf(entry);
    const metadata = TOOL_METADATA.find(tool => tool.name === name);
    const execution = name === 'bash' || name === 'lint_project' || name === 'test_runner';
    const write = metadata?.category === 'file_write'
      && !(name === 'str_replace_editor' && /^(?:view|read)$/.test(String(args.command)));
    if (entry.toolResult.success && (write || execution || name === 'scaffold_app')) actionTools.push(name);
    if (execution) {
      const command = typeof (args.command ?? args.cmd) === 'string' ? String(args.command ?? args.cmd).trim() : undefined;
      // A shell can retain a directory change across calls. Without an
      // explicit cwd, a green suite after `cd` cannot clear the earlier red
      // suite: the executor has not supplied evidence that they share a root.
      if (name === 'bash' && /(?:^|[;&|]\s*)(?:cd|pushd|popd)(?:\s|$)/.test(command ?? '')) shellDirectoryGeneration++;
      const success = entry.toolResult.success && !hasRedVerification(entry, name, command);
      const identity = name === 'bash' ? checkIdentity(entry, command, success) : { command };
      const directory = identity.directory ?? args.cwd ?? args.root ?? args.directory ?? (name === 'bash' ? shellDirectoryGeneration : '');
      const key = JSON.stringify([name, identity.command, directory, args.args ?? args.runner ?? '']);
      checks.set(key, { tool: name, ...(command ? { command } : {}), success });
    }
  }
  const reasons: string[] = [];
  if (responseExitCode !== 0) reasons.push('response_failed');
  if (/Stopped by the loop guard|maximum (?:number of )?tool|read budget exhausted/i.test(entries.at(-1)?.content ?? '')) reasons.push('execution_stopped');
  if ([...checks.values()].some(check => !check.success)) reasons.push('verification_failed');
  if (requestsRepositoryAction(prompt) && actionTools.length === 0) reasons.push('no_action_executed');
  const status = reasons.some(reason => reason !== 'no_action_executed') ? 'failed'
    : reasons.length ? 'unverified' : 'success';
  return { status, success: status === 'success', exitCode: responseExitCode || (status === 'success' ? 0 : 1), reasons, actionTools, checks: [...checks.values()] };
}
