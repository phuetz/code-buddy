import path from 'node:path';
import { checkSourceOutputReport } from './headless-source-output-report.js';
import { parseBashCommand } from '../security/bash-parser.js';
import { TOOL_ALIASES } from '../tools/registry/tool-alias-map.js';
import type { TaskEvidenceEntry } from './headless-task-outcome.js';

/** A narrow, deterministic result contract. Missing evidence is not absence.
 * This checks restitution of JSON fields, independently of action detection.
 * No expected project value or prefix is built into the verifier.
 */
export interface DeliverableCheck {
  required: boolean;
  verified: boolean;
  reasons: string[];
  guidance?: string;
}

function normalized(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function observedFiles(entries: readonly TaskEvidenceEntry[]): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== 'tool_result' || !entry.toolResult?.success || !entry.toolCall) continue;
    let args: Record<string, unknown>;
    try { args = JSON.parse(entry.toolCall.function.arguments) as Record<string, unknown>; } catch { continue; }
    const tool = TOOL_ALIASES[entry.toolCall.function.name] ?? entry.toolCall.function.name;
    const target = args.path ?? args.file_path;
    if (tool === 'bash') {
      const shell = entry.toolResult.metadata?.shellExecution as { command?: string; cwd?: string; changedFiles?: string[] } | undefined;
      const command = shell?.command ?? String(args.command ?? args.cmd ?? '');
      const parsed = parseBashCommand(command);
      const single = !parsed.warnings.length && parsed.commands.length === 1 && !/[$`<>\n]/.test(command)
        ? parsed.commands[0] : undefined;
      const simpleRead = single && ['cat', 'ls', 'pwd', 'head', 'tail'].includes(single.command);
      if (!simpleRead || shell?.changedFiles?.length) files.clear();
      if (single?.command === 'cat' && single.args.length === 1 && !single.args[0]!.startsWith('-')) {
        const target = path.resolve(shell?.cwd ?? process.cwd(), single.args[0]!);
        files.set(path.relative(process.cwd(), target).replaceAll('\\', '/'), entry.toolResult.output ?? entry.content);
      }
      continue;
    }
    // A successful write invalidates the earlier source observation.
    if (tool === 'apply_patch' || tool === 'create_file'
      || tool === 'str_replace_editor' && !['view', 'read'].includes(String(args.command))) files.clear();
    if (!(tool === 'view_file' || tool === 'str_replace_editor' && ['view', 'read'].includes(String(args.command)))
      || typeof target !== 'string') continue;
    const raw = entry.toolResult.output ?? entry.content;
    const numbered = raw.split('\n').filter(line => /^\d+: /.test(line));
    // A range or a gap cannot prove the value of a whole JSON document.
    if (!numbered.length || numbered.some((line, index) => !line.startsWith(`${index + 1}: `))) continue;
    const text = numbered.map(line => line.replace(/^\d+: /, '')).join('\n');
    files.set(path.relative(process.cwd(), path.resolve(target)).replaceAll('\\', '/'), text);
  }
  return files;
}

/** Read only literal first-line requirements, never execute project text. */
function requiredPrefix(rules: string, reading: boolean): { value: string; separateLine: boolean } | undefined {
  if (!reading) rules = rules.split('\n').filter(line => !/for repository reading|pour.*lecture/i.test(line)).join('\n');
  const instruction = rules.match(/\b(?:begin|start)\s+(?:(?:your|repository|every|each|all)\s+)?(?:answers?|repl(?:y|ies)|responses?)\s+with\s+([^\n]+)/i)
    ?? rules.match(/\b(?:commence|commencer)\s+(?:(?:ta|la|votre)\s+)?r[ée]ponse\s+par\s+([^\n]+)/i);
  const literal = instruction?.[1];
  if (!literal) return undefined;
  const value = literal.match(/^`([^`]+)`/)?.[1]
    ?? literal.match(/^"([^"]+)"/)?.[1]
    ?? literal.match(/^'([^']+)'/)?.[1]
    ?? literal.match(/^([\w-]+)(?=[\s.,]|$)/)?.[1];
  return value ? { value, separateLine: /\b(?:own|separate|first) line\b|\bligne (?:separee|distincte)\b/i.test(normalized(literal)) } : undefined;
}

