import { appendFile, mkdir, readFile, rename, stat } from 'fs/promises';
import * as crypto from 'crypto';
import * as path from 'path';

export type CompanionSafetyEventKind = 'sense' | 'tool' | 'mission' | 'permission' | 'data';
export type CompanionSafetyEventRisk = 'low' | 'medium' | 'high';
export type CompanionSafetyEventStatus = 'planned' | 'allowed' | 'completed' | 'failed' | 'denied';

export interface CompanionSafetyEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  timestamp: string;
  cwd: string;
  kind: CompanionSafetyEventKind;
  risk: CompanionSafetyEventRisk;
  action: string;
  reason: string;
  status: CompanionSafetyEventStatus;
  source: string;
  artifactPath?: string;
  missionId?: string;
  payload: TPayload;
  tags: string[];
}

export interface CompanionSafetyEventInput<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  kind: CompanionSafetyEventKind;
  risk?: CompanionSafetyEventRisk;
  action: string;
  reason: string;
  status?: CompanionSafetyEventStatus;
  source: string;
  artifactPath?: string;
  missionId?: string;
  payload?: TPayload;
  tags?: string[];
}

export interface CompanionSafetyLedgerOptions {
  cwd?: string;
  ledgerPath?: string;
  now?: Date;
}

export interface CompanionSafetyLedgerQueryOptions extends CompanionSafetyLedgerOptions {
  limit?: number;
  kind?: CompanionSafetyEventKind;
  risk?: CompanionSafetyEventRisk;
  status?: CompanionSafetyEventStatus;
}

export interface CompanionSafetyLedgerStats {
  ledgerPath: string;
  exists: boolean;
  total: number;
  byKind: Partial<Record<CompanionSafetyEventKind, number>>;
  byRisk: Partial<Record<CompanionSafetyEventRisk, number>>;
  byStatus: Partial<Record<CompanionSafetyEventStatus, number>>;
  latestTimestamp?: string;
}

const DEFAULT_RECENT_LIMIT = 10;
const MAX_RECENT_LIMIT = 100;

function resolveCwd(cwd?: string): string {
  return cwd || process.cwd();
}

export function getCompanionSafetyLedgerPath(cwd = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'companion', 'safety-ledger.jsonl');
}

function resolveLedgerPath(options: CompanionSafetyLedgerOptions = {}): string {
  const cwd = resolveCwd(options.cwd);
  return path.resolve(cwd, options.ledgerPath || getCompanionSafetyLedgerPath(cwd));
}

