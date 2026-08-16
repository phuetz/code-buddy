import type { Session, SessionMessage } from '../persistence/session-store.js';
import type { SessionFacade } from '../agent/facades/session-facade.js';
import { scrubSecrets, scrubValue } from '../security/secret-scrubber.js';
import { SessionTimeline, type TimelineEntry } from '../sessions/timeline.js';
import { logger } from '../utils/logger.js';

const MAX_TITLE_LENGTH = 96;
const MAX_TOOL_ARGUMENTS_LENGTH = 900;
const MAX_TOOL_RESULT_LENGTH = 1_800;

type UnknownRecord = Record<string, unknown>;

interface ShareUsage {
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

interface ShareToolCall {
  name: string;
  arguments?: unknown;
  result?: string;
  ok?: boolean;
}

interface ShareDiff {
  path: string;
  content: string;
}

interface ShareTurn {
  number: number;
  timestamp: string;
  prompt: string;
  responses: string[];
  reasoning: string[];
  notes: string[];
  tools: ShareToolCall[];
  diffs: ShareDiff[];
  filesTouched: string[];
  model: string;
  usage: ShareUsage;
}

function mergeToolFields(target: ShareToolCall, incoming: ShareToolCall): void {
  target.arguments ??= incoming.arguments;
  target.result ??= incoming.result;
  target.ok ??= incoming.ok;
}

export interface SessionShareHtmlOptions {
  exportedAt?: Date;
}

export interface PersistedSessionShareDependencies {
  sessionFacade: Pick<SessionFacade, 'loadSession'>;
  timeline?: Pick<SessionTimeline, 'list'>;
  exportedAt?: Date;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = asFiniteNumber(value);
    if (number !== undefined) return number;
  }
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = asString(value);
    if (text !== undefined) return text;
  }
  return undefined;
}

