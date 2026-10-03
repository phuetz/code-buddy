import path from 'node:path';
import { splitHeadlessClauses, isIncidentalHeadlessClause } from './headless-clauses.js';
import { isHeadlessProhibition, unwrapHeadlessRequest } from './headless-prohibition.js';
import { parseTestOutput } from '../utils/test-output-parser.js';
import { checkHeadlessDeliverable } from './headless-deliverable.js';
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

/** Independent clauses carry independent obligations; unknown imperatives stay closed. */
function repositoryActionClauses(prompt: string): string[] {
  const text = prompt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/^(?:please|can you|could you|would you|will you|est-ce que tu peux|est-ce que vous pouvez|peux-tu|pourrais-tu|s'il te plait)\s+/, '');
  // Apostrophes inside words are not quote delimiters. Keep a physical-target
  // marker for quoted paths so output formatting cannot hide a requested file.
  const unquoted = text.replace(/`[^`]*`|"[^"\n]*"|(?<![\w])'[^'\n]*'/g, quoted =>
    /[\w/-]+\.[a-z0-9]+\b/.test(quoted) ? 'file_target ' + (/agents\.md/.test(quoted) ? 'agents' : '') : 'quoted');
  // Clause boundaries are grammatical separators, independent of the next
  // verb's vocabulary. Otherwise an unfamiliar operation after "and" vanishes.
  const clauses = splitHeadlessClauses(unquoted).map(clause => unwrapHeadlessRequest(clause).replace(/^(?:please|then|puis|ensuite|and|et)\s+/, ''));
  const informational = /^(?:explain|describe|summari[sz]e|analy[sz]e|compare|review|audit|read|trace|cite|identify|locate|inspect|consult|report|outline|highlight|state|mention|show|list|what|where|which|count|how|why|tell|reply|respond|answer|say|translate|explique|decris|resume|analyse|compare|audite|lis|recense|identifie|repere|consulte|indique|montre|liste|quel|quelle|quels|quelles|ou|combien|comment|pourquoi|reponds|dis|traduis)\b/;
  const outputConstraint = (clause: string): boolean => {
    // An output rule cannot exempt an independent, unfamiliar operation.
    const conjuncts = clause.split(/\s+\b(?:and|et)\b\s+/);
    if (conjuncts.length > 1) return conjuncts.every(part => outputConstraint(part)
      || informational.test(part) || /^(?:do not|don't|never|ne\b.*\bpas)\b/.test(part));
    if (/^(?:nothing else|rien d'autre)[.!]?$/.test(clause)) return true;
    if (/^(?:with\s+)?(?:no|without)\s+(?:extra\s+)?(?:commentary|chatter|prose|explanation|text)(?:\s+(?:afterwards|afterward|please))?$/.test(clause)) return true;
    // Restitution is an answer unless it names a write destination or changes
    // a function's return behavior. Source locations are not destinations.
    if (/^(?:return|renvoie|affiche|present|presente|give\s+(?:me|us)|donne(?:-moi|\s+moi)?)\b/.test(clause)
      && !/\b(?:to|into|vers|dans)\s+(?:a\s+)?(?:file_target|file\b|[\w/-]+\.[a-z0-9]+\b)|\bfrom\s+(?:the\s+)?function\b/.test(clause)) return true;
    const outputVerb = /\b(?:write|use|output|return|keep|put|give|ecris|utilise|renvoie|affiche|applique|garde)\b/.test(clause);
    const outputObject = /\b(?:answers?|repl(?:y|ies)|response|text|sentence|names?|values?|outputs?|results?|summar(?:y|ies)|lists?|signatures?|numerals?|numbers?|json|reponse|texte|phrase|nom|valeur|chiffre)\b/.test(clause);
    const physical = /\b(?:file_target|files?|folders?|director(?:y|ies)|source|module|script|function|implementation|parameters?|code|fichiers?|dossiers?|parametres?)\b|[\w/-]+\.[a-z0-9]+\b/.test(clause);
    // Applying a reading layout is presentation; an unrelated physical target
    // remains an action. AGENTS.md is the source of the rule, not a write target.
    const presentation = /\b(?:format|layout|header|en-tete|presentation)\b/.test(clause);
    const presentationTarget = clause.replace(/\bagents\.md\b/g, 'agents');
    const writesTarget = /\b(?:file_target|files?|folders?|director(?:y|ies)|source|module|script|function|implementation|parameters?|code|fichiers?|dossiers?|parametres?)\b|[\w/-]+\.[a-z0-9]+\b/.test(presentationTarget);
    if (/^(?:follow|respect|obey|applique|respecte|suis)\b/.test(clause)
      && /\b(?:format|rules?|instructions?|agents|reading|lecture|consignes?)\b/.test(clause)
      && !writesTarget && !/\bby\b/.test(clause)) return true;
    if (/^(?:use|utilise)\b/.test(clause) && presentation && !writesTarget) return true;
    return outputVerb && (outputObject || /\b(?:only|alone|just)\b/.test(clause)) && !physical;
  };
  return clauses.filter((clause, index) => {
    if (isIncidentalHeadlessClause(clause, index)) return false;
    // Prohibitions take precedence over every positive means clause. French
    // ne…que is restrictive, so it remains a positive request below.
    if (isHeadlessProhibition(clause)) return false;
    // Auxiliary-led interrogatives ask for an observation, not an imperative.
    // Each subsequent independent clause is still checked separately.
    if (/^(?:does|did|is|are|was|were|has|had|will|would|could)\b|^(?:do|have|can)\s+(?:you|we|they|i|it|this|these|those)\b|^est-ce\s+que\b/.test(clause)) return false;
    // A requested means of delivery remains an obligation even when the
    // leading verb only asks to show or explain. Negated means stay read-only.
    if (/\b(?:by|en)\s+(?:editing|writing|saving|creating|replacing|changing|updating|deleting|modifiant|ecrivant|creant|remplacant|changeant|supprimant)\b/.test(clause)
      && /\b(?:file_target|files?|source|module|script|fichiers?)\b|[\w/-]+\.[a-z0-9]+\b/.test(clause)) return true;
    // A courtesy question takes the infinitive in French.
    if (/^(?:expliquer|decrire|resumer|analyser|comparer|auditer|lire|identifier|reperer|consulter|indiquer|montrer|lister|repondre)\b/.test(clause)) return false;
    // French ne…que restricts a positive request; it does not prohibit it.
    clause = clause.replace(/^ne\s+(\S+)\s+que\s+/, '$1 ');
    // Supplements constrain the preceding answer; they are not imperatives.
    // Splitting coordination must not turn a noun phrase into a write request.
    const dependent = /^(?:with|without|using|including|preserving|keeping|retaining|according to|avec|sans|en incluant|en conservant|selon)\b/;
    const nominal = /^(?:the|their|its|these|those|le|la|les|ses|leurs)\s+/;
    // A supplementary clause can itself request a write. Its grammatical
    // attachment is not permission to waive an explicit physical operation.
    const modifierWrite = /\b(?:writing|saving|editing|creating|replacing|ecrivant|creant|modifiant)\b|\b(?:saved|written)\s+(?:to|into)\b/.test(clause)
      && /\b(?:file_target|file|source|module|script|fichier)\b|[\w/-]+\.[a-z0-9]+\b/.test(clause);
    if (dependent.test(clause) && !modifierWrite || index > 0 && nominal.test(clause)
      && !/\b(?:must|shall|should|needs?|requires?|doit|doivent|is|are|be|etre|sont|est)\b/.test(clause)) return false;
    // Negation in French need not contain "pas" (aucun/rien/jamais).
    if (/^ne\b.*\b(?:aucun\w*|rien|jamais)\b/.test(clause)) return false;
    // Following a source means tracing it or obeying its reading rules. A
    // physical change introduced by "by" remains an operation.
    if (/^(?:follow|respect|obey|respecte|suis)(?:\b|-)/.test(clause)
      && !/\b(?:by|en modifiant|en changeant)\b/.test(clause)
      && !/\bfile_target\b|[\w/-]+\.[a-z0-9]+\b/.test(clause.replace(/\bagents\.md\b/g, 'agents'))) return false;
    // Source-to-language conversion is an implementation request, unlike
    // translating prose. Do not exempt it just because "translate" is a
    // common informational verb.
    if (/^(?:translate|traduis)\b/.test(clause)
      && !/^(?:translate|traduis)\s+(?:(?:the|this|une?|la|le)\s+)?(?:explanation|description|documentation|comments?|sentence|paragraph|prose|explication|phrase|commentaires?)\b/.test(clause)
      && /\b(?:to|into|en)\s+\S+/.test(clause)
      && /\b(?:source|code|implementation|module)\b|\.(?:[cm]?[jt]sx?|py|rs|go|java|cs|cpp|c|rb|sh)\b/.test(unquoted)) return true;
    if (/^(?:after|before|apres|avant)\b/.test(clause) && clauses[index + 1] && outputConstraint(clauses[index + 1]!)) return false;
    if (/^(?:do not|don't|never|ne\b.*\bpas)\b/.test(clause)) return false;
    if (outputConstraint(clause)) return false;
    if (informational.test(clause)) return false;
    // A coordinated noun list is still the object of the preceding read.
    if (index > 0 && (informational.test(clauses[index - 1]!) || /^(?:follow|suis)\b/.test(clauses[index - 1]!))
      && /^(?:(?:actual|observed|printed|computed|expected)\s+)?(?:files?|folders?|imports?|exports?|names?|values?|parameters?|calculations?|dependencies|inputs?|outputs?|arguments?|results?|numbers?)(?:\s+(?:of|from|in)\s+(?:file_target|[\w./-]+))?$/.test(clause)) return false;
    if (/^(?:hi|hello|hey|bonjour|salut)$/.test(clause)) return false;
    if (/^write (?:a |an )?(?:poem|story|essay|email|sql query)\b/.test(clause)
      && !/\bfile_target\b/.test(clause)) return false;
    // Fail closed for every other independent clause, without looking up the
    // unfamiliar verb in an imperative whitelist or a benchmark prompt.
    return true;
  });
}

/** The CLI reports evidence of completion, never infers execution from prose. */
export function requestsRepositoryAction(prompt: string): boolean {
  return repositoryActionClauses(prompt).length > 0;
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
  // Bash may render a successful process as structured test results. A zero
  // process status cannot erase failing assertions in either representation.
  for (const text of [entry.toolResult?.output, entry.content]) {
    if (!text) continue;
    try {
      const data = JSON.parse(text);
      if (data?.type === 'test-results' && typeof data.summary?.failed === 'number' && data.summary.failed > 0) return true;
    } catch { /* Plain output is parsed below. */ }
  }
  if ((parseTestOutput(output).data?.summary.failed ?? 0) > 0) return true;
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
    !part.isSubshell && ['cat', 'ls', 'pwd', 'echo', 'head', 'tail', 'grep', 'rg'].includes(part.command)
    && !(part.command === 'rg' && part.args.some(arg => /^(?:--pre|--hostname-bin)(?:=|$)/.test(arg)))
    && (part.connector === null || part.connector === '&&' || part.connector === '|'));
}

/** A runner must actually be the executable, not a word in a read/echo. */
function executesCheck(command: string, testsOnly = false): boolean {
  const parsed = parseBashCommand(shellCheckScope(command).body);
  const first = parsed.commands[0];
  if (parsed.warnings.length || !first || first.isSubshell) return false;
  if (!['npm', 'pnpm', 'yarn', 'bun', 'npx', 'node', 'vitest', 'jest', 'eslint', 'tsc', 'pytest', 'cargo', 'go', 'dotnet', 'just'].includes(first.command)) return false;
  if (['node', 'bun'].includes(first.command) && first.args.some(arg => ['-e', '--eval', '-p', '--print'].includes(arg))) return false;
  return (testsOnly ? /\b(?:test|tests|vitest|jest|pytest)\b/ : /\b(?:test|tests|lint|eslint|vitest|jest|tsc|pytest|check|typecheck|validate)\b/).test(first.raw);
}

/** Hermes agent/verification_stop.py inspired this independently written evidence check. */
export function unsupportedActionClaims(response: string, entries: readonly TaskEvidenceEntry[]): string[] {
  const editedPaths = new Set<string>();
  const createdPaths = new Set<string>();
  const commands = new Set<string>();
  const observed = { edit: false, create: false, run: false, tests: false, testRun: false, verification: false, lint: false };
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
    observed.lint ||= (name === 'lint_project' || name === 'bash' && executesCheck(command)
      && /\b(?:lint|eslint)\b/.test(command)) && !hasRedVerification(entry, name, command);
    observed.verification ||= (['test_runner', 'lint_project'].includes(name)
      || name === 'bash' && executesCheck(command))
      && !inspection(command) && !hasRedVerification(entry, name, command);
    observed.testRun ||= (name === 'test_runner' || name === 'bash' && executesCheck(command, true)) && !hasRedVerification(entry, name, command);
    observed.tests ||= (name === 'test_runner' || name === 'bash' && executesCheck(command, true))
      && !hasRedVerification(entry, name, command) && completedGreen(entry);
  }
  // Quoted examples, fenced code, explicit negation and future advice are not
  // completion claims. This recognizer is deliberately bounded, not a semantic oracle.
  const text = response.replace(/```[\s\S]*?```/g, '').replace(/[’‘]/g, "'");
  const claims = new Set<string>();
  for (const rawSentence of text.split(/(?<=[.!?])\s+|[;\n]|,\s*(?=i\b|j'ai\b|nous avons\b|we\b)|\b(?:but|and|mais|et)\s+(?=i\b|j'ai\b|nous avons\b|we\b)/i)) {
    const sentence = rawSentence.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/^\s*(?:the documentation says|documentation says|example|exemple)\s*:/.test(sentence)) continue;
    // Negation/advice frames the asserted action only when it precedes it.
    const assertionStart = sentence.search(/\b(?:i(?:'ve| have)?|we(?:'ve| have)?|j'ai|nous avons)\s+|\b(?:all |les |tous les )?tests?\s+/);
    const framing = assertionStart < 0 ? sentence : sentence.slice(0, assertionStart);
    if (/\b(?:not|never|cannot|can't|didn't|haven't|will|would|should|could|if|ne|pas|jamais|vais|devrais|pourrais|si)\b/.test(framing)
      || /\bthe command i ran earlier was not executed by me\b/.test(sentence)) continue;
    // Classify the grammatical object, not a list of complete benchmark
    // sentences. A summary/interpretation can be composed in the answer;
    // an on-disk target or an operational completion always requires tools.
    // Independently written, inspired by Hermes' verification-stop boundary.
    const assertions = [...sentence.matchAll(/(?:\b(?:i(?:'ve| have)?|we(?:'ve| have)?|j'ai|nous avons)\s+|\b(?:and|then|et|puis)\s+(?:(?:i(?:'ve| have)?|we(?:'ve| have)?|j'ai|nous avons)\s+)?|^\s*)(?:successfully\s+)?(edited|modified|changed|updated|fixed|created|written|wrote|ran|executed|launched|started|run|modifie|corrige|remplace|mis a jour|cree|ecrit|lance|execute|demarre)\b/g)];
    for (const [index, assertion] of assertions.entries()) {
      const verb = assertion[1]!;
      // Bare imperative "Run ..." is advice, unlike past-tense "Ran ...".
      if (verb === 'run' && !/\b(?:i|we)\b/.test(assertion[0])) continue;
      const objectStart = assertion.index! + assertion[0].length;
      const objectEnd = assertions[index + 1]?.index ?? sentence.length;
      const object = sentence.slice(objectStart, objectEnd)
        .split(/\s+\b(?:but|mais|after|while|when|apres|pendant)\b|\b(?:and|et)\s+(?=(?:reading|read|checked|inspected|lecture|lu)\b)/)[0]!.trim();
      // Map normalized offsets back to the original spelling (including case).
      // Incidental reading after an assertion is not an edit/run target.
      const offsets: number[] = [];
      let rawOffset = 0;
      for (const character of rawSentence) {
        const normalized = character.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        for (let i = 0; i < normalized.length; i++) offsets.push(rawOffset);
        rawOffset += character.length;
      }
      const rawObject = rawSentence.slice(offsets[objectStart] ?? rawSentence.length, offsets[objectEnd] ?? rawSentence.length)
        .split(/\s+\b(?:but|mais|after|while|when|après|pendant)\b|\b(?:and|et)\s+(?=(?:reading|read|checked|inspected|lecture|lu)\b)/i)[0]!;
      const paths = [...rawObject.matchAll(/(?:[\w-]+\/)*[\w-]+\.(?:[cm]?[jt]sx?|py|rs|go|json|md|txt|ya?ml|toml)\b/g)].map(match => match[0]);
      const targetsObserved = (observedPaths: Set<string>) => paths.every(file => [...observedPaths].some(actual => actual === file || actual.endsWith('/' + file)));
      const literalCommands = [...rawObject.matchAll(/`([^`]+)`/g)].map(match => match[1]!.trim());
      literalCommands.push(...[...rawObject.matchAll(/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+[\w:-]+|test|build|install)\b/g)].map(match => match[0]));
      const commandsObserved = literalCommands.every(command => [...commands].some(actual => actual === command));
      const head = object.replace(/^(?:(?:a|an|the|my|our|initial|brief|quick|mental|all|existing|project|tous|toutes|une?|les?|la|des|mon|ma|mes|notre|nos|premiere?)\s+)*/, '').replace(/^l'/, '').replace(/^through\s+(?:the\s+)?/, '');
      if (/^(?:into|across|out of)\b/.test(head) && !/^[\w./-]+\.[a-z0-9]+\b|^[\w.-]+\//.test(head)) continue;
      const abstract = /^(?:overview|summary|outline|explanation|interpretation|understanding|hypothesis|comprehension|notes?|list|risk|scan|analysis|reading|search|reasoning|logic|flow|walk-through|resume|apercu|liste|analyse|lecture|recherche|raisonnement|interpretation|hypothese)\b/.test(head)
        // An unqualified index can assert a database operation. Only an index
        // explicitly describing its subject is an abstract reading artifact.
        || /^index\s+(?:of|de)\b/.test(head)
        || /^map\b/.test(head) && /\bmental\b/.test(object);
      const physicalHead = /^[\w./-]+\.[a-z0-9]+\b|^[\w.-]+\//.test(head)
        || /\b(?:files?|folders?|director(?:y|ies)|documents?|scripts?|modules?|tools?|services?|servers?|apps?|components?|class(?:es)?|functions?|programs?|packages?|generators?|utilit(?:y|ies)|pipelines?|endpoints?|fichiers?|dossiers?)\b/.test(head.split(/\b(?:of|de|about|sur)\b/)[0]!);
      // In 'a list of imports in source.js', the path locates the subject of
      // thought. In 'a list in notes.md', it is the asserted write destination.
      const objectHead = object.split(/\b(?:of|de|about|sur)\b/)[0]!;
      const physicalDestination = /\b(?:in|to|as|dans|vers)\s+[`"']?(?:[\w-]+\/)*[\w-]+\.[a-z0-9]+\b/.test(abstract ? objectHead : object);
      const manualWalk = /^(?:ran|execute|executed)$/.test(verb)
        && (/^through\b/.test(object) || abstract)
        && /\b(?:by hand|mentally|in my head|mentalement|de tete|dans ma tete)\b/.test(object)
        && !physicalHead && !physicalDestination && paths.length === 0;
      if (manualWalk) continue;
      if (!physicalHead && !physicalDestination && (abstract || /^model\b/.test(head) && /\bmental(?:ly|ement)?\b/.test(object) || /^(?:into|across|out of)\b/.test(head)
        || /^(?:instructions?|steps?|procedure)\b/.test(head) && paths.length === 0 && literalCommands.length === 0 && /\b(?:mentally|mentalement|de tete)\b/.test(object))) continue;
      if (/^(?:edited|modified|changed|updated|fixed|modifie|corrige|remplace|mis a jour)$/.test(verb)
        && (!observed.edit || !targetsObserved(editedPaths))) claims.add('edit');
      if (/^(?:created|written|wrote|cree|ecrit)$/.test(verb)
        && (!observed.create || !targetsObserved(createdPaths))) claims.add('create');
      if (/^(?:ran|executed|launched|started|run|lance|execute|demarre)$/.test(verb)) {
        // No executable whitelist: even an unfamiliar validator or server
        // counts as an operational claim. Evidence for `ls` cannot attest it.
        const operation = head.replace(/[`"']/g, '').replace(/\s+\b(?:and|et)\s+(?:it|they|cela|il|elle)\s+(?:succeeded|completed|worked|finished|a reussi|ont reussi|a termine)\b.*$/, '').replace(/\s+(?:successfully|avec succes).*$/, '').replace(/[.!?]+$/, '').trim();
        const stem = (word: string) => ['linter', 'eslint'].includes(word) ? 'lint' : word.replace(/s$/, '');
        const words = operation.split(/[^\w-]+/).filter(Boolean).map(stem);
        const generic = /^(?:commands?|commandes?|scripts?)$/.test(operation);
        const test = /\btests?\b|\btest suite\b/.test(operation);
        const verification = /\b(?:checks?|validation|controles?|verifications?)\b/.test(operation);
        const linter = /^(?:lint|linter|eslint)$/.test(operation);
        const corresponding = generic || linter && observed.lint || test && observed.testRun || verification && observed.verification || [...commands].some(command => {
          const parsed = parseBashCommand(shellCheckScope(command).body);
          if (parsed.warnings.length || parsed.commands.some(part => part.isSubshell)) return false;
          return parsed.commands.some(part => {
            // An inspection or an echo can mention a build/server without
            // executing it. A syntax-only node check cannot start a server.
            if (['cat', 'ls', 'pwd', 'echo', 'head', 'tail', 'grep', 'rg', 'sed'].includes(part.command)
              && stem(part.command) !== words[0]) return false;
            if (/^(?:started|demarre)$/.test(verb) && /(?:^|\s)(?:--check|-c)(?:\s|$)/.test(part.raw)) return false;
            const actual = part.raw.split(/[^\w-]+/).filter(Boolean).map(stem);
            return words.length > 0 && words.every(word => actual.includes(word));
          });
        });
        if (!observed.run || !commandsObserved || !corresponding || test && !observed.testRun) claims.add('run');
      }
    }
    if (/\b(?:tests? (?:all )?(?:pass(?:ed)?|passent|reussis|verts)|(?:all|les|tous les) tests? (?:have )?(?:pass(?:ed)?|passent|reussi)|test suite (?:passed|is green))\b/.test(sentence) && !observed.tests) claims.add('tests');
  }
  return [...claims];
}

