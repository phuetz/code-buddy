/**
 * Pure parsers and extractors for delegation log facts.
 *
 * Extracts structured, quantitative facts from delegation journals and launcher
 * outputs (engine, effective model, duration, exit code, tool rounds, round limit,
 * cost, cost cap) without guessing or inventing absent data.
 *
 * @module agent/self-improvement/delegation-facts
 */

import fs from 'node:fs';
import path from 'node:path';

export const NAMED_DELEGATION_FAILURES = [
  'Maximum tool execution rounds',
  'Unexpected end of JSON input',
  'trim is not a function',
  'peer closed connection',
  'Turn limit',
] as const;

export type NamedDelegationFailure = (typeof NAMED_DELEGATION_FAILURES)[number];

export const PILOT_LESSONS = [
  'HOME isolé pour Vitest',
  'commiter après chaque point',
  'lire le journal du boot précédent avant de relancer',
  'ne pas éditer un script bash en cours d\'exécution',
  'preuve = tests des fichiers touchés',
] as const;

export type PilotLesson = (typeof PILOT_LESSONS)[number];

export interface DelegationFact {
  id: string;
  engine: string;
  model?: string;
  requestedModel?: string;
  durationSec?: number;
  exitCode?: number;
  toolRounds?: number;
  roundLimit?: number;
  costUsd?: number;
  costCap?: number;
  changes: string[];
  namedFailures: string[];
  pilotLessons: string[];
  rawPath?: string;
  timestamp?: string;
}

export interface ParsedHeadlessOutput {
  result?: string | null;
  error?: string;
  model?: string;
  requestedModel?: string;
  cost?: {
    total?: number;
    estimated?: boolean;
    pricing?: 'known' | 'unknown' | 'subscription' | string;
    billing?: string;
  };
  messages?: Array<{
    role?: string;
    content?: string;
    tool_calls?: Array<{
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
  }>;
}

/**
 * Searches for and parses headless JSON output emitted by Code Buddy in a log.
 * Scans candidate JSON blocks (from bottom up).
 */
export function findHeadlessJson(content: string): ParsedHeadlessOutput | null {
  // Headless output is emitted at the end of the run (before banner).
  // Restrict inspection to the tail (last 256 KB) to avoid ReDoS or multi-megabyte scanning.
  const tail = content.length > 256 * 1024 ? content.slice(-256 * 1024) : content;

  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line || !line.startsWith('{') || !line.endsWith('}')) continue;
    if (!line.includes('"cost"') && !line.includes('"model"')) continue;
    try {
      const parsed = JSON.parse(line) as ParsedHeadlessOutput;
      if (parsed && typeof parsed === 'object' && ('result' in parsed || 'error' in parsed) && 'cost' in parsed) {
        return parsed;
      }
    } catch {
      // not a single-line JSON, continue
    }
  }

  // Multiline JSON search within tail
  const jsonMatches = tail.match(/\{[\s\S]*?"(?:result|error)"[\s\S]*?"cost"[\s\S]*?\}(?=\s*(?:──|moteur|$))/g);
  if (jsonMatches) {
    for (let i = jsonMatches.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(jsonMatches[i]!) as ParsedHeadlessOutput;
        if (parsed && typeof parsed === 'object' && ('result' in parsed || 'error' in parsed)) {
          return parsed;
        }
      } catch {
        // continue
      }
    }
  }

  return null;
}

/**
 * Extracts effective model and requested model (cf. MODELLABEL1).
 */