function readUsage(record: UnknownRecord): ShareUsage {
  const metadata = asRecord(record.metadata);
  const usage = asRecord(record.usage) ?? asRecord(metadata?.usage);
  const inputTokens = firstNumber(
    record.inputTokens,
    record.promptTokens,
    metadata?.inputTokens,
    usage?.inputTokens,
    usage?.promptTokens
  );
  const outputTokens = firstNumber(
    record.outputTokens,
    record.completionTokens,
    metadata?.outputTokens,
    usage?.outputTokens,
    usage?.completionTokens
  );
  const explicitTokens = firstNumber(
    record.tokens,
    record.tokenCount,
    record.totalTokens,
    metadata?.tokens,
    metadata?.tokenCount,
    usage?.tokens,
    usage?.totalTokens
  );
  const tokens =
    explicitTokens ??
    (inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined);
  const costUsd = firstNumber(
    record.costUsd,
    record.cost,
    record.totalCost,
    metadata?.costUsd,
    metadata?.cost,
    usage?.costUsd,
    usage?.cost
  );

  return {
    ...(tokens !== undefined ? { tokens } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

function mergeUsage(target: ShareUsage, incoming: ShareUsage): void {
  target.tokens ??= incoming.tokens;
  target.inputTokens ??= incoming.inputTokens;
  target.outputTokens ??= incoming.outputTokens;
  target.costUsd ??= incoming.costUsd;
}

function readModel(record: UnknownRecord): string | undefined {
  const metadata = asRecord(record.metadata);
  return firstString(record.model, record.modelId, metadata?.model, metadata?.modelId);
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function readToolCall(value: unknown, fallbackName?: string): ShareToolCall | undefined {
  const record = asRecord(value);
  if (!record) return fallbackName ? { name: fallbackName } : undefined;
  const fn = asRecord(record.function);
  const name = firstString(fn?.name, record.name, record.toolName, fallbackName);
  if (!name) return undefined;
  const argumentsValue = fn?.arguments ?? record.arguments ?? record.args ?? record.input;
  const resultValue = firstString(record.result, record.output, record.error);
  const ok =
    typeof record.ok === 'boolean'
      ? record.ok
      : typeof record.success === 'boolean'
        ? record.success
        : undefined;

  return {
    name,
    ...(argumentsValue !== undefined ? { arguments: parseJsonValue(argumentsValue) } : {}),
    ...(resultValue !== undefined ? { result: resultValue } : {}),
    ...(ok !== undefined ? { ok } : {}),
  };
}

function mergeTool(turn: ShareTurn, incoming: ShareToolCall): void {
  const existing = turn.tools.find(
    (tool) =>
      tool.name === incoming.name &&
      ((incoming.arguments !== undefined && tool.arguments === undefined) ||
        (incoming.result !== undefined && tool.result === undefined) ||
        (incoming.ok !== undefined && tool.ok === undefined))
  );
  if (!existing) {
    turn.tools.push(incoming);
    return;
  }
  mergeToolFields(existing, incoming);
}

function looksLikeDiff(content: string): boolean {
  return /^(?:diff --git |\*\*\* Begin Patch|@@ |--- |\+\+\+ )/m.test(content);
}

function inferDiffPath(content: string): string | undefined {
  const gitHeader = /^diff --git a\/(.+?) b\/(.+)$/m.exec(content);
  if (gitHeader?.[2]) return gitHeader[2];
  const patchHeader = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/m.exec(content);
  if (patchHeader?.[1]) return patchHeader[1];
  const fileHeader = /^\+\+\+ (?:b\/)?(.+)$/m.exec(content);
  return fileHeader?.[1];
}

function addDiff(turn: ShareTurn, path: string | undefined, content: string): void {
  const trimmed = content.trim();
  if (!trimmed) return;
  const normalizedPath = path?.trim() || inferDiffPath(trimmed) || 'Diff';
  if (turn.diffs.some((diff) => diff.path === normalizedPath && diff.content === trimmed)) return;
  turn.diffs.push({ path: normalizedPath, content: trimmed });
}

function addDiffValue(turn: ShareTurn, value: unknown): void {
  if (typeof value === 'string') {
    addDiff(turn, undefined, value);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  const content = firstString(record.diff, record.patch, record.content, record.excerpt);
  if (!content) return;
  addDiff(turn, firstString(record.path, record.file, record.filePath), content);
}

function addDiffCollection(turn: ShareTurn, value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) addDiffValue(turn, item);
  } else if (value !== undefined) {
    addDiffValue(turn, value);
  }
}

function addUnique(target: string[], value: string | undefined): void {
  if (!value) return;
  const trimmed = value.trim();
  if (trimmed && !target.includes(trimmed)) target.push(trimmed);
}

function makeTurn(number: number, session: Session, timestamp?: string): ShareTurn {
  return {
    number,
    timestamp: timestamp ?? session.createdAt.toISOString(),
    prompt: '',
    responses: [],
    reasoning: [],
    notes: [],
    tools: [],
    diffs: [],
    filesTouched: [],
    model: session.model || 'Modèle non renseigné',
    usage: {},
  };
}

function messageRecord(message: SessionMessage): UnknownRecord {
  return message as unknown as UnknownRecord;
}

function addCallsFromRecord(turn: ShareTurn, record: UnknownRecord): void {
  const calls = Array.isArray(record.toolCalls) ? record.toolCalls : [];
  for (const value of calls) {
    const tool = readToolCall(value);
    if (tool) mergeTool(turn, tool);
  }
  const single = readToolCall(record.toolCall);
  if (single) mergeTool(turn, single);
}

function addMessageToTurn(turn: ShareTurn, message: SessionMessage): void {
  const record = messageRecord(message);
  turn.model = readModel(record) ?? turn.model;
  mergeUsage(turn.usage, readUsage(record));
  addCallsFromRecord(turn, record);

  if (message.type === 'assistant') {
    addUnique(turn.responses, message.content);
    return;
  }
  if (message.type === 'reasoning') {
    addUnique(turn.reasoning, message.content);
    return;
  }
  if (message.type === 'plan_progress') {
    addUnique(turn.notes, message.content);
    return;
  }
  if (message.type === 'diff_preview') {
    const parsed = parseJsonValue(message.content);
    const parsedRecord = asRecord(parsed);
    if (parsedRecord) {
      addDiffCollection(turn, parsedRecord.diffs ?? parsedRecord.diff ?? parsedRecord);
    } else {
      addDiff(turn, undefined, message.content);
    }
    return;
  }

  if (message.type === 'tool_call') {
    const name = message.toolCallName ?? firstString(asRecord(record.toolCall)?.name);
    if (!name) return;
    const content = message.content.trim();
    const argumentsValue =
      content && content !== 'Executing...' && content !== 'Success'
        ? parseJsonValue(content)
        : undefined;
    mergeTool(turn, {
      name,
      ...(argumentsValue !== undefined ? { arguments: argumentsValue } : {}),
    });
    return;
  }

  if (message.type === 'tool_result') {
    const nestedResult = asRecord(record.toolResult);
    const name = message.toolCallName ?? readToolCall(record.toolCall)?.name ?? 'outil';
    const ok =
      typeof message.toolCallSuccess === 'boolean'
        ? message.toolCallSuccess
        : typeof nestedResult?.success === 'boolean'
          ? nestedResult.success
          : undefined;
    const result = firstString(
      nestedResult?.output,
      nestedResult?.error,
      nestedResult?.content,
      message.content
    );
    mergeTool(turn, {
      name,
      ...(result ? { result } : {}),
      ...(ok !== undefined ? { ok } : {}),
    });
    if (result && looksLikeDiff(result)) addDiff(turn, undefined, result);
  }
}

function applyTimelineEntry(turn: ShareTurn, entry: TimelineEntry): void {
  const record = entry as unknown as UnknownRecord;
  turn.timestamp = entry.ts || turn.timestamp;
  turn.model = readModel(record) ?? turn.model;
  mergeUsage(turn.usage, readUsage(record));

  const prompt = firstString(record.userPrompt, record.prompt, record.userMessage);
  const response = firstString(record.assistantResponse, record.response, record.assistantMessage);
  if (!turn.prompt && prompt) turn.prompt = prompt;
  addUnique(turn.responses, response);
  addUnique(turn.reasoning, firstString(record.reasoning, record.thinking));

  if (!turn.prompt && entry.role === 'user') turn.prompt = entry.textPreview;
  if (turn.responses.length === 0 && entry.role === 'assistant') {
    addUnique(turn.responses, entry.textPreview);
  }

  for (const file of entry.filesTouched) addUnique(turn.filesTouched, file);
  entry.toolCalls.forEach((call, index) => {
    const tool = readToolCall(call, call.name) ?? { name: call.name, ok: call.ok };
    tool.ok ??= call.ok;
    const positionalMatch = turn.tools[index];
    if (positionalMatch?.name === tool.name) {
      mergeToolFields(positionalMatch, tool);
      return;
    }
    const namedMatch = turn.tools.find(
      (candidate, candidateIndex) => candidateIndex >= index && candidate.name === tool.name
    );
    if (namedMatch) mergeToolFields(namedMatch, tool);
    else turn.tools.push(tool);
  });

  addDiffCollection(turn, record.diffs ?? record.fileDiffs ?? record.diff);
}

function buildTurns(session: Session, timeline: readonly TimelineEntry[]): ShareTurn[] {
  const turns: ShareTurn[] = [];
  let current: ShareTurn | undefined;

  for (const message of session.messages) {
    if (message.type === 'user' || message.type === 'steer') {
      if (current) turns.push(current);
      current = makeTurn(turns.length + 1, session, message.timestamp);
      current.prompt = message.content;
      const record = messageRecord(message);
      current.model = readModel(record) ?? current.model;
      mergeUsage(current.usage, readUsage(record));
      continue;
    }

    current ??= makeTurn(turns.length + 1, session, message.timestamp);
    addMessageToTurn(current, message);
  }
  if (current) turns.push(current);

  const byNumber = new Map(turns.map((turn) => [turn.number, turn]));
  for (const entry of timeline) {
    let turn = byNumber.get(entry.turn);
    if (!turn) {
      turn = makeTurn(entry.turn, session, entry.ts);
      turns.push(turn);
      byNumber.set(entry.turn, turn);
    }
    applyTimelineEntry(turn, entry);
  }

  return turns.sort((left, right) => left.number - right.number);
}

function redact(text: string): string {
  return scrubSecrets(text);
}

function escapeHtml(text: string): string {
  return redact(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function truncate(text: string, maxLength: number): string {
  const safe = redact(text);
  if (safe.length <= maxLength) return safe;
  return `${safe.slice(0, maxLength)}\n… [résultat tronqué]`;
}

function stringifySummary(value: unknown): string {
  const safeValue = scrubValue(value);
  let serialized: string;
  try {
    serialized = typeof safeValue === 'string' ? safeValue : JSON.stringify(safeValue, null, 2);
  } catch {
    serialized = String(safeValue);
  }
  return truncate(serialized || '{}', MAX_TOOL_ARGUMENTS_LENGTH);
}

function renderProse(text: string): string {
  const safe = redact(text);
  const codeFence = /```([^\n`]*)\n([\s\S]*?)```/g;
  const parts: string[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  const renderPlain = (plain: string): string => {
    const escaped = escapeHtml(plain);
    return escaped.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  };

  while ((match = codeFence.exec(safe)) !== null) {
    parts.push(`<div class="prose">${renderPlain(safe.slice(cursor, match.index))}</div>`);
    const language = (match[1] || 'texte').trim().replace(/[^A-Za-z0-9#+.-]/g, '') || 'texte';
    parts.push(
      `<pre class="code"><span class="code-label">${escapeHtml(language)}</span><code>${escapeHtml((match[2] ?? '').trim())}</code></pre>`
    );
    cursor = match.index + match[0].length;
  }
  parts.push(`<div class="prose">${renderPlain(safe.slice(cursor))}</div>`);
  return parts.join('');
}

function diffLineClass(line: string): string {
  if (/^\+\+\+ /.test(line) || /^--- /.test(line) || /^diff --git /.test(line)) return 'diff-file';
  if (/^@@/.test(line)) return 'diff-hunk';
  if (/^\+/.test(line)) return 'diff-add';
  if (/^-/.test(line)) return 'diff-remove';
  return 'diff-context';
}

function renderDiff(diff: ShareDiff): string {
  const lines = truncate(diff.content, 24_000)
    .split('\n')
    .map((line) => `<span class="${diffLineClass(line)}">${escapeHtml(line)}</span>`)
    .join('\n');
  return `
    <div class="diff-block">
      <div class="diff-path">${escapeHtml(diff.path)}</div>
      <pre class="diff"><code>${lines}</code></pre>
    </div>`;
}

function formatTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Horodatage indisponible';
  return date
    .toISOString()
    .replace('T', ' ')
    .replace(/\.000Z$/, ' UTC');
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
}

function titleFromSession(session: Session, turns: readonly ShareTurn[]): string {
  const prompt = turns.find((turn) => turn.prompt.trim())?.prompt;
  const fallback =
    firstString(session.metadata?.description, session.name, session.id) ?? 'Session Code Buddy';
  const normalized = redact(prompt ?? fallback)
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > MAX_TITLE_LENGTH
    ? `${normalized.slice(0, MAX_TITLE_LENGTH - 1)}…`
    : normalized;
}

function renderTool(tool: ShareToolCall): string {
  const status = tool.ok === true ? 'réussi' : tool.ok === false ? 'échoué' : 'statut inconnu';
  const statusClass = tool.ok === true ? 'ok' : tool.ok === false ? 'failed' : 'unknown';
  const argumentsHtml =
    tool.arguments === undefined
      ? '<p class="empty compact">Arguments non conservés dans cette sauvegarde.</p>'
      : `<pre class="tool-data"><code>${escapeHtml(stringifySummary(tool.arguments))}</code></pre>`;
  const resultHtml =
    tool.result === undefined
      ? '<p class="empty compact">Résultat détaillé non conservé.</p>'
      : `<pre class="tool-data result"><code>${escapeHtml(truncate(tool.result, MAX_TOOL_RESULT_LENGTH))}</code></pre>`;

  return `
    <div class="tool-card">
      <div class="tool-heading">
        <code>${escapeHtml(tool.name)}</code>
        <span class="status ${statusClass}">${status}</span>
      </div>
      <div class="tool-columns">
        <div><div class="eyebrow">Arguments résumés</div>${argumentsHtml}</div>
        <div><div class="eyebrow">Résultat</div>${resultHtml}</div>
      </div>
    </div>`;
}

function renderTurn(turn: ShareTurn): string {
  const usageBadges = [
    turn.model ? `<span>${escapeHtml(turn.model)}</span>` : '',
    turn.usage.tokens !== undefined ? `<span>${Math.round(turn.usage.tokens)} tokens</span>` : '',
    turn.usage.costUsd !== undefined ? `<span>${formatCost(turn.usage.costUsd)}</span>` : '',
  ]
    .filter(Boolean)
    .join('');
  const responses =
    turn.responses.length > 0
      ? turn.responses
          .map((response) => renderProse(response))
          .join('<div class="response-separator"></div>')
      : '<p class="empty">Réponse complète non disponible; seule la sauvegarde de timeline peut subsister.</p>';
  const prompt = turn.prompt
    ? renderProse(turn.prompt)
    : '<p class="empty">Message utilisateur non conservé dans la timeline disponible.</p>';
  const reasoning =
    turn.reasoning.length > 0
      ? `<details class="detail-card"><summary>Raisonnement enregistré <span>${turn.reasoning.length}</span></summary>${turn.reasoning.map(renderProse).join('<div class="response-separator"></div>')}</details>`
      : '';
  const notes =
    turn.notes.length > 0
      ? `<details class="detail-card"><summary>Progression <span>${turn.notes.length}</span></summary>${turn.notes.map(renderProse).join('')}</details>`
      : '';
  const tools =
    turn.tools.length > 0
      ? `<details class="detail-card" open><summary>Appels d’outils <span>${turn.tools.length}</span></summary>${turn.tools.map(renderTool).join('')}</details>`
      : '';
  const diffs =
    turn.diffs.length > 0
      ? `<details class="detail-card" open><summary>Diffs <span>${turn.diffs.length}</span></summary>${turn.diffs.map(renderDiff).join('')}</details>`
      : '';
  const files =
    turn.filesTouched.length > 0
      ? `<div class="files"><span class="eyebrow">Fichiers touchés</span>${turn.filesTouched.map((file) => `<code>${escapeHtml(file)}</code>`).join('')}</div>`
      : '';

  return `
  <article class="turn" id="tour-${turn.number}">
    <div class="turn-rail"><span>${String(turn.number).padStart(2, '0')}</span></div>
    <div class="turn-body">
      <header class="turn-header">
        <div><div class="eyebrow">Tour ${turn.number}</div><time>${escapeHtml(formatTimestamp(turn.timestamp))}</time></div>
        <div class="badges">${usageBadges}</div>
      </header>
      <section class="message user-message">
        <div class="message-label"><span class="avatar user-avatar">U</span><strong>Vous</strong></div>
        ${prompt}
      </section>
      <section class="message assistant-message">
        <div class="message-label"><span class="avatar buddy-avatar">B</span><strong>Code Buddy</strong></div>
        ${responses}
      </section>
      ${reasoning}${tools}${diffs}${notes}${files}
    </div>
  </article>`;
}

/**
 * Render one canonical saved session, enriched by its optional time-travel
 * timeline, as a single self-contained HTML document.
 */
export function exportSessionShareHtml(
  session: Session,
  timeline: readonly TimelineEntry[] = [],
  options: SessionShareHtmlOptions = {}
): string {
  const turns = buildTurns(session, timeline);
  const title = titleFromSession(session, turns);
  const exportedAt = options.exportedAt ?? new Date();
  const toolCount = turns.reduce((count, turn) => count + turn.tools.length, 0);
  const fileCount = new Set(turns.flatMap((turn) => turn.filesTouched)).size;
  const totalTokens = asFiniteNumber(session.metadata?.tokenCount);
  const totalCost = asFiniteNumber(session.metadata?.totalCost);
  const summaryBadges = [
    `<span>${turns.length} tour${turns.length === 1 ? '' : 's'}</span>`,
    `<span>${toolCount} outil${toolCount === 1 ? '' : 's'}</span>`,
    `<span>${fileCount} fichier${fileCount === 1 ? '' : 's'}</span>`,
    totalTokens !== undefined ? `<span>${Math.round(totalTokens)} tokens</span>` : '',
    totalCost !== undefined ? `<span>${formatCost(totalCost)}</span>` : '',
  ]
    .filter(Boolean)
    .join('');
  const content =
    turns.length > 0
      ? turns.map(renderTurn).join('')
      : '<div class="empty-state"><strong>Session vide</strong><p>Aucun message ni tour de timeline n’a été conservé.</p></div>';

  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'">
  <title>${escapeHtml(title)} — Code Buddy</title>
  <style>
    :root {
      color-scheme: dark;
      --page: #090b10;
      --panel: #11151d;
      --panel-soft: #171c26;
      --line: #2a3240;
      --text: #edf2f7;
      --muted: #8d99aa;
      --cyan: #54d6ff;
      --violet: #a78bfa;
      --green: #64e6a7;
      --red: #ff7b88;
      --amber: #f8c76a;
      --shadow: 0 28px 80px rgba(0, 0, 0, .34);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      background:
        radial-gradient(circle at 12% -10%, rgba(84, 214, 255, .12), transparent 34rem),
        radial-gradient(circle at 90% 8%, rgba(167, 139, 250, .13), transparent 30rem),
        var(--page);
      font: 15px/1.65 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .shell { width: min(1120px, calc(100% - 32px)); margin: 0 auto; }
    .hero { padding: 72px 0 44px; }
    .brand { display: flex; align-items: center; gap: 12px; color: var(--cyan); font-size: 13px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
    .brand-mark { display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid rgba(84, 214, 255, .48); border-radius: 10px; background: rgba(84, 214, 255, .08); }
    h1 { max-width: 850px; margin: 24px 0 16px; font-size: clamp(32px, 6vw, 64px); line-height: 1.05; letter-spacing: -.045em; text-wrap: balance; }
    .dek { max-width: 720px; margin: 0; color: var(--muted); font-size: 17px; }
    .session-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 26px; }
    .session-meta span, .badges span { border: 1px solid var(--line); border-radius: 999px; padding: 5px 10px; color: #b8c2d0; background: rgba(17, 21, 29, .72); font: 12px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .session-id { margin-top: 14px; color: #687486; font: 12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
    main { padding-bottom: 64px; }
    .turn { display: grid; grid-template-columns: 54px minmax(0, 1fr); position: relative; }
    .turn:not(:last-child) .turn-rail::after { content: ""; position: absolute; top: 48px; bottom: -4px; left: 26px; width: 1px; background: linear-gradient(var(--line), rgba(42, 50, 64, .2)); }
    .turn-rail { position: relative; display: flex; justify-content: center; }
    .turn-rail > span { z-index: 1; display: grid; place-items: center; width: 38px; height: 38px; border: 1px solid rgba(84, 214, 255, .38); border-radius: 50%; color: var(--cyan); background: #0d1118; font: 700 12px/1 ui-monospace, SFMono-Regular, Consolas, monospace; box-shadow: 0 0 24px rgba(84, 214, 255, .08); }
    .turn-body { min-width: 0; padding: 0 0 54px 16px; }
    .turn-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin: 4px 0 14px; }
    .eyebrow { color: var(--muted); font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    time { color: #697587; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
    .message, .detail-card, .files { border: 1px solid var(--line); border-radius: 18px; background: linear-gradient(145deg, rgba(23, 28, 38, .92), rgba(14, 18, 25, .94)); box-shadow: var(--shadow); }
    .message { position: relative; padding: 22px; margin-bottom: 12px; overflow: hidden; }
    .message::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--cyan); }
    .assistant-message::before { background: var(--violet); }
    .message-label { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
    .message-label strong { font-size: 13px; letter-spacing: .02em; }
    .avatar { display: grid; place-items: center; width: 27px; height: 27px; border-radius: 9px; font: 800 11px/1 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .user-avatar { color: #061118; background: var(--cyan); }
    .buddy-avatar { color: #100c1d; background: var(--violet); }
    .prose { white-space: pre-wrap; overflow-wrap: anywhere; }
    .prose:empty { display: none; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; }
    .prose code { border: 1px solid #313a49; border-radius: 6px; padding: 1px 5px; color: #d9e6f2; background: #0b0f15; font-size: .91em; }
    pre { margin: 12px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .code { position: relative; padding: 38px 16px 16px; border: 1px solid #283140; border-radius: 12px; color: #d7e0eb; background: #090d13; overflow-x: auto; }
    .code-label { position: absolute; top: 10px; right: 12px; color: #647083; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; }
    .response-separator { height: 1px; margin: 20px 0; background: var(--line); }
    .empty { margin: 0; color: #748094; font-style: italic; }
    .empty.compact { font-size: 13px; }
    .detail-card { margin-top: 12px; overflow: hidden; box-shadow: none; }
    summary { display: flex; align-items: center; gap: 9px; padding: 15px 18px; cursor: pointer; color: #d6deea; font-size: 13px; font-weight: 750; user-select: none; }
    summary::marker { color: var(--cyan); }
    summary span { margin-left: auto; min-width: 24px; border-radius: 999px; padding: 2px 7px; color: var(--muted); background: #0b0f15; text-align: center; font: 11px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; }
    details > .prose { padding: 0 18px 18px; color: #bdc7d4; }
    .tool-card { padding: 16px 18px; border-top: 1px solid var(--line); }
    .tool-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .tool-heading code { color: var(--amber); font-weight: 750; }
    .status { border-radius: 999px; padding: 3px 8px; font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
    .status.ok { color: var(--green); background: rgba(100, 230, 167, .1); }
    .status.failed { color: var(--red); background: rgba(255, 123, 136, .1); }
    .status.unknown { color: var(--muted); background: rgba(141, 153, 170, .1); }
    .tool-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .tool-data { max-height: 260px; overflow: auto; padding: 12px; border: 1px solid #293240; border-radius: 10px; color: #bac6d5; background: #090d13; font-size: 12px; }
    .tool-data.result { color: #a9d9c2; }
    .diff-block { border-top: 1px solid var(--line); }
    .diff-path { padding: 12px 18px; color: #c2ccd9; background: rgba(8, 11, 16, .48); font: 12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
    .diff { max-height: 520px; margin: 0; padding: 15px 18px; overflow: auto; color: #aeb9c8; background: #090d13; font-size: 12px; line-height: 1.55; }
    .diff span { display: block; min-width: max-content; }
    .diff-add { color: #8ce8b8; background: rgba(44, 168, 104, .1); }
    .diff-remove { color: #ff9ba5; background: rgba(203, 66, 78, .1); }
    .diff-hunk { color: #9bb9ff; }
    .diff-file { color: #f5c978; font-weight: 700; }
    .files { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; padding: 14px 16px; box-shadow: none; }
    .files code { border: 1px solid #303947; border-radius: 7px; padding: 3px 7px; color: #aebccc; background: #0b0f15; font-size: 11px; overflow-wrap: anywhere; }
    .empty-state { padding: 48px; border: 1px dashed var(--line); border-radius: 20px; color: var(--muted); text-align: center; }
    footer { padding: 26px 0 46px; border-top: 1px solid rgba(42, 50, 64, .7); color: #697587; font-size: 12px; }
    footer strong { color: #9ca8b8; }
    @media (max-width: 720px) {
      .shell { width: min(100% - 20px, 1120px); }
      .hero { padding-top: 42px; }
      .turn { grid-template-columns: 34px minmax(0, 1fr); }
      .turn-rail > span { width: 30px; height: 30px; }
      .turn:not(:last-child) .turn-rail::after { left: 16px; top: 38px; }
      .turn-body { padding-left: 8px; }
      .turn-header { display: block; }
      .badges { justify-content: flex-start; margin-top: 8px; }
      .message { padding: 17px; border-radius: 14px; }
      .tool-columns { grid-template-columns: 1fr; }
    }
    @media print {
      :root { color-scheme: light; --page: #fff; --panel: #fff; --panel-soft: #fff; --line: #d8dde5; --text: #17202b; --muted: #5d6877; --shadow: none; }
      body { background: #fff; }
      .hero { padding-top: 24px; }
      .turn, .message, .detail-card, .diff-block { break-inside: avoid; }
      .message, .detail-card, .files { background: #fff; }
      details { display: block; }
      details > * { display: block; }
    }
  </style>
</head>
<body>
  <header class="hero shell">
    <div class="brand"><span class="brand-mark">CB</span> Session Replay</div>
    <h1>${escapeHtml(title)}</h1>
    <p class="dek">Un replay autonome de la conversation, des outils et des modifications enregistrées.</p>
    <div class="session-meta">${summaryBadges}</div>
    <div class="session-id">Session ${escapeHtml(session.id)} · ${escapeHtml(formatTimestamp(session.createdAt))}</div>
  </header>
  <main class="shell">${content}</main>
  <footer class="shell"><strong>Code Buddy</strong> · Export généré le ${escapeHtml(formatTimestamp(exportedAt))} · HTML autonome, sans ressource réseau.</footer>
</body>
</html>`;

  // Final defence in depth: catch any future interpolated field that forgot to
  // pass through the local redaction helpers above.
  return scrubSecrets(html);
}

/** Load through SessionFacade and enrich from timeline regardless of the recording gate. */
export async function exportPersistedSessionShareHtml(
  sessionId: string,
  dependencies: PersistedSessionShareDependencies
): Promise<string | null> {
  const session = await dependencies.sessionFacade.loadSession(sessionId);
  if (!session) return null;

  let entries: TimelineEntry[] = [];
  try {
    entries = await (dependencies.timeline ?? new SessionTimeline()).list(sessionId);
  } catch (error) {
    logger.warn('[session-share] timeline unavailable; exporting saved message history', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return exportSessionShareHtml(session, entries, { exportedAt: dependencies.exportedAt });
}
