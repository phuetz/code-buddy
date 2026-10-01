import { stripVTControlCharacters } from 'node:util';
import { TOOL_METADATA } from '../tools/metadata.js';
import { TOOL_ALIASES } from '../tools/registry/tool-alias-map.js';
import { parseBashCommand } from '../security/bash-parser.js';
import { shellCheckScope } from './shell-execution-evidence.js';

export interface TaskEvidenceEntry {
  type: string;
  content: string;
  terminationReason?: string;
  truncated?: boolean;
  toolCall?: { id: string; function: { name: string; arguments: string } };
  toolResult?: { success: boolean; output?: string; error?: string; metadata?: Record<string, unknown> };
}

export interface HeadlessTaskOutcome {
  status: 'success' | 'failed' | 'unverified';
  success: boolean;
  exitCode: number;
  reasons: string[];
  actionTools: string[];
  checks: Array<{ tool: string; command?: string; success: boolean; required?: boolean }>;
}

/** The CLI reports evidence of completion, never infers execution from prose. */
export function requestsRepositoryAction(prompt: string): boolean {
  const text = prompt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/^(?:please|can you|could you|peux-tu|pourrais-tu|s'il te plait)\s+/, '');
  const informational = /^(?:explain|describe|summari[sz]e|analy[sz]e|compare|review|audit|read|show|list|what|where|which|count|how|why|tell|reply|respond|answer|say|translate|explique|decris|resume|analyse|compare|audite|lis|montre|liste|quel|quelle|quels|quelles|ou|combien|comment|pourquoi|reponds|dis|traduis)\b/;
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
function completedGreen(entry: TaskEvidenceEntry): boolean {
  const output = stripVTControlCharacters([entry.toolResult?.output, entry.content].filter(Boolean).join('\n'));
  return /^\s*# tests [1-9]\d*\b/m.test(output) && /^\s*# fail 0\b/m.test(output)
    || /\bTest (?:Files|Suites):?\s+[1-9]\d*\s+passed\b/i.test(output) && /\bTests:?\s+[1-9]\d*\s+passed\b/i.test(output)
    || /^\s*ℹ tests [1-9]\d*\b/m.test(output) && /^\s*ℹ fail 0\b/m.test(output);
}

function runtimeShell(entry: TaskEvidenceEntry): { command: string; cwd: string; testScript?: string; changedFiles?: string[] } | undefined {
  const value = entry.toolResult?.metadata?.shellExecution;
  if (!value || typeof value !== 'object') return undefined;
  const fields = value as Record<string, unknown>;
  return typeof fields.command === 'string' && typeof fields.cwd === 'string'
    ? { command: fields.command, cwd: fields.cwd, ...(typeof fields.testScript === 'string' ? { testScript: fields.testScript } : {}),
      ...(Array.isArray(fields.changedFiles) && fields.changedFiles.every(file => typeof file === 'string') ? { changedFiles: fields.changedFiles as string[] } : {}) } : undefined;
}

function checkIdentity(entry: TaskEvidenceEntry, command: string | undefined, success: boolean, prompt: string): { command?: string; directory?: string; alternatives?: string[] } {
  if (!command) return {};
  const echoed = echoedCheckStatus(entry, command);
  const checkCommand = echoed?.command ?? command;
  const scoped = shellCheckScope(checkCommand);
  const directory = scoped.directory;
  let body = scoped.body;
  const formatter = /\s*\|\s*(?:head|tail)(?:\s+(?:-\d+|-n\s*\d+))?\s*$/;
  let formatted = false;
  while (formatter.test(body)) { body = body.replace(formatter, ''); formatted = true; }
  const clean = (part: string) => part.replace(/\s*2>&1\s*$/, '').trim();
  const simpleCheck = (part: string) => /^(?:npm|pnpm|yarn|bun|npx|node|vitest|jest|eslint|tsc|pytest|cargo|go|dotnet|just)(?:\s|$)/.test(part)
    && /\b(?:test|tests|lint|eslint|vitest|jest|tsc|pytest|check|typecheck)\b/.test(part)
    && !/[;&|<>$`\n]/.test(part);
  const script = runtimeShell(entry)?.testScript;
  const canonical = (part: string) => script && simpleCheck(script)
    && (/^(?:npm (?:test|run test)|(?:yarn|pnpm|bun) test)$/.test(part)
      // A speculative --run fallback is not the user's default project check.
      // Only its literal execution-mode switch may be covered by a later full
      // default run of the SAME observed package script, never a test filter.
      || !prompt.includes('--run') && /^npm (?:test|run test) -- --run$/.test(part)) ? script : part;
  // A successful pipeline can hide a runner's exit code. It may clear a
  // previous failure only when the runner's completed green summary is seen.
  const observedStatus = !echoed || !success || echoed.code === 0;
  body = clean(body);
  if (simpleCheck(body) && observedStatus && (!formatted || !success || completedGreen(entry))) return { command: canonical(body), ...(directory ? { directory } : {}) };
  // A literal OR between test runners is one fallback group. A later member
  // may recover it only in the same observed cwd with a completed green suite.
  // Mixed lint/test chains, substitutions, redirects and unknown syntax stay closed.
  const alternatives = body.split('||').map(clean);
  if (alternatives.length > 1 && !echoed && alternatives.every(part => simpleCheck(part)
    && /(?:\btest\b|\btests\b|\bvitest\b|\bjest\b|\bpytest\b)/.test(part)
    && !/\b(?:lint|eslint|tsc|typecheck)\b/.test(part))) {
    return { command, alternatives: alternatives.map(canonical), ...(directory ? { directory } : {}) };
  }
  return { command, ...(directory ? { directory } : {}) };
}

function inspection(command: string): boolean {
  if (/[$`<>\n]/.test(command)) return false;
  const parsed = parseBashCommand(shellCheckScope(command).body);
  return !parsed.warnings.length && parsed.commands.length > 0 && parsed.commands.every(part =>
    !part.isSubshell && ['cat', 'ls', 'pwd', 'echo', 'head', 'tail'].includes(part.command)
    && (part.connector === null || part.connector === '&&'));
}

/** Hermes agent/verification_stop.py inspired this independently written evidence check. */
export function unsupportedActionClaims(response: string, entries: readonly TaskEvidenceEntry[]): string[] {
  const editedPaths = new Set<string>();
  const createdPaths = new Set<string>();
  const commands = new Set<string>();
  const observed = { edit: false, create: false, run: false, tests: false, testRun: false };
  for (const entry of entries) {
    if (entry.type !== 'tool_result' || !entry.toolCall || !entry.toolResult?.success) continue;
    const name = TOOL_ALIASES[entry.toolCall.function.name] ?? entry.toolCall.function.name;
    const args = argumentsOf(entry);
    const command = runtimeShell(entry)?.command ?? String(args.command ?? args.cmd ?? '');
    const write = TOOL_METADATA.find(tool => tool.name === name)?.category === 'file_write'
      && !(name === 'str_replace_editor' && /^(?:view|read)$/.test(command));
    observed.edit ||= write || !!runtimeShell(entry)?.changedFiles?.length;
    if (write) {
      const file = args.path ?? args.file_path ?? args.file;
      if (typeof file === 'string') editedPaths.add(file);
      if (name === 'apply_patch') for (const match of String(args.patch ?? args.input ?? '').matchAll(/\*\*\* (?:Add|Update|Delete) File: ([^\n]+)/g)) editedPaths.add(match[1]!.trim());
    }
    for (const file of runtimeShell(entry)?.changedFiles ?? []) editedPaths.add(file);
    if (['bash', 'test_runner', 'lint_project'].includes(name)) commands.add(shellCheckScope(command).body.trim());
    const creates = name === 'create_file' || name === 'scaffold_app'
      || name === 'str_replace_editor' && command === 'create'
      || name === 'apply_patch' && /\*\*\* Add File:/.test(String(args.patch ?? args.input ?? ''))
;
    observed.create ||= creates;
    if (creates) {
      const file = args.path ?? args.file_path ?? args.file;
      if (typeof file === 'string') createdPaths.add(file);
      if (name === 'apply_patch') for (const match of String(args.patch ?? args.input ?? '').matchAll(/\*\*\* Add File: ([^\n]+)/g)) createdPaths.add(match[1]!.trim());
    }
    observed.run ||= ['bash', 'test_runner', 'lint_project'].includes(name);
    observed.testRun ||= (name === 'test_runner' || name === 'bash' && /\b(?:test|tests|vitest|jest|pytest)\b/.test(command)) && !hasRedVerification(entry, name, command);
    observed.tests ||= (name === 'test_runner' || name === 'bash' && /\b(?:test|tests|vitest|jest|pytest)\b/.test(command))
      && !hasRedVerification(entry, name, command) && completedGreen(entry);
  }
  // Quoted examples, fenced code, explicit negation and future advice are not
  // completion claims. This recognizer is deliberately bounded, not a semantic oracle.
  const text = response.replace(/```[\s\S]*?```/g, '').replace(/[’‘]/g, "'");
  const claims = new Set<string>();
  for (const rawSentence of text.split(/(?<=[.!?])\s+|[;\n]|,\s*(?=i\b|j'ai\b|nous avons\b|we\b)|\b(?:but|and|mais|et)\s+(?=i\b|j'ai\b|nous avons\b|we\b)/i)) {
    const sentence = rawSentence.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/^\s*(?:the documentation says|documentation says|example|exemple)\s*:/.test(sentence)) continue;
    // A cognitive act or a reading attempt is not an execution claim. Match
    // objects, not just past-tense verbs (Hermes verification-stop inspiration).
    const cognitive = /\b(?:ran (?:into|the risk|a quick scan)|created (?:a |the )?mental model|modified (?:my |our )?understanding|lance (?:une analyse du code|la lecture de)|execute les instructions mentalement)\b/.test(sentence);
    if (cognitive) continue;
    const paths = [...rawSentence.matchAll(/(?:[\w-]+\/)*[\w-]+\.(?:[cm]?[jt]sx?|py|rs|go|json|md|txt|ya?ml|toml)\b/g)].map(match => match[0]);
    const targetsObserved = (observedPaths: Set<string>) => paths.every(file => [...observedPaths].some(actual => actual === file || actual.endsWith('/' + file)));
    const executionObject = /\b(?:npm|pnpm|yarn|bun|node|pytest|vitest|jest|cargo|go test|tests?|command|commande|script|ls|pwd|bash)\b/.test(sentence) || /`[^`]+`/.test(sentence);
    const literalCommands = [...rawSentence.matchAll(/`([^`]+)`/g)].map(match => match[1]!.trim());
    literalCommands.push(...[...rawSentence.matchAll(/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+[\w:-]+|test|build|install)\b/g)].map(match => match[0]));
    const commandsObserved = literalCommands.every(command => [...commands].some(actual => actual === command));
    // Negation/advice frames the asserted action only when it precedes it.
    // A later 'not documented' must not erase a concrete past-tense claim.
    const assertionStart = sentence.search(/\b(?:i(?:'ve| have)?|we(?:'ve| have)?|j'ai|nous avons)\s+|\b(?:all |les |tous les )?tests?\s+/);
    const framing = assertionStart < 0 ? sentence : sentence.slice(0, assertionStart);
    if (/\b(?:not|never|cannot|can't|didn't|haven't|will|would|should|could|if|ne|pas|jamais|vais|devrais|pourrais|si)\b/.test(framing)
      || /\bthe command i ran earlier was not executed by me\b/.test(sentence)) continue;
    if (/\b(?:i(?:'ve| have)?|we(?:'ve| have)?|j'ai|nous avons)\s+(?:successfully\s+)?(?:edited|modified|changed|updated|fixed|modifie|corrige|remplace|mis a jour)\b/.test(sentence) && (!observed.edit || !targetsObserved(editedPaths))) claims.add('edit');
    if (/\b(?:i(?:'ve| have)?|we(?:'ve| have)?|j'ai|nous avons)\s+(?:successfully\s+)?(?:created|written|cree|ecrit)\b/.test(sentence) && (!observed.create || !targetsObserved(createdPaths))) claims.add('create');
    if (/\b(?:i(?:'ve| have)?|we(?:'ve| have)?|j'ai|nous avons)\s+(?:successfully\s+)?(?:ran|executed|launched|run|lance|execute)\b/.test(sentence) && executionObject && (!observed.run || !commandsObserved || /\b(?:test|tests|vitest|jest|pytest)\b/.test(sentence) && !observed.testRun)) claims.add('run');
    if (/\b(?:tests? (?:all )?(?:pass(?:ed)?|passent|reussis|verts)|(?:all|les|tous les) tests? (?:have )?(?:pass(?:ed)?|passent|reussi)|test suite (?:passed|is green))\b/.test(sentence) && !observed.tests) claims.add('tests');
  }
  return [...claims];
}

export function evaluateHeadlessTaskOutcome(
  prompt: string,
  entries: readonly TaskEvidenceEntry[],
  responseExitCode = 0,
): HeadlessTaskOutcome {
  const actionTools: string[] = [];
  // A later success clears only the SAME command/check, in the SAME directory.
  // Thus a passing unit test cannot erase a failed linter or a different suite.
  const checks = new Map<string, { tool: string; command?: string; success: boolean; directory: unknown; alternatives?: string[]; optionalRead?: boolean; sequence: number }>();
  let shellDirectoryGeneration = 0;
  let lastWrite = -1;
  let lastGreen = -1;
  for (const [sequence, entry] of entries.entries()) {
    if (entry.type !== 'tool_result' || !entry.toolCall || !entry.toolResult) continue;
    const name = TOOL_ALIASES[entry.toolCall.function.name] ?? entry.toolCall.function.name;
    const args = argumentsOf(entry);
    const metadata = TOOL_METADATA.find(tool => tool.name === name);
    const execution = name === 'bash' || name === 'lint_project' || name === 'test_runner';
    const write = metadata?.category === 'file_write'
      && !(name === 'str_replace_editor' && /^(?:view|read)$/.test(String(args.command)));
    if (entry.toolResult.success && (write || execution || name === 'scaffold_app')) actionTools.push(name);
    const hostShell = name === 'bash' ? runtimeShell(entry) : undefined;
    const rawCommand = hostShell?.command ?? (typeof (args.command ?? args.cmd) === 'string' ? String(args.command ?? args.cmd).trim() : undefined);
    if (entry.toolResult.success && (write || name === 'bash' && !!hostShell?.changedFiles?.length)) lastWrite = sequence;
    if (execution) {
      const command = rawCommand;
      // A shell can retain a directory change across calls. Without an
      // explicit cwd, a green suite after `cd` cannot clear the earlier red
      // suite: the executor has not supplied evidence that they share a root.
      if (name === 'bash' && /(?:^|[;&|]\s*)(?:cd|pushd|popd)(?:\s|$)/.test(command ?? '')) shellDirectoryGeneration++;
      const success = entry.toolResult.success && !hasRedVerification(entry, name, command);
      const observedEcho = command ? echoedCheckStatus(entry, command) : undefined;
      const checkBody = shellCheckScope(observedEcho?.command ?? command ?? '').body.replace(/\s*2>&1\s*$/, '').trim();
      const unfilteredStatus = !/[;&|<>$`\n]/.test(checkBody) && (!observedEcho || observedEcho.code === 0);
      if (success && (completedGreen(entry) || unfilteredStatus) && (name === 'test_runner' || name === 'bash'
        && /\b(?:npm|pnpm|yarn|bun|npx|node|vitest|jest|pytest|cargo|go)\b/.test(command ?? '')
        && /\b(?:test|tests|vitest|jest|pytest)\b/.test(command ?? ''))) lastGreen = sequence;
      const identity = name === 'bash' ? checkIdentity(entry, command, success, prompt) : { command };
      const directory = identity.directory ?? hostShell?.cwd ?? (name === 'bash' ? shellDirectoryGeneration : args.cwd ?? args.root ?? args.directory ?? '');
      if (success && completedGreen(entry)) {
        for (const check of checks.values()) {
          if (check.tool === name && check.directory === directory && identity.command && check.alternatives?.includes(identity.command)) check.success = true;
        }
      }
      const key = JSON.stringify([name, identity.command, directory, args.args ?? args.runner ?? '']);
      const optionalRead = name === 'bash' && command && inspection(command)
        && /\b(?:replace|edit|modify|change|fix|repair|refactor|remplace|modifie|corrige|repare)\b/i.test(prompt)
        && !/\b(?:cat|ls|pwd|head|tail)\b/.test(prompt);
      checks.set(key, { tool: name, ...(command ? { command } : {}), success, directory,
        ...('alternatives' in identity ? { alternatives: identity.alternatives } : {}), optionalRead: !!optionalRead, sequence });
    }
  }
  const reasons: string[] = [];
  if (entries.some(entry => entry.terminationReason || entry.truncated)) reasons.push('execution_stopped');
  if (responseExitCode !== 0) reasons.push('response_failed');
  if (entries.some(entry => entry.type === 'assistant' && /Stopped by the loop guard|maximum (?:number of )?tool|read budget exhausted|Session cost limit reached|Operation cancelled by user|execution stopped|context compaction refused/i.test(entry.content))) reasons.push('execution_stopped');
  const final = [...entries].reverse().find(entry => entry.type === 'assistant')?.content ?? '';
  if (unsupportedActionClaims(final, entries).length) reasons.push('unsupported_action_claim');
  if ([...checks.values()].some(check => !check.success && !(check.optionalRead && lastWrite > check.sequence))) reasons.push('verification_failed');
  if (requestsRepositoryAction(prompt) && actionTools.length === 0) reasons.push('no_action_executed');
  const actionRequested = requestsRepositoryAction(prompt);
  const normalizedPrompt = prompt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const testRequest = actionRequested && /\b(?:run|execute|lance|relance|lancer)\b.*\btests?\b/.test(normalizedPrompt);
  if (testRequest && (lastGreen < 0 || lastGreen < lastWrite)) reasons.push('verification_missing');
  const editRequest = actionRequested && !testRequest && (/\b(?:replace|edit|modify|change|refactor|remplace|modifie|ecris|cree|create|write)\b/.test(normalizedPrompt)
    || /\b(?:fix|repair|corrige|repare)\b/.test(normalizedPrompt) && !/\b(?:tests?|lint|eslint|typecheck|checks?)\b/.test(normalizedPrompt));
  if (editRequest && lastWrite < 0) reasons.push('requested_edit_not_executed');
  const status = reasons.some(reason => reason !== 'no_action_executed') ? 'failed'
    : reasons.length ? 'unverified' : 'success';
  return { status, success: status === 'success', exitCode: responseExitCode || (reasons.includes('unsupported_action_claim') ? 4 : status === 'success' ? 0 : 1), reasons, actionTools,
    checks: [...checks.values()].map(({ tool, command, success, optionalRead, sequence }) => ({ tool, ...(command ? { command } : {}), success,
      ...(optionalRead && lastWrite > sequence ? { required: false } : {}) })) };
}
