import { appendFile, mkdir, readFile, rename, stat } from 'fs/promises';
import * as crypto from 'crypto';
import * as path from 'path';

export type CompanionPerceptModality =
  | 'vision'
  | 'hearing'
  | 'screen'
  | 'self'
  | 'memory'
  | 'tool'
  | 'suggestion';

export interface CompanionPercept<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  modality: CompanionPerceptModality;
  source: string;
  timestamp: string;
  confidence: number;
  summary: string;
  payload: TPayload;
  tags: string[];
}

export interface CompanionPerceptInput<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  modality: CompanionPerceptModality;
  source: string;
  summary: string;
  payload?: TPayload;
  confidence?: number;
  tags?: string[];
}

export interface CompanionPerceptStoreOptions {
  cwd?: string;
  storePath?: string;
  now?: Date;
}

export interface CompanionPerceptQueryOptions {
  cwd?: string;
  storePath?: string;
  limit?: number;
  modality?: CompanionPerceptModality;
}

export interface CompanionPerceptStats {
  storePath: string;
  exists: boolean;
  total: number;
  byModality: Partial<Record<CompanionPerceptModality, number>>;
  latestTimestamp?: string;
  voice?: CompanionVoiceLoopStats;
}

export interface CompanionNumericStats {
  count: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  avg: number;
}

export interface CompanionVoiceLoopStats {
  windowSize: number;
  hearingCount: number;
  latest?: {
    timestamp: string;
    device?: string;
    sttMs?: number;
    totalMs?: number;
    firstAudioMs?: number;
    perceivedResponseMs?: number;
    responseMode?: string;
    peakRms?: number;
    rmsOn?: number;
    signalMargin?: number;
  };
  latency: {
    sttMs?: CompanionNumericStats;
    totalMs?: CompanionNumericStats;
    decisionMs?: CompanionNumericStats;
    actionMs?: CompanionNumericStats;
    firstAudioMs?: CompanionNumericStats;
    perceivedResponseMs?: CompanionNumericStats;
    voiceTotalMs?: CompanionNumericStats;
    eventToSttStartMs?: CompanionNumericStats;
  };
  capture: {
    captureMs?: CompanionNumericStats;
    writeMs?: CompanionNumericStats;
    peakRms?: CompanionNumericStats;
    avgRms?: CompanionNumericStats;
    signalMargin?: CompanionNumericStats;
  };
  health: {
    realtimeBudgetMs: number;
    sttBudgetMs: number;
    slowLoopCount: number;
    slowSttCount: number;
    weakSignalCount: number;
  };
}

interface EncryptedCompanionPerceptPayload {
  __encrypted: true;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
}

const DEFAULT_RECENT_LIMIT = 10;
const MAX_RECENT_LIMIT = 100;
const ENCRYPTED_SUMMARY = '[encrypted companion percept]';
const VOICE_STATS_WINDOW = 100;
const VOICE_LOOP_BUDGET_MS = 5_000;
const VOICE_STT_BUDGET_MS = 2_500;
const VOICE_SIGNAL_MARGIN = 1.35;

function resolveCwd(cwd?: string): string {
  return cwd || process.cwd();
}

export function getCompanionPerceptsPath(cwd = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'companion', 'percepts.jsonl');
}

function resolveStorePath(options: CompanionPerceptStoreOptions = {}): string {
  return path.resolve(resolveCwd(options.cwd), options.storePath || getCompanionPerceptsPath(resolveCwd(options.cwd)));
}

function normalizeConfidence(confidence: number | undefined): number {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) return 1;
  return Math.max(0, Math.min(1, confidence));
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
}

function createPerceptId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '');
  return `percept-${stamp}-${crypto.randomBytes(4).toString('hex')}`;
}

function getEncryptionKey(): Buffer | null {
  const raw = process.env.CODEBUDDY_COMPANION_ENCRYPTION_KEY
    || process.env.CODEBUDDY_COMPANION_MEMORY_KEY;
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw).digest();
}

