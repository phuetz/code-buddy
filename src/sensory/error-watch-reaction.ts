/**
 * Error-watch reaction — notices an error already visible in an existing screen
 * percept and offers one quiet, local-voice-only invitation to help.
 *
 * Detection is text-first ($0), with an explicitly enabled local-VLM fallback
 * for an existing keyframe. The reaction never captures or stores an image and
 * never starts an agent turn. It is double opt-in, bounded, deduplicated and
 * never-throws.
 *
 * @module sensory/error-watch-reaction
 */

import { createHash } from 'crypto';
import type { Conductor } from '../companion/orchestrator.js';
import { getCompanionConductor } from '../companion/orchestrator.js';
import { getGlobalEventBus } from '../events/event-bus.js';
import type { BaseEvent } from '../events/types.js';
import { logger } from '../utils/logger.js';
import { perceptionOf } from './reactions.js';
import { getSensoryMemory } from './sensory-memory.js';

const ERROR_INDICATOR = /Traceback|Error:|Exception|FAILED|npm ERR!|panic:|segfault|Uncaught/i;
const ERROR_DETAIL = /(?:\w*Error|\w*Exception|FAILED|npm ERR!|panic:|segfault|Uncaught)\b:?/i;
const HOUR_MS = 3_600_000;
const DEFAULT_DEBOUNCE_MS = 120_000;
const DEFAULT_MAX_PER_HOUR = 4;
const MAX_TEXT_CHARS = 32_000;
const MAX_DEDUP_ENTRIES = 256;

const TEXT_KEYS = new Set([
  'text',
  'ocr',
  'ocrtext',
  'dump',
  'atspi',
  'accessibilitytext',
  'accessibletext',
  'terminaltext',
  'content',
]);

const TEXT_CONTAINER_KEYS = new Set([
  'ocr',
  'atspi',
  'accessibility',
  'terminal',
]);

const ERROR_WATCH_PROMPT =
  'Une erreur, une stack trace, un terminal en échec ou une boîte de dialogue d’échec est-elle visible ? ' +
  'Réponds strictement OUI ou NON, puis une seule ligne de résumé sans autre commentaire.';

export interface ErrorWatchVisionAnalysis {
  success: boolean;
  description?: string;
}

export interface ErrorWatchVisionAnalyzer {
  analyze(prompt: string, imagePath?: string): Promise<ErrorWatchVisionAnalysis>;
}

export interface ErrorWatchReactionOptions {
  /** Injectable local vision analyzer. Defaults to the configured local VLM. */
  analyzer?: ErrorWatchVisionAnalyzer;
  /** Injectable local voice output. No remote channel is ever used. */
  say?: (utterance: string) => Promise<void>;
  /** Shared one-voice arbiter. */
  conductor?: Pick<Conductor, 'claim'>;
  debounceMs?: number;
  maxPerHour?: number;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
}

interface ErrorIndicator {
  evidence: string;
  summary: string;
}

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, '');
}

function appendBounded(parts: string[], value: string, state: { length: number }): void {
  if (state.length >= MAX_TEXT_CHARS) return;
  const remaining = MAX_TEXT_CHARS - state.length;
  const clipped = value.slice(0, remaining);
  if (!clipped.trim()) return;
  parts.push(clipped);
  state.length += clipped.length;
}

/** Extract only fields that explicitly represent OCR/accessibility/terminal text. */
export function extractScreenText(payload: unknown): string {
  const parts: string[] = [];
  const state = { length: 0 };

  const visit = (value: unknown, allowString: boolean, depth: number): void => {
    if (depth > 4 || state.length >= MAX_TEXT_CHARS) return;
    if (typeof value === 'string') {
      if (allowString) appendBounded(parts, value, state);
      return;
    }
    if (Array.isArray(value)) {
      if (!allowString) return;
      for (const item of value) visit(item, true, depth + 1);
      return;
    }
    if (!value || typeof value !== 'object') return;

    if (allowString) {
      for (const nested of Object.values(value)) visit(nested, true, depth + 1);
      return;
    }

    for (const [key, nested] of Object.entries(value)) {
      const normalized = normalizedKey(key);
      const isText = TEXT_KEYS.has(normalized);
      const isContainer = TEXT_CONTAINER_KEYS.has(normalized);
      if (!isText && !isContainer) continue;
      visit(nested, isText || isContainer, depth + 1);
    }
  };

  visit(payload, typeof payload === 'string', 0);
  return parts.join('\n');
}