function createSafetyEventId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '');
  return `safety-${stamp}-${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
}

function isKind(value: unknown): value is CompanionSafetyEventKind {
  return value === 'sense' || value === 'tool' || value === 'mission' || value === 'permission' || value === 'data';
}

function isRisk(value: unknown): value is CompanionSafetyEventRisk {
  return value === 'low' || value === 'medium' || value === 'high';
}

function isStatus(value: unknown): value is CompanionSafetyEventStatus {
  return value === 'planned'
    || value === 'allowed'
    || value === 'completed'
    || value === 'failed'
    || value === 'denied';
}

function parseSafetyEvent(line: string): CompanionSafetyEvent | null {
  try {
    const parsed = JSON.parse(line) as Partial<CompanionSafetyEvent>;
    if (
      typeof parsed.id !== 'string'
      || typeof parsed.timestamp !== 'string'
      || typeof parsed.cwd !== 'string'
      || !isKind(parsed.kind)
      || !isRisk(parsed.risk)
      || typeof parsed.action !== 'string'
      || typeof parsed.reason !== 'string'
      || !isStatus(parsed.status)
      || typeof parsed.source !== 'string'
    ) {
      return null;
    }

    return {
      id: parsed.id,
      timestamp: parsed.timestamp,
      cwd: parsed.cwd,
      kind: parsed.kind,
      risk: parsed.risk,
      action: parsed.action,
      reason: parsed.reason,
      status: parsed.status,
      source: parsed.source,
      artifactPath: parsed.artifactPath,
      missionId: parsed.missionId,
      payload: typeof parsed.payload === 'object' && parsed.payload !== null
        ? parsed.payload as Record<string, unknown>
        : {},
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    };
  } catch {
    return null;
  }
}

async function readSafetyEvents(options: CompanionSafetyLedgerOptions = {}): Promise<CompanionSafetyEvent[]> {
  const ledgerPath = resolveLedgerPath(options);
  let content: string;
  try {
    content = await readFile(ledgerPath, 'utf8');
  } catch {
    return [];
  }

  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseSafetyEvent)
    .filter((event): event is CompanionSafetyEvent => Boolean(event));
}

export async function recordCompanionSafetyEvent<TPayload extends Record<string, unknown>>(
  input: CompanionSafetyEventInput<TPayload>,
  options: CompanionSafetyLedgerOptions = {},
): Promise<CompanionSafetyEvent<TPayload>> {
  const now = options.now || new Date();
  const cwd = resolveCwd(options.cwd);
  const ledgerPath = resolveLedgerPath(options);
  const event: CompanionSafetyEvent<TPayload> = {
    id: createSafetyEventId(now),
    timestamp: now.toISOString(),
    cwd,
    kind: input.kind,
    risk: input.risk || 'low',
    action: input.action.trim(),
    reason: input.reason.trim(),
    status: input.status || 'completed',
    source: input.source.trim(),
    artifactPath: input.artifactPath,
    missionId: input.missionId,
    payload: input.payload || {} as TPayload,
    tags: normalizeTags(input.tags),
  };

  await mkdir(path.dirname(ledgerPath), { recursive: true });
  // Audit 2026-09-02 : rotation 1 Mio -> `.1` (même motif que reminder-log).
  // Alimenté à chaque snapshot caméra sur un robot 24/7, ce ledger croissait
  // sans borne et readSafetyEvents le reparse intégralement à chaque stats.
  // Seule l'absence du fichier est ignorée ; un échec de rename remonte
  // (sinon le journal continuerait de grossir après une rotation impossible).
  try {
    const info = await stat(ledgerPath);
    if (info.size > 1024 * 1024) await rename(ledgerPath, `${ledgerPath}.1`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  await appendFile(ledgerPath, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

export async function readRecentCompanionSafetyEvents(
  options: CompanionSafetyLedgerQueryOptions = {},
): Promise<CompanionSafetyEvent[]> {
  const limit = Math.max(1, Math.min(MAX_RECENT_LIMIT, options.limit || DEFAULT_RECENT_LIMIT));
  const events = await readSafetyEvents(options);
  return events
    .filter(event => !options.kind || event.kind === options.kind)
    .filter(event => !options.risk || event.risk === options.risk)
    .filter(event => !options.status || event.status === options.status)
    .slice(-limit)
    .reverse();
}

export async function getCompanionSafetyLedgerStats(
  options: CompanionSafetyLedgerOptions = {},
): Promise<CompanionSafetyLedgerStats> {
  const ledgerPath = resolveLedgerPath(options);

  try {
    const info = await stat(ledgerPath);
    if (!info.isFile()) {
      return { ledgerPath, exists: false, total: 0, byKind: {}, byRisk: {}, byStatus: {} };
    }
  } catch {
    return { ledgerPath, exists: false, total: 0, byKind: {}, byRisk: {}, byStatus: {} };
  }

  const events = await readSafetyEvents(options);
  const byKind: Partial<Record<CompanionSafetyEventKind, number>> = {};
  const byRisk: Partial<Record<CompanionSafetyEventRisk, number>> = {};
  const byStatus: Partial<Record<CompanionSafetyEventStatus, number>> = {};

  for (const event of events) {
    byKind[event.kind] = (byKind[event.kind] || 0) + 1;
    byRisk[event.risk] = (byRisk[event.risk] || 0) + 1;
    byStatus[event.status] = (byStatus[event.status] || 0) + 1;
  }

  return {
    ledgerPath,
    exists: true,
    total: events.length,
    byKind,
    byRisk,
    byStatus,
    latestTimestamp: events.at(-1)?.timestamp,
  };
}

export function formatCompanionSafetyEvents(events: CompanionSafetyEvent[]): string {
  if (events.length === 0) {
    return 'No companion safety events recorded yet.';
  }

  const lines = ['Companion Safety Ledger', '='.repeat(50)];
  for (const event of events) {
    const tags = event.tags.length > 0 ? ` [${event.tags.join(', ')}]` : '';
    lines.push(
      '',
      `${event.timestamp} ${event.kind}/${event.risk}/${event.status}${tags}`,
      `  ${event.action} via ${event.source}`,
      `  ${event.reason}`,
      `  id=${event.id}${event.missionId ? ` mission=${event.missionId}` : ''}`,
    );
    if (event.artifactPath) lines.push(`  artifact=${event.artifactPath}`);
  }
  return lines.join('\n');
}

export function formatCompanionSafetyLedgerStats(stats: CompanionSafetyLedgerStats): string {
  const lines = [
    'Companion Safety Ledger',
    '='.repeat(50),
    `Path: ${stats.ledgerPath}`,
    `Exists: ${stats.exists ? 'yes' : 'no'}`,
    `Total: ${stats.total}`,
  ];

  const sections: Array<[string, Array<[string, number]>]> = [
    ['By kind', Object.entries(stats.byKind)],
    ['By risk', Object.entries(stats.byRisk)],
    ['By status', Object.entries(stats.byStatus)],
  ];
  for (const [label, values] of sections) {
    if (values.length === 0) continue;
    lines.push(`${label}:`);
    for (const [key, count] of values) {
      lines.push(`- ${key}: ${count}`);
    }
  }
  if (stats.latestTimestamp) {
    lines.push(`Latest: ${stats.latestTimestamp}`);
  }

  return lines.join('\n');
}