function isEncryptedPayload(value: unknown): value is EncryptedCompanionPerceptPayload {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Partial<EncryptedCompanionPerceptPayload>;
  return raw.__encrypted === true
    && raw.algorithm === 'aes-256-gcm'
    && typeof raw.iv === 'string'
    && typeof raw.tag === 'string'
    && typeof raw.ciphertext === 'string';
}

function encryptPerceptFields(
  summary: string,
  payload: Record<string, unknown>,
  key: Buffer,
): { summary: string; payload: EncryptedCompanionPerceptPayload } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify({ summary, payload });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    summary: ENCRYPTED_SUMMARY,
    payload: {
      __encrypted: true,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    },
  };
}

function decryptPerceptFields(
  encrypted: EncryptedCompanionPerceptPayload,
  key: Buffer,
): { summary: string; payload: Record<string, unknown> } | null {
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(encrypted.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    const parsed = JSON.parse(plaintext) as { summary?: unknown; payload?: unknown };
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : ENCRYPTED_SUMMARY,
      payload: typeof parsed.payload === 'object' && parsed.payload !== null
        ? parsed.payload as Record<string, unknown>
        : {},
    };
  } catch {
    return null;
  }
}

function parsePercept(line: string): CompanionPercept | null {
  try {
    const parsed = JSON.parse(line) as Partial<CompanionPercept>;
    if (
      typeof parsed.id !== 'string'
      || typeof parsed.modality !== 'string'
      || typeof parsed.source !== 'string'
      || typeof parsed.timestamp !== 'string'
      || typeof parsed.summary !== 'string'
    ) {
      return null;
    }
    const rawPayload = typeof parsed.payload === 'object' && parsed.payload !== null
      ? parsed.payload as Record<string, unknown>
      : {};
    let summary = parsed.summary;
    let payload = rawPayload;
    if (isEncryptedPayload(rawPayload)) {
      const key = getEncryptionKey();
      const decrypted = key ? decryptPerceptFields(rawPayload, key) : null;
      summary = decrypted?.summary || '[encrypted companion percept: key unavailable]';
      payload = decrypted?.payload || { encrypted: true, keyRequired: 'CODEBUDDY_COMPANION_ENCRYPTION_KEY' };
    }

    return {
      id: parsed.id,
      modality: parsed.modality as CompanionPerceptModality,
      source: parsed.source,
      timestamp: parsed.timestamp,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 1,
      summary,
      payload,
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    };
  } catch {
    return null;
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function finiteNumberValue(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numericStats(values: number[]): CompanionNumericStats | undefined {
  const clean = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length === 0) return undefined;
  const percentile = (p: number): number => {
    const index = Math.max(0, Math.min(clean.length - 1, Math.ceil(p * clean.length) - 1));
    return clean[index]!;
  };
  return {
    count: clean.length,
    min: clean[0]!,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: clean[clean.length - 1]!,
    avg: clean.reduce((sum, value) => sum + value, 0) / clean.length,
  };
}

function buildVoiceLoopStats(percepts: CompanionPercept[]): CompanionVoiceLoopStats | undefined {
  const hearing = percepts
    .filter(percept => percept.modality === 'hearing')
    .slice(-VOICE_STATS_WINDOW);
  if (hearing.length === 0) return undefined;

  const sttMs: number[] = [];
  const totalMs: number[] = [];
  const decisionMs: number[] = [];
  const actionMs: number[] = [];
  const firstAudioMs: number[] = [];
  const perceivedResponseMs: number[] = [];
  const voiceTotalMs: number[] = [];
  const eventToSttStartMs: number[] = [];
  const captureMs: number[] = [];
  const writeMs: number[] = [];
  const peakRms: number[] = [];
  const avgRms: number[] = [];
  const signalMargin: number[] = [];
  let slowLoopCount = 0;
  let slowSttCount = 0;
  let weakSignalCount = 0;

  for (const percept of hearing) {
    const payload = objectValue(percept.payload);
    const latency = objectValue(payload?.latency);
    const capture = objectValue(payload?.capture);
    const stt = finiteNumberValue(latency?.sttMs);
    const total = finiteNumberValue(latency?.totalMs);
    const decision = finiteNumberValue(latency?.decisionMs);
    const action = finiteNumberValue(latency?.actionMs);
    const firstAudio = finiteNumberValue(latency?.firstAudioMs);
    const perceivedResponse = finiteNumberValue(latency?.perceivedResponseMs);
    const voiceTotal = finiteNumberValue(latency?.voiceTotalMs);
    const eventDelay = finiteNumberValue(latency?.eventToSttStartMs);
    const captureDuration = finiteNumberValue(capture?.ms);
    const writeDuration = finiteNumberValue(capture?.writeMs);
    const peak = finiteNumberValue(capture?.peakRms) ?? finiteNumberValue(capture?.rms);
    const avg = finiteNumberValue(capture?.avgRms);
    const rmsOn = finiteNumberValue(capture?.rmsOn);

    if (stt !== undefined) {
      sttMs.push(stt);
      if (stt >= VOICE_STT_BUDGET_MS) slowSttCount++;
    }
    if (total !== undefined) {
      totalMs.push(total);
      if (total >= VOICE_LOOP_BUDGET_MS) slowLoopCount++;
    }
    if (decision !== undefined) decisionMs.push(decision);
    if (action !== undefined) actionMs.push(action);
    if (firstAudio !== undefined) firstAudioMs.push(firstAudio);
    if (perceivedResponse !== undefined) perceivedResponseMs.push(perceivedResponse);
    if (voiceTotal !== undefined) voiceTotalMs.push(voiceTotal);
    if (eventDelay !== undefined) eventToSttStartMs.push(eventDelay);
    if (captureDuration !== undefined) captureMs.push(captureDuration);
    if (writeDuration !== undefined) writeMs.push(writeDuration);
    if (peak !== undefined) peakRms.push(peak);
    if (avg !== undefined) avgRms.push(avg);
    if (peak !== undefined && rmsOn !== undefined && rmsOn > 0) {
      const margin = peak / rmsOn;
      signalMargin.push(margin);
      if (margin < VOICE_SIGNAL_MARGIN) weakSignalCount++;
    }
  }

  const latest = hearing.at(-1);
  const latestPayload = objectValue(latest?.payload);
  const latestLatency = objectValue(latestPayload?.latency);
  const latestCapture = objectValue(latestPayload?.capture);
  const latestPeakRms = finiteNumberValue(latestCapture?.peakRms) ?? finiteNumberValue(latestCapture?.rms);
  const latestRmsOn = finiteNumberValue(latestCapture?.rmsOn);
  const latestSignalMargin = latestPeakRms !== undefined && latestRmsOn !== undefined && latestRmsOn > 0
    ? latestPeakRms / latestRmsOn
    : undefined;

  return {
    windowSize: VOICE_STATS_WINDOW,
    hearingCount: hearing.length,
    latest: latest
      ? {
          timestamp: latest.timestamp,
          device: stringValue(latestCapture?.device),
          sttMs: finiteNumberValue(latestLatency?.sttMs),
          totalMs: finiteNumberValue(latestLatency?.totalMs),
          firstAudioMs: finiteNumberValue(latestLatency?.firstAudioMs),
          perceivedResponseMs: finiteNumberValue(latestLatency?.perceivedResponseMs),
          responseMode: stringValue(latestPayload?.responseMode),
          peakRms: latestPeakRms,
          rmsOn: latestRmsOn,
          signalMargin: latestSignalMargin,
        }
      : undefined,
    latency: {
      sttMs: numericStats(sttMs),
      totalMs: numericStats(totalMs),
      decisionMs: numericStats(decisionMs),
      actionMs: numericStats(actionMs),
      firstAudioMs: numericStats(firstAudioMs),
      perceivedResponseMs: numericStats(perceivedResponseMs),
      voiceTotalMs: numericStats(voiceTotalMs),
      eventToSttStartMs: numericStats(eventToSttStartMs),
    },
    capture: {
      captureMs: numericStats(captureMs),
      writeMs: numericStats(writeMs),
      peakRms: numericStats(peakRms),
      avgRms: numericStats(avgRms),
      signalMargin: numericStats(signalMargin),
    },
    health: {
      realtimeBudgetMs: VOICE_LOOP_BUDGET_MS,
      sttBudgetMs: VOICE_STT_BUDGET_MS,
      slowLoopCount,
      slowSttCount,
      weakSignalCount,
    },
  };
}

export async function recordCompanionPercept<TPayload extends Record<string, unknown>>(
  input: CompanionPerceptInput<TPayload>,
  options: CompanionPerceptStoreOptions = {},
): Promise<CompanionPercept<TPayload>> {
  const now = options.now || new Date();
  const storePath = resolveStorePath(options);
  const percept: CompanionPercept<TPayload> = {
    id: createPerceptId(now),
    modality: input.modality,
    source: input.source,
    timestamp: now.toISOString(),
    confidence: normalizeConfidence(input.confidence),
    summary: input.summary.trim(),
    payload: input.payload || {} as TPayload,
    tags: normalizeTags(input.tags),
  };
  const encryptionKey = getEncryptionKey();
  const storedPercept = encryptionKey
    ? {
        ...percept,
        ...encryptPerceptFields(percept.summary, percept.payload, encryptionKey),
      }
    : percept;

  await mkdir(path.dirname(storePath), { recursive: true });
  // Rotate when large (the disk-guard lesson, mirroring dreams.jsonl): a long-running
  // companion appends a percept per event, so cap growth + keep one backup.
  try {
    const info = await stat(storePath);
    if (info.size > 1024 * 1024) await rename(storePath, `${storePath}.1`);
  } catch {
    /* no file yet */
  }
  await appendFile(storePath, `${JSON.stringify(storedPercept)}\n`, 'utf8');
  return percept;
}

export async function readRecentCompanionPercepts(
  options: CompanionPerceptQueryOptions = {},
): Promise<CompanionPercept[]> {
  const storePath = resolveStorePath(options);
  const limit = Math.max(1, Math.min(MAX_RECENT_LIMIT, options.limit || DEFAULT_RECENT_LIMIT));

  let content: string;
  try {
    content = await readFile(storePath, 'utf8');
  } catch {
    return [];
  }

  const matches = content
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parsePercept)
    .filter((percept): percept is CompanionPercept => Boolean(percept))
    .filter(percept => !options.modality || percept.modality === options.modality);

  return matches.slice(-limit).reverse();
}

export async function getCompanionPerceptStats(
  options: CompanionPerceptStoreOptions = {},
): Promise<CompanionPerceptStats> {
  const storePath = resolveStorePath(options);

  try {
    const info = await stat(storePath);
    if (!info.isFile()) {
      return { storePath, exists: false, total: 0, byModality: {} };
    }
  } catch {
    return { storePath, exists: false, total: 0, byModality: {} };
  }

  const content = await readFile(storePath, 'utf8');
  const percepts = content
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parsePercept)
    .filter((percept): percept is CompanionPercept => Boolean(percept));

  const byModality: Partial<Record<CompanionPerceptModality, number>> = {};
  for (const percept of percepts) {
    byModality[percept.modality] = (byModality[percept.modality] || 0) + 1;
  }

  return {
    storePath,
    exists: true,
    total: percepts.length,
    byModality,
    latestTimestamp: percepts.at(-1)?.timestamp,
    voice: buildVoiceLoopStats(percepts),
  };
}