export function extractModel(
  content: string,
  headlessJson?: ParsedHeadlessOutput | null,
): { model?: string; requestedModel?: string } {
  let model: string | undefined;
  let requestedModel: string | undefined;

  // 1. From headless JSON (outputData.model is the effective model, requestedModel is set if fell back)
  if (headlessJson?.model && typeof headlessJson.model === 'string' && headlessJson.model.trim() && headlessJson.model.toLowerCase() !== 'unknown') {
    model = headlessJson.model.trim();
  }
  if (headlessJson?.requestedModel && typeof headlessJson.requestedModel === 'string' && headlessJson.requestedModel.trim()) {
    requestedModel = headlessJson.requestedModel.trim();
  }

  // 2. From fallback warning messages in log
  if (!requestedModel || !model) {
    const fallbackFr = content.match(/Modèle\s+"([^"]+)"\s+non disponible,\s+repli sur\s+"([^"]+)"/i);
    if (fallbackFr?.[1] && fallbackFr?.[2]) {
      if (!requestedModel) requestedModel = fallbackFr[1];
      if (!model) model = fallbackFr[2];
    }
    const fallbackEn = content.match(/"([^"]+)"\s+is not served by the (?:[a-zA-Z0-9_-]+ )?backend;\s*using\s+"([^"]+)"/i);
    if (fallbackEn?.[1] && fallbackEn?.[2]) {
      if (!requestedModel) requestedModel = fallbackEn[1];
      if (!model) model = fallbackEn[2];
    }
  }

  // 3. From launcher headers (e.g. Codex)
  if (!model) {
    const codexModel = content.match(/^\s*model:\s*([a-zA-Z0-9_.:/-]+)/m);
    if (codexModel?.[1] && codexModel[1].toLowerCase() !== 'unknown') {
      model = codexModel[1].trim();
    }
  }

  // 4. From CLI invocation flags in launcher
  if (!model) {
    const optModel = content.match(/(?:^|\s)(?:-m|--model)(?:\s+|=)["']?([a-zA-Z0-9_.:/-]+)["']?/);
    if (optModel?.[1] && optModel[1].toLowerCase() !== 'unknown' && !optModel[1].includes('$')) {
      model = optModel[1].trim();
    }
  }

  // 5. From prompt truncation log
  if (!model) {
    const truncModel = content.match(/System prompt truncated for\s+([a-zA-Z0-9_.:/-]+):/i);
    if (truncModel?.[1]) {
      model = truncModel[1].trim();
    }
  }

  return { model, requestedModel };
}

/**
 * Extracts round limit (--max-tool-rounds or equivalent).
 * Returns undefined if absent — never guesses.
 */
export function extractRoundLimit(content: string): number | undefined {
  const mtr = content.match(/--max-tool-rounds(?:\s+|=)["']?(\d+)/i);
  if (mtr?.[1]) return parseInt(mtr[1], 10);

  const mt = content.match(/--max-turns(?:\s+|=)["']?(\d+)/i);
  if (mt?.[1]) return parseInt(mt[1], 10);

  const em = content.match(/Maximum tool execution rounds\s*\((\d+)\)/i);
  if (em?.[1]) return parseInt(em[1], 10);

  const strat = content.match(/Execution strategy\s+\S+\s+in force\s*\(rounds\s+(\d+)/i);
  if (strat?.[1]) return parseInt(strat[1], 10);

  return undefined;
}

/**
 * Counts tool execution rounds from messages, explicit limit warnings, or tool execution logs.
 */
export function countToolRounds(
  content: string,
  headlessJson?: ParsedHeadlessOutput | null,
  roundLimit?: number,
  namedFailures: string[] = [],
): number | undefined {
  // 1. From headless JSON messages
  if (headlessJson?.messages && Array.isArray(headlessJson.messages)) {
    let rounds = 0;
    for (const msg of headlessJson.messages) {
      if (msg && msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        rounds++;
      }
    }
    return rounds;
  }

  // 2. Explicit (N) in warning
  const explicitMaxMatch = content.match(/Maximum tool execution rounds\s*\((\d+)\)/i);
  if (explicitMaxMatch?.[1]) {
    return parseInt(explicitMaxMatch[1], 10);
  }

  // 3. Count reported by deleguer.sh for Codex
  const codexExecMatch = content.match(/commandes réellement exécutées\s*:\s*(\d+)/i);
  if (codexExecMatch?.[1]) {
    return parseInt(codexExecMatch[1], 10);
  }

  // 4. Hit maximum tool execution rounds ceiling with a known round limit
  const hitMaxRounds =
    namedFailures.some((f) => /Maximum tool execution rounds|Turn limit/i.test(f)) ||
    /Maximum tool execution rounds reached/i.test(content) ||
    /Turn limit reached/i.test(content);
  if (hitMaxRounds && roundLimit !== undefined && roundLimit > 0) {
    return roundLimit;
  }

  // 5. Tool execution notifications
  const notifMatches = content.match(/\[notification\]\s+\w+\s+(?:completed|failed)/g);
  if (notifMatches && notifMatches.length > 0) {
    return notifMatches.length;
  }

  // 6. Tool calls count in JSONL or telemetry
  const toolCallMatches = content.match(/"type"\s*:\s*"tool_calls"/g) ?? content.match(/\btoolCallId\b/g);
  if (toolCallMatches && toolCallMatches.length > 0) {
    return toolCallMatches.length;
  }

  // 7. Codex exec lines
  const execLines = content.match(/^\s*exec\s+/gm);
  if (execLines && execLines.length > 0) {
    return execLines.length;
  }

  return undefined;
}

/**
 * Extracts cost in USD (cost.total from JSON, only if pricing != 'unknown').
 */
export function extractCostUsd(
  content: string,
  headlessJson?: ParsedHeadlessOutput | null,
): number | undefined {
  if (
    headlessJson?.cost &&
    typeof headlessJson.cost.total === 'number' &&
    Number.isFinite(headlessJson.cost.total) &&
    headlessJson.cost.total >= 0
  ) {
    if (headlessJson.cost.pricing !== 'unknown') {
      return headlessJson.cost.total;
    }
  }

  const factCost = content.match(/\bfacts:.*?\bcost=([0-9.]+)/);
  if (factCost?.[1]) {
    const num = parseFloat(factCost[1]);
    if (Number.isFinite(num) && num >= 0) return num;
  }

  return undefined;
}

/**
 * Extracts cost cap if logged (--max-price, --max-cost, cost cap $N).
 */
export function extractCostCap(content: string): number | undefined {
  const mp = content.match(/--max-price(?:\s+|=)["']?([0-9.]+)/i);
  if (mp?.[1]) return parseFloat(mp[1]);

  const mc = content.match(/--max-cost(?:\s+|=)["']?([0-9.]+)/i);
  if (mc?.[1]) return parseFloat(mc[1]);

  const cc = content.match(/cost cap\s+\$?([0-9.]+)/i);
  if (cc?.[1]) return parseFloat(cc[1]);

  const pc = content.match(/Plafond de co[uû]t\s*:\s*\$?([0-9.]+)/i);
  if (pc?.[1]) return parseFloat(pc[1]);

  const capFact = content.match(/\bfacts:.*?\bcap=([0-9.]+)/);
  if (capFact?.[1]) {
    const num = parseFloat(capFact[1]);
    if (Number.isFinite(num) && num >= 0) return num;
  }

  return undefined;
}

/**
 * Extracts exit code from deleguer.sh banner or error envelopes.
 */
export function extractExitCode(content: string, headlessJson?: ParsedHeadlessOutput | null): number | undefined {
  const exitMatch = content.match(/(?:sortie|exit(?: code)?)\s*[:\s]\s*(\d+)\b/i);
  if (exitMatch?.[1]) {
    return parseInt(exitMatch[1], 10);
  }
  if (headlessJson?.error) {
    return 1;
  }
  if (content.includes('❌ ERROR Agent turn failed') || content.includes('❌ ERROR')) {
    return 1;
  }
  return undefined;
}

/**
 * Extracts run duration in seconds.
 */
export function extractDurationSec(content: string): number | undefined {
  const durationMatch =
    content.match(/·\s*(\d+)\s*s(?:\s*·|\s*$)/i) ??
    content.match(/dur[ée]e\s*:\s*(\d+)\s*s/i) ??
    content.match(/(\d+)\s*s\s*·\s*sortie/i);
  if (durationMatch?.[1]) {
    return parseInt(durationMatch[1], 10);
  }

  const tsMatches = Array.from(
    content.matchAll(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\b/g),
  );
  if (tsMatches.length >= 2) {
    const firstStr = tsMatches[0]?.[1];
    const lastStr = tsMatches[tsMatches.length - 1]?.[1];
    if (firstStr && lastStr) {
      const first = Date.parse(firstStr);
      const last = Date.parse(lastStr);
      if (Number.isFinite(first) && Number.isFinite(last) && last >= first) {
        return Math.round((last - first) / 1000);
      }
    }
  }

  return undefined;
}

/**
 * Extracts all delegation facts from log/out content.
 */
export function extractDelegationFacts(content: string, filename = ''): DelegationFact {
  let engine = 'inconnu';
  const engineMatch =
    content.match(/(?:moteur\s+|→\s+)([a-zA-Z0-9_-]+)(?:\s+sur|\s*·)/i) ??
    content.match(/moteur\s*:\s*([a-zA-Z0-9_-]+)/i);
  if (engineMatch?.[1]) {
    engine = engineMatch[1].trim().toLowerCase();
  } else {
    const fileEngineMatch = filename.match(/\d{4}-\d{2}-\d{2}T\d{6}-([a-zA-Z0-9]+)-/);
    if (fileEngineMatch?.[1]) {
      engine = fileEngineMatch[1].trim().toLowerCase();
    } else {
      const launcherMatch = filename.match(/launcher-(?:[a-zA-Z0-9_-]+-)?([a-zA-Z0-9_-]+?)(?:-[0-9]+)?\.out/);
      if (launcherMatch?.[1]) {
        engine = launcherMatch[1].trim().toLowerCase();
      }
    }
  }

  const headlessJson = findHeadlessJson(content);
  const { model, requestedModel } = extractModel(content, headlessJson);
  const durationSec = extractDurationSec(content);
  const exitCode = extractExitCode(content, headlessJson);
  const roundLimit = extractRoundLimit(content);

  const namedFailures = NAMED_DELEGATION_FAILURES.filter((failure) =>
    content.includes(failure),
  );

  const toolRounds = countToolRounds(content, headlessJson, roundLimit, namedFailures);
  const costUsd = extractCostUsd(content, headlessJson);
  const costCap = extractCostCap(content);

  const changes: string[] = [];
  const changesBlock = content.match(/── ce qui a bougé ──([\s\S]*?)(?:─────────────────────────────|──\s*$|$)/);
  if (changesBlock?.[1]) {
    const lines = changesBlock[1].split('\n');
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (trimmed && !trimmed.startsWith('──')) {
        changes.push(trimmed);
      }
    }
  }

  const pilotLessons: string[] = [];
  if (
    content.includes('HOME isolé pour Vitest') ||
    /HOME(?:=\S+)?\s+isol[eé]/i.test(content) ||
    /HOME=.*_qa.*home/i.test(content) ||
    /_qa\/\S+\/home/i.test(content)
  ) {
    pilotLessons.push('HOME isolé pour Vitest');
  }
  if (
    content.includes('commiter après chaque point') ||
    /commit(?:er|é|e)?\s+après\s+chaque\s+point/i.test(content) ||
    /un\s+commit\s+par\s+point/i.test(content)
  ) {
    pilotLessons.push('commiter après chaque point');
  }
  if (
    content.includes('lire le journal du boot précédent avant de relancer') ||
    /lire\s+le\s+journal\s+(?:du\s+boot\s+précédent|précédent)/i.test(content)
  ) {
    pilotLessons.push('lire le journal du boot précédent avant de relancer');
  }
  if (
    content.includes('ne pas éditer un script bash en cours d\'exécution') ||
    /ne\s+pas\s+[eé]diter\s+(?:un\s+)?script\s+bash\s+en\s+cours/i.test(content)
  ) {
    pilotLessons.push('ne pas éditer un script bash en cours d\'exécution');
  }
  if (
    content.includes('preuve = tests des fichiers touchés') ||
    /preuve\s*=\s*tests\s+des\s+fichiers\s+touch[eé]s/i.test(content) ||
    /tests\s+des\s+fichiers\s+touch[eé]s/i.test(content)
  ) {
    pilotLessons.push('preuve = tests des fichiers touchés');
  }

  const id = filename ? filename.replace(/\.(log|out)$/, '') : `delegation-${Date.now()}`;

  return {
    id,
    engine,
    ...(model ? { model } : {}),
    ...(requestedModel ? { requestedModel } : {}),
    ...(durationSec !== undefined ? { durationSec } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(toolRounds !== undefined ? { toolRounds } : {}),
    ...(roundLimit !== undefined ? { roundLimit } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(costCap !== undefined ? { costCap } : {}),
    changes,
    namedFailures,
    pilotLessons,
  };
}

/**
 * Builds the explicit facts line readable by parseRunFacts:
 * facts: rounds=<n> limit=<n> cost=<usd> cap=<usd> outcome=<success|failure> failure=<max-rounds|cost-cap|…>
 * Only known keys are emitted.
 */
export function formatRunFactsLine(fact: DelegationFact): string {
  const tokens: string[] = [];

  if (fact.toolRounds !== undefined && Number.isFinite(fact.toolRounds)) {
    tokens.push(`rounds=${fact.toolRounds}`);
  }
  if (fact.roundLimit !== undefined && Number.isFinite(fact.roundLimit)) {
    tokens.push(`limit=${fact.roundLimit}`);
  }
  if (fact.costUsd !== undefined && Number.isFinite(fact.costUsd)) {
    tokens.push(`cost=${fact.costUsd}`);
  }
  if (fact.costCap !== undefined && Number.isFinite(fact.costCap)) {
    tokens.push(`cap=${fact.costCap}`);
  }

  let outcome: 'success' | 'failure' | undefined;
  if (fact.exitCode === 0 && fact.namedFailures.length === 0) {
    outcome = 'success';
  } else if (fact.exitCode !== undefined && fact.exitCode !== 0) {
    outcome = 'failure';
  } else if (fact.namedFailures.length > 0) {
    outcome = 'failure';
  }

  if (outcome) {
    tokens.push(`outcome=${outcome}`);
  }

  if (outcome === 'failure') {
    if (fact.namedFailures.some((f) => /Maximum tool execution rounds|Turn limit/i.test(f))) {
      tokens.push('failure=max-rounds');
    } else if (fact.namedFailures.some((f) => /cost (?:limit|cap)|Plafond de coût/i.test(f))) {
      tokens.push('failure=cost-cap');
    }
  }

  return tokens.length > 0 ? `facts: ${tokens.join(' ')}` : '';
}

/**
 * Reads a file up to maxBytes * 2. If larger, reads head and tail chunks
 * (where launch commands and conclusion banners reside) to protect memory and regex performance.
 */
function readLogFileBounded(filePath: string, maxBytes = 256 * 1024): string {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size <= maxBytes * 2) {
      return fs.readFileSync(filePath, 'utf8');
    }
    const fd = fs.openSync(filePath, 'r');
    try {
      const headBuf = Buffer.alloc(maxBytes);
      const headRead = fs.readSync(fd, headBuf, 0, maxBytes, 0);
      const tailBuf = Buffer.alloc(maxBytes);
      const tailOffset = Math.max(0, stat.size - maxBytes);
      const tailRead = fs.readSync(fd, tailBuf, 0, maxBytes, tailOffset);
      return headBuf.toString('utf8', 0, headRead) + '\n' + tailBuf.toString('utf8', 0, tailRead);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

/**
 * Reads delegation logs from a directory and extracts structured facts.
 */
export function readDelegationLogs(delegationsDir: string, limit = 50): DelegationFact[] {
  if (!fs.existsSync(delegationsDir)) return [];
  const entries = fs.readdirSync(delegationsDir, { withFileTypes: true });
  const outFiles: string[] = [];
  const logFiles: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.out')) outFiles.push(entry.name);
    else if (entry.name.endsWith('.log')) logFiles.push(entry.name);
  }

  outFiles.sort().reverse();
  logFiles.sort().reverse();

  const consumedLogs = new Set<string>();
  const facts: DelegationFact[] = [];

  for (const outFile of outFiles) {
    if (facts.length >= limit) break;
    const outPath = path.join(delegationsDir, outFile);
    const outContent = readLogFileBounded(outPath);
    if (!outContent) continue;

    const logMatch = outContent.match(/journal\s*:\s*(\S+\.log)/i);
    let companionContent = '';
    let logBaseName = '';
    if (logMatch?.[1]) {
      const referencedLogName = path.basename(logMatch[1]);
      logBaseName = referencedLogName.replace(/\.log$/, '');
      consumedLogs.add(referencedLogName);
      const fullLogPath = path.join(delegationsDir, referencedLogName);
      if (fs.existsSync(fullLogPath)) {
        companionContent = readLogFileBounded(fullLogPath);
      }
    }
    const combinedContent = companionContent ? `${companionContent}\n${outContent}` : outContent;
    const factId = logBaseName || outFile.replace(/\.out$/, '');
    facts.push(extractDelegationFacts(combinedContent, factId));
  }

  for (const logFile of logFiles) {
    if (facts.length >= limit) break;
    if (consumedLogs.has(logFile)) continue;
    const logPath = path.join(delegationsDir, logFile);
    const content = readLogFileBounded(logPath);
    if (!content) continue;
    const factId = logFile.replace(/\.log$/, '');
    facts.push(extractDelegationFacts(content, factId));
  }

  return facts;
}