function normalizeEvidence(text: string): string {
  const withoutControls = Array.from(text, (character) => {
    const code = character.charCodeAt(0);
    const allowedWhitespace = code === 9 || code === 10 || code === 13;
    return (code < 32 && !allowedWhitespace) || code === 127 ? ' ' : character;
  }).join('');
  return withoutControls
    .replace(/\s+/g, ' ')
    .trim();
}

function clipSummary(text: string, max = 140): string {
  const normalized = normalizeEvidence(text);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

export function findTextErrorIndicator(text: string): ErrorIndicator | null {
  const match = ERROR_INDICATOR.exec(text);
  if (!match || match.index === undefined) return null;

  const before = text.lastIndexOf('\n', match.index);
  const after = text.indexOf('\n', match.index);
  const lineStart = before < 0 ? 0 : before + 1;
  const lineEnd = after < 0 ? text.length : after;
  const firstLine = text.slice(lineStart, lineEnd).trim();
  const followingLines = text
    .slice(lineEnd + 1, Math.min(text.length, lineEnd + 700))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const detail = followingLines.find((line) => ERROR_DETAIL.test(line));
  const summary = clipSummary(detail && detail !== firstLine ? `${firstLine} — ${detail}` : firstLine);
  const evidence = normalizeEvidence(
    text.slice(Math.max(0, lineStart - 120), Math.min(text.length, lineEnd + 700)),
  );
  return summary && evidence ? { evidence, summary } : null;
}

function parseVisionIndicator(analysis: ErrorWatchVisionAnalysis): ErrorIndicator | null {
  if (!analysis.success || !analysis.description) return null;
  const response = analysis.description.trim();
  const yes = response.match(/^OUI\b[\s:—-]*(.*)$/isu);
  if (!yes) return null;
  const detail = clipSummary(yes[1] || 'visible');
  return {
    evidence: normalizeEvidence(response),
    summary: detail || 'visible',
  };
}

function keyframePath(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ['imagePath', 'keyframePath', 'framePath', 'path']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function configuredNumber(
  explicit: number | undefined,
  envValue: string | undefined,
  fallback: number,
): number {
  if (explicit !== undefined) return finiteNonNegative(explicit, fallback);
  if (envValue === undefined || envValue.trim() === '') return fallback;
  return finiteNonNegative(Number(envValue), fallback);
}

function indicatorHash(evidence: string): string {
  return createHash('sha256').update(evidence.toLowerCase()).digest('hex');
}

function isLoopbackVisionEndpoint(baseURL: string): boolean {
  try {
    const url = new URL(baseURL);
    const loopback = url.hostname === '127.0.0.1'
      || url.hostname === 'localhost'
      || url.hostname === '[::1]';
    return loopback && (url.protocol === 'http:' || url.protocol === 'https:');
  } catch {
    return false;
  }
}

async function defaultSay(utterance: string): Promise<void> {
  const { sayNow } = await import('./voice-loop.js');
  await sayNow(utterance, { phoneDelivery: 'never' });
}

async function defaultVisionAnalyze(
  prompt: string,
  imagePath?: string,
): Promise<ErrorWatchVisionAnalysis> {
  if (!imagePath) return { success: false };
  try {
    const baseURL = process.env.CODEBUDDY_VISION_BASE_URL || 'http://127.0.0.1:11434/v1';
    if (!isLoopbackVisionEndpoint(baseURL)) {
      logger.warn('[error-watch] refusing screen keyframe egress to a non-loopback VLM endpoint');
      return { success: false };
    }
    const [{ loadImageFromFile, buildMultimodalContent }, { CodeBuddyClient }] = await Promise.all([
      import('../tools/image-input.js'),
      import('../codebuddy/client.js'),
    ]);
    const image = await loadImageFromFile(imagePath);
    const content = buildMultimodalContent(prompt, [image]);
    const model = process.env.CODEBUDDY_VISION_MODEL || 'moondream';
    const client = new CodeBuddyClient(process.env.OLLAMA_API_KEY || 'ollama', model, baseURL);
    const response = await client.chat([{ role: 'user', content } as never], []);
    const description = (response?.choices?.[0]?.message?.content ?? '').trim();
    return { success: Boolean(description), description };
  } catch (error) {
    logger.warn(
      `[error-watch] local VLM analyze failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { success: false };
  }
}

export function shouldWireErrorWatchReaction(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.CODEBUDDY_SENSORY === 'true' && env.CODEBUDDY_SENSORY_ERRORWATCH === 'true';
}

export function wireErrorWatchReaction(options: ErrorWatchReactionOptions = {}): () => void {
  const env = options.env ?? process.env;
  if (!shouldWireErrorWatchReaction(env)) return () => undefined;

  const bus = getGlobalEventBus();
  const debounceMs = configuredNumber(
    options.debounceMs,
    env.CODEBUDDY_ERRORWATCH_DEBOUNCE_MS,
    DEFAULT_DEBOUNCE_MS,
  );
  const maxPerHour = Math.floor(configuredNumber(
    options.maxPerHour,
    env.CODEBUDDY_ERRORWATCH_MAX_PER_HOUR,
    DEFAULT_MAX_PER_HOUR,
  ));
  const visionEnabled = env.CODEBUDDY_ERRORWATCH_VISION === 'true';
  const analyzer = options.analyzer ?? { analyze: defaultVisionAnalyze };
  const conductor = options.conductor ?? getCompanionConductor();
  const say = options.say ?? defaultSay;
  const now = options.now ?? (() => Date.now());
  const seenHashes = new Set<string>();
  const seenOrder: string[] = [];
  let suggestionTimes: number[] = [];
  let lastSuggestedAt = Number.NEGATIVE_INFINITY;
  let inFlight = false;

  const rememberHash = (hash: string): void => {
    seenHashes.add(hash);
    seenOrder.push(hash);
    if (seenOrder.length <= MAX_DEDUP_ENTRIES) return;
    const oldest = seenOrder.shift();
    if (oldest !== undefined) seenHashes.delete(oldest);
  };

  const id = bus.on('sensory:perception', (event: BaseEvent) => {
    try {
      const percept = perceptionOf(event);
      if (percept.modality !== 'screen') return;
      if (percept.kind !== 'change' && percept.kind !== 'keyframe') return;
      if (inFlight) return;
      inFlight = true;

      void (async () => {
        try {
          const text = extractScreenText(percept.payload);
          let indicator = text ? findTextErrorIndicator(text) : null;
          if (!indicator && visionEnabled) {
            const imagePath = keyframePath(percept.payload);
            if (imagePath) {
              indicator = parseVisionIndicator(await analyzer.analyze(ERROR_WATCH_PROMPT, imagePath));
            }
          }
          if (!indicator) return;

          const hash = indicatorHash(indicator.evidence);
          if (seenHashes.has(hash)) {
            logger.info('[error-watch] duplicate error suppressed');
            return;
          }

          const t = now();
          if (t - lastSuggestedAt < debounceMs) {
            logger.info('[error-watch] suggestion debounced');
            return;
          }
          suggestionTimes = suggestionTimes.filter((at) => t - at < HOUR_MS);
          if (maxPerHour === 0 || suggestionTimes.length >= maxPerHour) {
            logger.info('[error-watch] hourly suggestion quota reached');
            return;
          }
          if (!conductor.claim('error-watch')) {
            logger.info('[error-watch] yielded to the companion conductor');
            return;
          }

          const utterance =
            `Je vois une erreur ${indicator.summary} à l’écran — ` +
            'dis "aide-moi" si tu veux que je regarde.';
          await say(utterance);
          lastSuggestedAt = t;
          suggestionTimes.push(t);
          rememberHash(hash);
          getSensoryMemory().push({
            modality: 'suggestion',
            kind: 'error_watch',
            salience: 180,
            tsMs: t,
            receivedAt: t,
            payload: { utterance, summary: indicator.summary, indicatorHash: hash },
          });
          logger.info('[error-watch] local voice suggestion emitted');
        } catch (error) {
          logger.warn(
            `[error-watch] reaction failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          inFlight = false;
        }
      })();
    } catch (error) {
      inFlight = false;
      logger.warn(
        `[error-watch] event ignored after failure: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  return () => {
    bus.off(id);
  };
}