export function formatCompanionPercepts(percepts: CompanionPercept[]): string {
  if (percepts.length === 0) {
    return 'No companion percepts recorded yet.';
  }

  const lines = ['Recent Companion Percepts', '='.repeat(50)];
  for (const percept of percepts) {
    const tags = percept.tags.length > 0 ? ` [${percept.tags.join(', ')}]` : '';
    lines.push(
      '',
      `${percept.timestamp} ${percept.modality}/${percept.source}${tags}`,
      `  ${percept.summary}`,
      `  id=${percept.id} confidence=${percept.confidence.toFixed(2)}`,
    );
  }
  return lines.join('\n');
}

export function formatCompanionPerceptStats(stats: CompanionPerceptStats): string {
  const lines = [
    'Companion Percept Store',
    '='.repeat(50),
    `Path: ${stats.storePath}`,
    `Exists: ${stats.exists ? 'yes' : 'no'}`,
    `Total: ${stats.total}`,
  ];

  const modalities = Object.entries(stats.byModality);
  if (modalities.length > 0) {
    lines.push('By modality:');
    for (const [modality, count] of modalities) {
      lines.push(`- ${modality}: ${count}`);
    }
  }
  if (stats.latestTimestamp) {
    lines.push(`Latest: ${stats.latestTimestamp}`);
  }
  if (stats.voice) {
    const fmtMs = (series: CompanionNumericStats | undefined): string =>
      series
        ? `count=${series.count} p50=${Math.round(series.p50)}ms p95=${Math.round(series.p95)}ms avg=${Math.round(series.avg)}ms max=${Math.round(series.max)}ms`
        : 'n/a';
    const fmtRatio = (series: CompanionNumericStats | undefined): string =>
      series
        ? `count=${series.count} p50=${series.p50.toFixed(2)} p95=${series.p95.toFixed(2)} min=${series.min.toFixed(2)}`
        : 'n/a';
    lines.push(
      '',
      `Voice loop (last ${stats.voice.hearingCount}/${stats.voice.windowSize} hearing percepts):`,
      `- total: ${fmtMs(stats.voice.latency.totalMs)}`,
      `- perceived response: ${fmtMs(stats.voice.latency.perceivedResponseMs)}`,
      `- first audio (voice action): ${fmtMs(stats.voice.latency.firstAudioMs)}`,
      `- stt: ${fmtMs(stats.voice.latency.sttMs)}`,
      `- event->stt: ${fmtMs(stats.voice.latency.eventToSttStartMs)}`,
      `- capture: ${fmtMs(stats.voice.capture.captureMs)}`,
      `- signal margin: ${fmtRatio(stats.voice.capture.signalMargin)}`,
      `- health: slowLoop=${stats.voice.health.slowLoopCount}, slowStt=${stats.voice.health.slowSttCount}, weakSignal=${stats.voice.health.weakSignalCount}`,
    );
    if (stats.voice.latest) {
      lines.push(
        `- latest: ${stats.voice.latest.timestamp}`
          + (stats.voice.latest.device ? ` device=${stats.voice.latest.device}` : '')
          + (stats.voice.latest.totalMs !== undefined ? ` total=${Math.round(stats.voice.latest.totalMs)}ms` : '')
          + (stats.voice.latest.perceivedResponseMs !== undefined ? ` perceived=${Math.round(stats.voice.latest.perceivedResponseMs)}ms` : '')
          + (stats.voice.latest.firstAudioMs !== undefined ? ` firstAudio=${Math.round(stats.voice.latest.firstAudioMs)}ms` : '')
          + (stats.voice.latest.responseMode ? ` mode=${stats.voice.latest.responseMode}` : '')
          + (stats.voice.latest.sttMs !== undefined ? ` stt=${Math.round(stats.voice.latest.sttMs)}ms` : '')
          + (stats.voice.latest.signalMargin !== undefined ? ` margin=${stats.voice.latest.signalMargin.toFixed(2)}` : ''),
      );
    }
  }

  return lines.join('\n');
}
