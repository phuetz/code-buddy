/** Documentary guard. It never executes a model, tool or evidence scenario. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ClaimOccurrence {
  file: string;
  line: number;
  kind: 'count' | 'evidence';
  text: string;
  classification: string;
  violation: boolean;
}

// These directories contain dated records or proposals, not current reference claims.
// They are ALWAYS scanned and reported, rather than silently omitted.
const recordDirectories = [
  'docs/archive/', 'docs/reports/', 'docs/audits/', 'docs/preuves/',
  'docs/qa/', 'docs/operations/', 'docs/studies/', 'docs/research/',
  'docs/briefs/', 'docs/specs/', 'docs/designs/', 'docs/plans/', 'docs/drafts/',
];
const recordFiles = new Set([
  'CHANGELOG.md', 'docs/FABLE5-CODEX-COORDINATION.md',
  // Snapshot metadata names its source commit and indexing date.
  'docs/feature-map.json',
]);
function isPresentation(file: string): boolean {
  return /(?:^|\/)README(?:\.[^/]*)?$/i.test(file)
    || file.startsWith('docs/marketing/') || file.startsWith('docs/code-explorer-site/')
    || /(?:^|\/)(?:faq|features|launch-kit|code-explorer-README.*|explication-code-buddy)\./i.test(file);
}

// Explicitly reviewed dated accounts. A new presentation page cannot opt out
// by adding a historical marker. New files are checked by default.
const historicalReferences = new Set([
  'cowork/RUNNER_AUDIT.md', 'docs/PORTAGE-AUDITS-JUILLET-2026-08-02.md',
  'docs/agentic-loop-goal-parity-2026-06-16.md', 'docs/hermes-openclaw-parity.md',
  'docs/proof.md', 'docs/proof-changelog.md',
  'docs/providers/omniroute-free-catalog-livecheck-2026-08-22.md',
  'docs/providers/omniroute-free-catalog.md',
  'docs/tools/system-tools-audit.md', 'docs/FINALISATION-CODE-BUDDY-2026-09-14.md',
]);
const historicalSections = new Set([
  'docs/hermes-memory-providers-selfhost.md', 'docs/integrations/resource-catalog-tools.md',
]);

const generatedFiles = new Set([
  'docs/FONCTIONNALITES-PROUVEES.md', 'docs/PROVEN-FEATURES.md',
  'docs/FONCTIONNALITES.md', 'docs/INVENTAIRE-FONCTIONNALITES.md',
  'docs/feature-catalog.md', 'docs/catalog/showcase-status.json',
  'docs/catalog/showcase-review.json', 'docs/catalog/inventory.json',
]);

const quantity = '(?:\\d[\\d,.]*(?:\\s*[-–]\\s*\\d[\\d,.]*)?\\s*\\+?|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred(?:s)?|dozens?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|trente|quarante|cinquante|soixante|cent|dizaines?|centaines?)';
const qualifier = '(?:(?:LLM[- ]callable|LLM|semantic|navigation|MCP|JSON[- ]defined|first[- ]class|speciali[sz]ed|dedicated|local|cloud|AI|premium|hosted|OpenAI[- ]compatible|gratuits?|locaux|compatibles?|spécialisés?|built[- ]?in|native|registered|available|internal|custom|distinct|total|coding|core|standard|network|new|additional|integration|read[- ]only|external|public|intégrés?|natifs?|disponibles?|enregistrés?|externes?|publics?|autorisés?)\\s+){0,4}';
const noun = '(?:tools?|outils?|providers?|fournisseurs?)';
const counts = new RegExp(`(?<![\\w/])${quantity}\\s*(?:-\\s*)?${qualifier}${noun}\\b|(?<![\\w/])\\d[\\d,.]*\\s*\\+\\s*${qualifier}${noun}\\b|\\b${noun}(?:[ _-]counts?|\\s+(?:definitions?|catalog(?:ue)?|total|available|disponibles))?\\s*(?:\\(|:|=|\\||\\s[-–—]\\s)\\s*${quantity}\\b`, 'gi');
const countPilot = /~ *1[01][0-9] *(\+ *)?(outils|tools)|1[01][0-9]\+? *(outils|tools|built-?in)|\b15 *(llm *)?(providers|fournisseurs)/i;
const displayCount = /\b(?:compteur|counter)\s*\d+\s*\+?.{0,100}\b(?:outils|tools|providers|fournisseurs)\b|\b\d+\s+pastilles\b/i;
const evidence = /\bproven\b|\bvalidated\s+(?:end[- ]to[- ]end|E2E)\b|\bproved\b|(?<![\p{L}\p{N}_])prouv[ée]e?s?(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])valid[ée]e?s?\s+de\s+bout\s+en\s+bout\b|\bprove[sd]?\s+(?:the|that)\s+(?:configured|provider)/iu;

export function inDocumentationScope(file: string): boolean {
  if (file.startsWith('src/') || file.startsWith('tests/')) return false;
  return file.startsWith('docs/')
    || (file.startsWith('cowork/') && file.endsWith('.md'))
    || (!file.includes('/') && (file.endsWith('.md') || file.startsWith('README')));
}

function normalize(line: string): string {
  return line.replace(/\]\([^)]*\)/g, ']').replace(/[*`]/g, '').replace(/<[^>]*>/g, (tag) => /\b(?:content|title|alt|aria-label)=/i.test(tag) ? tag : '').replace(/&nbsp;/g, ' ');
}

export function inspectDocument(file: string, content: string): ClaimOccurrence[] {
  const results: ClaimOccurrence[] = [];
  const record = recordFiles.has(file) || (!isPresentation(file) && recordDirectories.some((dir) => file.startsWith(dir)))
    || (historicalReferences.has(file) && !isPresentation(file) && content.includes('<!-- showcase:historical -->') && /20\d{2}-\d{2}-\d{2}/.test(content));
  const generated = generatedFiles.has(file);
  let historicalSection = false;
  let readmeGeneratedBlock = false;
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.includes('<!-- showcase:historical:start -->') && historicalSections.has(file) && !isPresentation(file) && /20\d{2}-\d{2}-\d{2}/.test(content)) historicalSection = true;
    if (line.includes('<!-- showcase:historical:end -->')) historicalSection = false;
    if (line.includes('<!-- proven-features:start -->')) readmeGeneratedBlock = true;
    const normalized = normalize(line);
    const previous = normalize(lines[index - 1] ?? '');
    const matches = [...normalized.matchAll(counts)];
    // List/heading numbers, call/round limits and translation examples are not
    // provider/tool inventory counts. Still record them for exhaustive review.
    const inventoryMatches = matches.filter((match) => {
      const start = match.index ?? 0;
      const following = normalized.slice(start + match[0].length);
      return !/^[- ]*(?:calls?|rounds?|nodes?|tasks?|using|search|call\(s\)|appel|tours?)\b/i.test(following)
        && !/^\s*(?:#{1,6}\s+\d+(?:\.\d+)+(?:[. ]|$)|#{1,6}\s+\d+\.\s|\d+\.\s)/.test(normalized)
        && !/\b(?:per.turn cap|au-delà de|at most|up to|beyond|maximum of)\b/i.test(normalized.slice(0, start))
        && !/^\s*\{t\('mcp.toolsAvailable'/.test(normalized);
    });
    if (matches.length || countPilot.test(normalized) || displayCount.test(normalized)) {
      const classification = record || historicalSection ? 'historical-record'
        : generated && (file.endsWith('.json') || /^(?:Recorded result|Résultat enregistré)\s*:/i.test(normalized)) ? 'catalogue-record'
        : inventoryMatches.length || countPilot.test(normalized) || displayCount.test(normalized) ? 'unmeasured-inventory-count'
        : 'example-or-execution-limit';
      results.push({ file, line: index + 1, kind: 'count', text: line, classification,
        violation: classification === 'unmeasured-inventory-count' });
    }
    if (evidence.test(normalized)) {
      const negative = /\b(?:not|un|non)[ -]?(?:proven|prouv)|ne\s+prouve|aucun.{0,100}prouv|sans\s+preuve|does not|do not|rather than|no.{0,100}proven|outside the current evidence catalogue|not revalidated|not evidence|n.est pas|ne sont pas|pas des résultats prouv/i.test(normalized)
        || /^\s*prouv[ée]/iu.test(normalized) && /n.est pas\s*$/i.test(previous);
      const reference = /(?:PROVEN-FEATURES|FONCTIONNALITES-PROUVEES|proven-features|check-showcase-claims|\.jsonl|proven-outcome|Proven Outcome Memory|once.{0,60}proven|until.{0,60}proven|require.{0,60}proven|only.{0,60}proven|when.{0,60}proven|scope proved|état.{0,30}prouv|statuts.{0,30}prouv|deux statuts|signature prouve|que si.{0,100}prouve|can be proven|proven outcomes? require|proven outcomes? and|from proven outcomes|Proven Design Patterns)/i.test(normalized);
      const classification = record || historicalSection ? 'historical-record'
        : generated || readmeGeneratedBlock ? 'catalogue-status'
        : negative ? 'negative-or-limited-evidence'
        : reference ? 'status-reference-or-condition'
        : 'unsupported-evidence-claim';
      results.push({ file, line: index + 1, kind: 'evidence', text: line, classification,
        violation: classification === 'unsupported-evidence-claim' });
    }
    if (line.includes('<!-- proven-features:end -->')) readmeGeneratedBlock = false;
  }
  return results;
}

export function auditShowcase(root: string, revision?: string): {
  files: string[]; occurrences: ClaimOccurrence[]; violations: ClaimOccurrence[];
} {
  const names = revision
    ? execFileSync('git', ['ls-tree', '-r', '--name-only', revision], { cwd: root, encoding: 'utf8' })
    : execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  const files: string[] = [];
  const occurrences: ClaimOccurrence[] = [];
  for (const file of [...new Set(names.trim().split('\n'))].sort().filter(inDocumentationScope)) {
    const bytes = revision
      ? execFileSync('git', ['show', `${revision}:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
      : readFileSync(path.join(root, file));
    if (bytes.includes(0)) continue;
    const content = new TextDecoder('utf-8', { fatal: true });
    let text: string;
    try { text = content.decode(bytes); } catch { continue; }
    files.push(file);
    occurrences.push(...inspectDocument(file, text));
  }
  return { files, occurrences, violations: occurrences.filter((row) => row.violation) };
}

const script = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  try {
    const args = process.argv.slice(2);
    let revision: string | undefined;
    let json = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--json') json = true;
      else if (args[i] === '--revision' && args[i + 1]) revision = args[++i];
      else throw new Error('Usage: node --import tsx scripts/check-showcase-claims.ts [--json] [--revision <commit>]');
    }
    const result = auditShowcase(path.resolve(path.dirname(script), '..'), revision);
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      for (const row of result.violations) process.stderr.write(`${row.file}:${row.line}: ${row.classification}: ${row.text}\n`);
      process.stdout.write(`${result.files.length} documentary files scanned; ${result.violations.length} unqualified claims.\n`);
    }
    process.exitCode = result.violations.length ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
