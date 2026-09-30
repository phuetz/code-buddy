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
  const text = prompt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/^(?:explain|describe|summari[sz]e|what|how|explique|decris|resume|comment|pourquoi)\b/.test(text)
    && !/\b(?:and|et|puis)\s+(?:fix|edit|change|create|corrige|modifie|cree)\b/.test(text)) return false;
  if (/\b(?:fix|repair|refactor|implement|scaffold|modify|correct|resolve|corrige[rz]?|repare[rz]?|refactorise[rz]?|implemente[rz]?|modifie[rz]?|remplace[rz]?|supprime[rz]?|mets?\s+a\s+jour)\b/.test(text)) return true;
  // Imperative changes remain tasks when their object is not a file name
  // (for example "add pagination" or "create a REST API").
  if (/^(?:(?:please|s'il te plait|peux-tu|can you|could you)\s+)?(?:create|edit|change|update|add|remove|delete|switch|cree[rz]?|ajoute[rz]?|change[rz]?|retire[rz]?)\b/.test(text)) return true;
  return /\b(?:create|write|edit|change|update|add|remove|delete|run|execute|make|ensure|build|cree[rz]?|ecris|ecrivez|ajoute[rz]?|lance[rz]?|execute[rz]?|fais|faites|rends|rendez)\b/.test(text)
    && /\b(?:file|files|code|app|application|project|projet|fichier|fichiers|function|fonction|tests?|lint|eslint|script|server|serveur|package)\b|\.[cm]?[jt]sx?\b|\.txt\b/.test(text);
}

function argumentsOf(entry: TaskEvidenceEntry): Record<string, unknown> {
  try {
    const args: unknown = JSON.parse(entry.toolCall?.function.arguments ?? '{}');
    return args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {};
  } catch { return {}; }
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
      const directory = args.cwd ?? args.root ?? args.directory ?? (name === 'bash' ? shellDirectoryGeneration : '');
      const key = JSON.stringify([name, command, directory, args.args ?? args.runner ?? '']);
      checks.set(key, { tool: name, ...(command ? { command } : {}), success: entry.toolResult.success });
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