/** Literal file identities only; the case belongs to the filesystem, not to intent normalization. */
function namedFiles(clause: string): string[] {
  return [...clause.matchAll(/`([^`]+)`|"([^"\n]+)"|(?<![\w])'([^'\n]+)'|((?:\/)?[\w.-]+(?:\/[\w.-]+)*\.[a-zA-Z][\w.-]*)/g)]
    .map(match => (match[1] ?? match[2] ?? match[3] ?? match[4]!).replace(/[.!?]+$/, ''))
    .filter(file => /\.[a-zA-Z][\w-]*$/.test(file))
    .map(file => path.resolve(file));
}

function writtenFiles(entries: readonly TaskEvidenceEntry[]): Set<string> {
  const files = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== 'tool_result' || !entry.toolCall || !entry.toolResult?.success) continue;
    const name = TOOL_ALIASES[entry.toolCall.function.name] ?? entry.toolCall.function.name;
    const args = argumentsOf(entry);
    const write = TOOL_METADATA.find(tool => tool.name === name)?.category === 'file_write'
      && !(name === 'str_replace_editor' && /^(?:view|read)$/.test(String(args.command)));
    const file = args.path ?? args.file_path ?? args.file;
    if (write && typeof file === 'string') files.add(path.resolve(file));
    if (name === 'apply_patch') {
      for (const match of String(args.patch ?? args.input ?? '').matchAll(/\*\*\* (?:Add|Update|Delete) File: ([^\n]+)/g)) files.add(path.resolve(match[1]!.trim()));
    }
    for (const file of runtimeShell(entry)?.changedFiles ?? []) files.add(path.resolve(runtimeShell(entry)?.cwd ?? process.cwd(), file));
  }
  return files;
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
    const hostShell = name === 'bash' ? runtimeShell(entry) : undefined;
    const rawCommand = hostShell?.command ?? (typeof (args.command ?? args.cmd) === 'string' ? String(args.command ?? args.cmd).trim() : undefined);
    const inspected = name === 'bash' && rawCommand && inspection(rawCommand);
    const inspectionName = inspected ? parseBashCommand(shellCheckScope(rawCommand).body).commands[0]?.command : undefined;
    const explicitlyRequestedInspection = inspectionName && new RegExp('\\b(?:run|execute|lance|lancer)\\b[^.!?;\\n]*\\b' + inspectionName + '\\b', 'i').test(prompt);
    if (entry.toolResult.success && (write || execution && (!inspected || explicitlyRequestedInspection) || name === 'scaffold_app')) actionTools.push(name);
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
        && executesCheck(command ?? '', true))) lastGreen = sequence;
      const identity = name === 'bash' ? checkIdentity(entry, command, success, prompt) : { command };
      const directory = identity.directory ?? hostShell?.cwd ?? (name === 'bash' ? shellDirectoryGeneration : args.cwd ?? args.root ?? args.directory ?? '');
      if (success && completedGreen(entry)) {
        for (const check of checks.values()) {
          if (check.tool === name && check.directory === directory && identity.command && check.alternatives?.includes(identity.command)) check.success = true;
        }
      }
      const key = JSON.stringify([name, identity.command, directory, args.args ?? args.runner ?? '']);
      const optionalRead = name === 'bash' && command && inspection(command)
        && requestsRepositoryAction(prompt)
        && !/\b(?:cat|ls|pwd|head|tail|grep|rg)\b/.test(prompt);
      checks.set(key, { tool: name, ...(command ? { command } : {}), success, directory,
        ...('alternatives' in identity ? { alternatives: identity.alternatives } : {}), optionalRead: !!optionalRead, sequence });
    }
  }
  const reasons: string[] = [];
  if (entries.some(entry => entry.terminationReason || entry.truncated)) reasons.push('execution_stopped');
  if (responseExitCode !== 0) reasons.push('response_failed');
  if (entries.some(entry => entry.type === 'assistant' && /Stopped by the loop guard|maximum (?:number of )?tool|read budget exhausted|Session cost limit reached|Operation cancelled by user|execution stopped|context compaction refused/i.test(entry.content))) reasons.push('execution_stopped');
  const finalIndex = entries.findLastIndex(entry => entry.type === 'assistant');
  const final = entries[finalIndex]?.content ?? '';
  if (!final.trim() || entries.findLastIndex(entry => entry.type === 'tool_result') > finalIndex)
    reasons.push('final_answer_missing');
  reasons.push(...checkHeadlessDeliverable(prompt, final, entries, '', !requestsRepositoryAction(prompt)).reasons);
  if (unsupportedActionClaims(final, entries).length) reasons.push('unsupported_action_claim');
  if ([...checks.values()].some(check => !check.success && !(check.optionalRead && lastWrite > check.sequence))) reasons.push('verification_failed');
  if (requestsRepositoryAction(prompt) && actionTools.length === 0) reasons.push('no_action_executed');
  const actionRequested = requestsRepositoryAction(prompt);
  if (!actionRequested && lastWrite >= 0) reasons.push('unexpected_edit_executed');
  const actionClauses = repositoryActionClauses(prompt);
  const testRequest = actionClauses.some(clause => /\b(?:run|execute|lance|relance|lancer|make|ensure|fais|rends|check|verify|verifie|controle)\b.*\btests?\b/.test(clause));
  if (testRequest && (lastGreen < 0 || lastGreen < lastWrite)) reasons.push('verification_missing');
  const editRequest = actionRequested && actionClauses.some(clause => {
    // "Run tests and fix failures" is conditional on those failures existing.
    // A genuinely green original suite needs no gratuitous implementation edit.
    if (testRequest && /^(?:fix|repair|corrige|repare)\s+(?:(?:the|all|any|les|des)\s+)?(?:failures|errors|echecs|erreurs)$/.test(clause)) return false;
    const runs = /\b(?:run|execute|lance|lancer|start|stop|launch|build|install|deploy|demarre|arrete|installe)\b/.test(clause);
    const verifies = /\b(?:lint|eslint|typecheck|checks?)\b/.test(clause);
    const tests = /\b(?:run|execute|lance|relance|lancer|make|ensure|fais|rends|check|verify|verifie|controle)\b.*\btests?\b/.test(clause);
    // A check in a different clause cannot waive this clause's unknown edit.
    return !tests && !runs && !verifies
      || /\b(?:replace|edit|modify|change|update|set|implement|refactor|rewrite|delete|add|remove|remplace|modifie|ecris|cree|reecris|ajoute|supprime|create|write)\b/.test(clause)
      || /\b(?:fix|repair|corrige|repare)\b/.test(clause) && !/\b(?:tests?|lint|eslint|typecheck|checks?)\b/.test(clause);
  });
  const clauses = splitHeadlessClauses(prompt);
  const written = writtenFiles(entries);
  const independent = clauses.filter((clause, index) => !isHeadlessProhibition(clause) && !isIncidentalHeadlessClause(clause, index));
  const targets = editRequest ? independent.filter(clause => requestsRepositoryAction(clause)
    && !/^(?:preserve|keep|retain|leave|garde|conserve|preserve)\b/i.test(unwrapHeadlessRequest(clause)))
    .flatMap(namedFiles) : [];
  if (editRequest && (lastWrite < 0 || targets.some(file => !written.has(file)))) reasons.push('requested_edit_not_executed');
  // A successful write elsewhere cannot satisfy a named target or cancel an
  // independent prohibition. This is evidence checking, not rollback.
  const forbidden = clauses.filter(clause => isHeadlessProhibition(clause)
    && /\b(?:edit\w*|writ\w*|chang\w*|modif\w*|updat\w*|delet\w*|remov\w*|ecri\w*|supprim\w*)\b/i.test(clause.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))
    .flatMap(namedFiles);
  if (forbidden.some(file => written.has(file)) && !reasons.includes('unexpected_edit_executed')) reasons.push('unexpected_edit_executed');
  if (actionRequested && independent.some(clause => !requestsRepositoryAction(clause)
    && checkHeadlessDeliverable(unwrapHeadlessRequest(clause), final, entries).reasons.includes('source_evidence_missing'))
    && !reasons.includes('source_evidence_missing')) reasons.push('source_evidence_missing');
  const status = reasons.some(reason => reason !== 'no_action_executed') ? 'failed'
    : reasons.length ? 'unverified' : 'success';
  return { status, success: status === 'success', exitCode: responseExitCode || (reasons.includes('unsupported_action_claim') ? 4 : status === 'success' ? 0 : 1), reasons, actionTools,
    checks: [...checks.values()].map(({ tool, command, success, optionalRead, sequence }) => ({ tool, ...(command ? { command } : {}), success,
      ...(optionalRead && lastWrite > sequence ? { required: false } : {}) })) };
}