export function checkHeadlessDeliverable(
  query: string, response: string, entries: readonly TaskEvidenceEntry[], projectRules = '', reading = true,
): DeliverableCheck {
  const text = normalized(query);
  const files = observedFiles(entries);
  const rules = [projectRules, ...[...files].filter(([file]) => /(?:^|\/)(?:AGENTS|CODEBUDDY|INSTRUCTIONS)\.md$/.test(file)).map(([, content]) => content)].join('\n');
  const prefixRule = requiredPrefix(rules, reading);
  const prefix = prefixRule?.value;
  const reasons: string[] = [];
  if (reading && /^(?:please\s+)?(?:read|lis|lire|consult|consulte|inspect|inspecte)\b/.test(text)
    && !/\b(?:sentence|paragraph|poem|phrase|paragraphe)\b/.test(text) && !files.size) reasons.push('source_evidence_missing');
  const sourceTargets = [...query.matchAll(/(?:[\w.-]+\/)*[\w.-]+\.(?:[cm]?[jt]sx?|py|rs|go|java|cs|cpp|c|rb|sh)\b/g)]
    .map(match => path.relative(process.cwd(), path.resolve(match[0])).replaceAll('\\', '/'));
  const refersToObservedInterface = /\b(?:its|their)\s+(?:inputs?|outputs?)\b/.test(text);
  if (reading && (sourceTargets.some(target => !files.has(target)) || refersToObservedInterface && !files.size)
    && !reasons.includes('source_evidence_missing')) reasons.push('source_evidence_missing');
  const lines = response.trim().split(/\r?\n/);
  if (prefix && (prefixRule?.separateLine ? lines[0] !== prefix : !response.trimStart().startsWith(prefix)))
    reasons.push('required_prefix_missing');
  const prefixGuidance = prefix ? `Begin the final answer with the literal project prefix ${JSON.stringify(prefix)}${prefixRule?.separateLine ? ' on its own line' : ''}.` : '';
  const sourceReport = reading ? checkSourceOutputReport(query,
    (prefix && response.trimStart().startsWith(prefix) ? response.trim().slice(prefix.length) : response).trim(), files, entries) : undefined;
  if (sourceReport) return { required: true, verified: !reasons.length && !sourceReport.reasons.length,
    reasons: [...reasons, ...sourceReport.reasons], guidance: `${prefixGuidance} ${sourceReport.guidance}`.trim() };
  const field = query.match(/\b(?:the|le|la)\s+[`"']?([\w-]+)[`"']?\s+(?:field|property|champ|propri[eé]t[eé])(?=\W|$)/i)?.[1]
    ?? query.match(/\b(?:champ|propri[eé]t[eé])\s+[`"']?([\w-]+)[`"']?/i)?.[1]
    ?? (/\b(?:package|project)\s+name\b|\bnom\s+du\s+(?:projet|package|paquet)\b/.test(text) ? 'name' : undefined);
  const rawJsonTarget = query.match(/\/?(?:[\w.-]+\/)*[\w.-]+\.json\b/i)?.[0]
    ?? (field === 'name' && /\b(?:package|project|projet|paquet)\b/.test(text) ? 'package.json' : undefined);
  const jsonTarget = rawJsonTarget === undefined ? undefined
    : path.relative(process.cwd(), path.resolve(rawJsonTarget)).replaceAll('\\', '/');
  if (!field || !jsonTarget) return { required: !!prefix, verified: !!prefix && !reasons.length, reasons, guidance: prefixGuidance || undefined };
  // A write request's new value must not be mistaken for a reading contract.
  if (/^(?:please\s+)?(?:change|replace|edit|modify|set|update|modifie|remplace|cree|ecris)\b/.test(text))
    return { required: !!prefix, verified: !!prefix && !reasons.length, reasons, guidance: prefixGuidance || undefined };
  const observed = files.get(jsonTarget);
  let value: unknown;
  try { value = observed === undefined ? undefined : (JSON.parse(observed) as Record<string, unknown>)[field]; } catch { /* incomplete evidence */ }
  if (!['string', 'number', 'boolean'].includes(typeof value)) reasons.push('requested_value_unobserved');
  if (/\bagents\.md\b/.test(text) && !rules.trim()) reasons.push('requested_rules_unobserved');
  if (value !== undefined) {
    const expected = String(value);
    const body = (prefix && response.trimStart().startsWith(prefix) ? response.trim().slice(prefix.length) : response).trim();
    const exact = /\b(?:only|sole|just|nothing else|no extra|exactly|uniquement|seulement|rien d'autre)\b/.test(text);
    const literal = body === expected;
    const quoted = body === JSON.stringify(value) || body === '`' + expected + '`';
    // Positive, whole-answer forms only. Merely mentioning a value inside an
    // example, negation or contradictory paragraph does not restitute it.
    const label = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const statement = body.match(new RegExp('^(?:The (?:package |project )?' + label + ' is |' + label + ': |Le nom du (?:projet|package|paquet) est )(.+?)[.]?$', 'i'))?.[1];
    const affirmative = statement === expected || statement === '`' + expected + '`' || statement === JSON.stringify(value);
    if (exact ? !literal : !(literal || quoted || affirmative)) reasons.push('requested_value_missing');
    if (/\b(?:sole second line|seule deuxieme ligne)\b/.test(text) && (lines.length !== 2 || lines[1] !== expected))
      reasons.push('requested_format_mismatch');
  }
  return { required: true, verified: reasons.length === 0, reasons,
    guidance: `Read the complete ${jsonTarget} and the requested project instructions. ${prefixGuidance} ${/\b(?:only|sole|just|nothing else|no extra|exactly|uniquement|seulement|rien d'autre)\b/.test(text)
      ? `Return only the observed ${field} value after that prefix: no label, sentence, Markdown, quotes or blank line.`
      : `Deliver the observed ${field} value in the required answer format.`} A refusal, plan or an unrelated file does not supply that value.` };
}
