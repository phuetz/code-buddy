/** Documentary guard. It never executes a model, tool or evidence scenario. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeHTML } from 'entities';

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
  'deep_research/',
];
const recordFiles = new Set([
  'CHANGELOG.md', 'docs/FABLE5-CODEX-COORDINATION.md',
  // Snapshot metadata names its source commit and indexing date.
  'docs/feature-map.json',
  // Dated raw benchmark responses are observations, not current product copy.
  'BANC-ORNITH-RAW-2026-08-26-v2.json',
]);
function isPresentation(file: string): boolean {
  return /\.(?:html?|svg)$/i.test(file)
    || /(?:^|\/)package\.json$|(?:^|\/)manifest\.(?:json|webmanifest)$|\.webmanifest$/i.test(file)
    || file.startsWith('site/') || file.startsWith('assets/site/')
    || file.startsWith('cowork/src/renderer/i18n/locales/')
    || /(?:^|\/)RELEASE[-_]NOTES/i.test(file)
    || /(?:^|\/)README(?:\.[^/]*)?$/i.test(file)
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
const qualifier = '(?:(?:LLM[- ]callable|LLM|agent|direct|semantic|navigation|MCP|JSON[- ]defined|first[- ]class|speciali[sz]ed|dedicated|local|cloud|AI|premium|hosted|OpenAI[- ]compatible|gratuits?|locaux|compatibles?|spécialisés?|built[- ]?in|native|registered|available|internal|custom|distinct|total|coding|core|standard|network|new|additional|integration|read[- ]only|external|public|intégrés?|natifs?|disponibles?|enregistrés?|externes?|publics?|autorisés?)\\s+){0,4}';
const noun = '(?:tools?|outils?|providers?|fournisseurs?)';
const counts = new RegExp(`(?<![\\w/])${quantity}\\s*(?:-\\s*)?${qualifier}${noun}\\b|(?<![\\w/])\\d[\\d,.]*\\s*\\+\\s*${qualifier}${noun}\\b|\\b${noun}(?:[ _-]?counts?|\\s+(?:definitions?|catalog(?:ue)?|total|available|disponibles))?\\s*(?:\\(|:|=|\\||\\s[-–—]\\s)\\s*${quantity}\\b`, 'gi');
const countPilot = /~ *1[01][0-9] *(\+ *)?(outils|tools)|1[01][0-9]\+? *(outils|tools|built-?in)|\b15 *(llm *)?(providers|fournisseurs)/i;
// Chinese locale captions are displayed too; ASCII word boundaries do not apply.
const localizedCount = /\d[\d,.]*\s*\+?\s*(?:个|种|款)?\s*(?:工具|(?:LLM\s*)?供应商|提供商)/i;
const displayCount = /\b(?:compteur|counter)\s*\d+\s*\+?.{0,100}\b(?:outils|tools|providers|fournisseurs)\b|\b\d+\s+pastilles\b/i;
const indirectCount = /\b(?:providers?|fournisseurs?|routage|routing)\b.{0,160}\b\d+\s*\+?\s*(?:routes?|intégrations?|integrations?|[- ]entry\s+catalog(?:ue)?)\b|\b\d+\s+intégrations?\b|\b(?:extended|provider|fournisseur)\s+catalog(?:ue)?\b.{0,80}\b\d+\s+entries\b/i;
const evidence = /\bproven\b|\bvalidated\s+(?:end[- ]to[- ]end|E2E)\b|\bproved\b|(?<![\p{L}\p{N}_])prouv[ée]e?s?(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])valid[ée]e?s?\s+de\s+bout\s+en\s+bout\b|\bprove[sd]?\s+(?:the|that)\s+(?:configured|provider)|\b(?:reproducible|repeatable|reproductibles?)\b.{0,80}\b(?:proof|preuves?)\b|\b(?:proof|preuves?)\b.{0,80}\b(?:reproducible|reproductibles?)\b|\breal\b.{0,30}\bproof\b/iu;
// Visually reviewed: these existing infographics contain inventory arguments
// and improvement claims outside the catalogue. Keep the historical originals,
// but prevent reintroduction in current presentations or publication inputs.
const unsupportedMedia = /infographic-(?:code-buddy-2|ai-engineering-stack)\.webp/i;

export function inDocumentationScope(file: string): boolean {
  if (/(?:^|\/)(?:tests?|__tests__|node_modules)\//.test(file)) return false;
  // Rendered assets remain public surfaces even when kept under source folders.
  if (/\.(?:html?|svg|webmanifest)$/i.test(file)
    || /(?:^|\/)(?:package|[^/]*manifest)\.json$/i.test(file)
    || file.startsWith('cowork/src/renderer/i18n/locales/')) return true;
  if (file.startsWith('src/') || file.startsWith('cowork/src/')) return file.endsWith('.md');
  return file.startsWith('docs/') || file.startsWith('wiki/')
    || file.startsWith('site/') || file.startsWith('assets/site/')
    || file.startsWith('.github/workflows/')
    || /\.(?:md|txt|rst|adoc|json|ya?ml|toml|srt)$/i.test(file)
    || (!file.includes('/') && file.startsWith('README'));
}

/** Read the actual Pages cp inputs, never execute workflow shell commands. */
export function pagePublicationSources(workflow: string): string[] {
  const sources: string[] = [];
  for (const line of workflow.split(/\r?\n/)) {
    if (!/^\s*cp\s/.test(line)) continue;
    const copy = /^\s*cp\s+(?:-[A-Za-z]+\s+)?(.+?)\s+\.pages-artifact(?:\/\S*)?\s*$/.exec(line);
    if (!copy || /["'`$;&|<>]/.test(copy[1]!)) throw new Error(`Unparsed Pages copy command: ${line.trim()}`);
    sources.push(...copy[1]!.split(/\s+/));
  }
  if (!sources.length) throw new Error('No Pages publication sources found');
  return [...new Set(sources)];
}

function matchesPublication(file: string, source: string): boolean {
  const pattern = source.split('**').map((part) => part.split('*')
    .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
  return file.startsWith(`${source.replace(/\/$/, '')}/`) || new RegExp(`^${pattern}$`).test(file);
}

function normalize(line: string, file: string): string {
  let displayed = line;
  if (file.endsWith('.json')) {
    // Translation IDs (e.g. old numeric identifiers) are not displayed captions.
    // Decode string values so escaped Unicode/newlines cannot hide a claim.
    const value = /^\s*"(?:[^"\\]|\\.)*"\s*:\s*("(?:[^"\\]|\\.)*")\s*,?\s*$/.exec(line);
    displayed = value ? JSON.parse(value[1]!) as string
      : line.replace(/^(\s*)"((?:[^"\\]|\\.)*)"\s*:\s*/, '$1$2: ');
    // Also cover minified metadata; extract displayed strings, not lookup IDs.
    if (/^\s*[{[]/.test(line)) {
      try {
        const strings = (item: unknown): string[] => {
          if (typeof item === 'string') return [item];
          if (Array.isArray(item)) return item.flatMap(strings);
          if (item && typeof item === 'object') return Object.entries(item).flatMap(([key, child]) =>
            typeof child === 'number' && /^(?:tools?|providers?|outils?|fournisseurs?)(?:[_-]?count)?$/i.test(key)
              ? [`${key}: ${child}`] : strings(child));
          return [];
        };
        displayed = strings(JSON.parse(line)).join('\n');
      } catch { /* Multiline JSON fragments are handled by the value rule above. */ }
    }
  }
  return decodeHTML(displayed.replace(/\]\([^)]*\)/g, ']').replace(/[*`]/g, '')
    .replace(/<[^>]*>/g, (tag) => /\b(?:content|title|alt|aria-label)=/i.test(tag) ? tag : ' ')).replace(/\u00a0/g, ' ');
}

export function inspectDocument(file: string, content: string): ClaimOccurrence[] {
  const results: ClaimOccurrence[] = [];
  const record = recordFiles.has(file) || (!isPresentation(file) && recordDirectories.some((dir) => file.startsWith(dir)))
    || (historicalReferences.has(file) && !isPresentation(file) && content.includes('<!-- showcase:historical -->') && /20\d{2}-\d{2}-\d{2}/.test(content));
  const generated = generatedFiles.has(file);
  let historicalSection = false;
  let readmeGeneratedBlock = false;
  let symbolMetricTable = false;
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.includes('<!-- showcase:historical:start -->') && historicalSections.has(file) && !isPresentation(file) && /20\d{2}-\d{2}-\d{2}/.test(content)) historicalSection = true;
    if (line.includes('<!-- showcase:historical:end -->')) historicalSection = false;
    if (line.includes('<!-- proven-features:start -->')) readmeGeneratedBlock = true;
    if (unsupportedMedia.test(line) && !record && !historicalSection) {
      results.push({ file, line: index + 1, kind: 'count', text: line,
        classification: 'unsupported-promotional-media', violation: true });
    }
    const normalized = normalize(line, file);
    if (!line.trim()) symbolMetricTable = false;
    if (/^\|\s*(?:Module\s*\|\s*Functions\s*\|\s*Classes\s*\|\s*Imported By|Type\s*\|\s*Files)\s*\|/i.test(normalized)) symbolMetricTable = true;
    const previous = normalize(lines[index - 1] ?? '', file);
    // Formatting an inline HTML caption across adjacent lines must not hide it.
    const searchable = /\.html?$/i.test(file)
      ? `${normalized} ${normalize(lines[index + 1] ?? '', file)}` : normalized;
    const startsHere = (pattern: RegExp): boolean => {
      const match = pattern.exec(searchable);
      return !!match && match.index < normalized.length;
    };
    const pilotHit = startsHere(countPilot);
    const displayHit = startsHere(displayCount) || startsHere(localizedCount);
    const indirectHit = startsHere(indirectCount);
    const matches = [...searchable.matchAll(counts)].filter((match) => match.index < normalized.length);
    // List/heading numbers, call/round limits and translation examples are not
    // provider/tool inventory counts. Still record them for exhaustive review.
    const inventoryMatches = matches.filter((match) => {
      const start = match.index ?? 0;
      const following = searchable.slice(start + match[0].length);
      const logicalPrefix = searchable.slice(0, start).split('\n').at(-1) ?? '';
      const logicalLine = `${logicalPrefix}${match[0]}${following.split('\n')[0]}`;
      return !symbolMetricTable
        && !/^\s*"\d+-(?:tools?|providers?)(?:[-\w]*)"\s*:/.test(line)
        && !/^\s*-\s*\[\d+\./.test(line)
        && !/^[- ]*(?:calls?|rounds?|nodes?|tasks?|using|search|call\(s\)|appel|tours?)\b/i.test(following)
        && !/^\s*(?:#{1,6}\s+\d+(?:\.\d+)+(?:[. ]|$)|#{1,6}\s+\d+\.\s|\d+\.\s)/.test(logicalLine)
        && !/\b(?:per.turn cap|au-delà de|at most|up to|beyond|maximum of)\b/i.test(logicalPrefix)
        && !/^\s*\{t\('mcp.toolsAvailable'/.test(normalized);
    });
    if (matches.length || pilotHit || displayHit || indirectHit) {
      const classification = record || historicalSection ? 'historical-record'
        : generated && (file.endsWith('.json') || /^(?:Recorded result|Résultat enregistré)\s*:/i.test(normalized)) ? 'catalogue-record'
        : inventoryMatches.length || pilotHit || displayHit || indirectHit ? 'unmeasured-inventory-count'
        : 'example-or-execution-limit';
      results.push({ file, line: index + 1, kind: 'count', text: line, classification,
        violation: classification === 'unmeasured-inventory-count' });
    }
    if (startsHere(evidence)) {
      const negative = /\b(?:not|un|non)[ -]?(?:proven|prouv)|ne\s+prouve|aucun.{0,100}prouv|sans\s+preuve|does not|do not|rather than|no.{0,100}proven|outside the current evidence catalogue|not revalidated|not evidence|not (?:a )?(?:reproducible )?proof|pas (?:une |de )?preuve|n.est pas|ne sont pas|pas des résultats prouv/i.test(normalized)
        || /^\s*prouv[ée]/iu.test(normalized) && /n.est pas\s*$/i.test(previous);
      const reference = /(?:PROVEN-FEATURES|FONCTIONNALITES-PROUVEES|proven-features|check-showcase-claims|\.jsonl|proven-outcome|Proven Outcome Memory|must be proven with browser\.assert_text|once.{0,60}proven|until.{0,60}proven|require.{0,60}proven|only.{0,60}proven|when.{0,60}proven|scope proved|état.{0,30}prouv|statuts.{0,30}prouv|deux statuts|signature prouve|que si.{0,100}prouve|can be proven|proven outcomes? require|proven outcomes? and|from proven outcomes|Proven Design Patterns)/i.test(normalized);
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
  files: string[]; occurrences: ClaimOccurrence[]; violations: ClaimOccurrence[]; pagesSources: string[];
} {
  const names = revision
    ? execFileSync('git', ['ls-tree', '-r', '--name-only', revision], { cwd: root, encoding: 'utf8' })
    : execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  const files: string[] = [];
  const occurrences: ClaimOccurrence[] = [];
  const read = (file: string): Buffer => revision
    ? execFileSync('git', ['show', `${revision}:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
    : readFileSync(path.join(root, file));
  const pagesSources = pagePublicationSources(read('.github/workflows/pages.yml').toString('utf8'));
  for (const file of [...new Set(names.trim().split('\n'))].sort()
    .filter((file) => inDocumentationScope(file) || pagesSources.some((source) => matchesPublication(file, source)))) {
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
  return { files, occurrences, violations: occurrences.filter((row) => row.violation), pagesSources };
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
