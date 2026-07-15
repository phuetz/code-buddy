/**
 * Non-destructive repair for a bounded acoustic feedback incident.
 *
 * Raw voice turns and hearing percepts are moved out of the active projections
 * into timestamped quarantine files. Every mutated file is copied first; the
 * report contains counts and hashes, never dialogue text.
 */
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  DEFAULT_TRAITS,
  MOOD_BASELINE,
  loadRelationshipState,
} from './relationship-state.js';

interface JsonRecord {
  [key: string]: unknown;
}

export interface VoiceIncidentRepairOptions {
  from: string | number;
  to?: string | number;
  apply?: boolean;
  now?: number;
  runtimeCwd?: string;
  conversationPath?: string;
  perceptsPath?: string;
  guidancePath?: string;
  relationshipStatePath?: string;
  improvementStatePath?: string;
  conversationQualityStatePath?: string;
  userModelPath?: string;
}

export interface VoiceIncidentRepairReport {
  mode: 'dry-run' | 'apply';
  from: string;
  to: string;
  conversation: { total: number; quarantined: number; retained: number; beforeHash: string; afterHash: string };
  percepts: { total: number; quarantined: number; retained: number; beforeHash: string; afterHash: string };
  guidanceCleared: number;
  relationshipReset: boolean;
  pendingObservationsDiscarded: number;
  stateCursorsReset: number;
  backups: string[];
  quarantines: string[];
}

interface JsonlPartition {
  total: number;
  retained: string[];
  quarantined: string[];
  beforeRaw: string;
  afterRaw: string;
}

function parseBoundary(value: string | number, label: string): number {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label} timestamp: ${String(value)}`);
  return parsed;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function compactStamp(now: number): string {
  return new Date(now).toISOString().replace(/[-:.TZ]/g, '');
}

function jsonl(lines: string[]): string {
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

function partitionJsonl(
  filePath: string,
  shouldQuarantine: (record: JsonRecord) => boolean,
): JsonlPartition {
  const beforeRaw = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  const sourceLines = beforeRaw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const retained: string[] = [];
  const quarantined: string[] = [];
  for (const line of sourceLines) {
    try {
      const record = JSON.parse(line) as JsonRecord;
      (shouldQuarantine(record) ? quarantined : retained).push(line);
    } catch {
      // Invalid historical lines remain in the active file; repair must never
      // destroy evidence it cannot classify safely.
      retained.push(line);
    }
  }
  return {
    total: sourceLines.length,
    retained,
    quarantined,
    beforeRaw,
    afterRaw: jsonl(retained),
  };
}

function recordTimestamp(record: JsonRecord): number | undefined {
  const value = record.timestamp;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inWindow(record: JsonRecord, from: number, to: number): boolean {
  const timestamp = recordTimestamp(record);
  return timestamp !== undefined && timestamp >= from && timestamp <= to;
}

function atomicWrite(filePath: string, value: string): void {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, value, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporaryPath, filePath);
  try {
    chmodSync(filePath, 0o600);
  } catch {
    /* advisory on Windows */
  }
}

function backup(filePath: string, stamp: string, backups: string[]): void {
  if (!existsSync(filePath)) return;
  const backupPath = `${filePath}.before-voice-repair-${stamp}.bak`;
  copyFileSync(filePath, backupPath);
  try {
    chmodSync(backupPath, 0o600);
  } catch {
    /* advisory on Windows */
  }
  backups.push(backupPath);
}

function readJson(filePath: string): JsonRecord | undefined {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as JsonRecord;
  } catch {
    return undefined;
  }
}

function countGuidance(filePath: string): number {
  try {
    const value = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    return Array.isArray(value) ? value.length : 0;
  } catch {
    return 0;
  }
}

function discardPendingObservations(
  userModel: JsonRecord | undefined,
  from: number,
  to: number,
  now: number,
): { next?: JsonRecord; count: number } {
  const observations = userModel?.observations;
  if (!Array.isArray(observations)) return { count: 0 };
  let count = 0;
  const nextObservations = observations.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const observation = item as JsonRecord;
    const createdAt = typeof observation.createdAt === 'number' ? observation.createdAt : NaN;
    if (
      observation.status !== 'pending'
      || !Number.isFinite(createdAt)
      || createdAt < from
      || createdAt > to
    ) {
      return item;
    }
    count += 1;
    return {
      ...observation,
      status: 'discarded',
      reviewedAt: now,
      reviewedBy: 'voice-incident-repair',
      reviewNote: 'Quarantined after acoustic feedback incident; original preserved in backup.',
    };
  });
  return { next: { ...userModel, observations: nextObservations }, count };
}

/** Inspect or apply a bounded repair. `apply` defaults to false. */
export function repairVoiceIncident(
  options: VoiceIncidentRepairOptions,
): VoiceIncidentRepairReport {
  const now = options.now ?? Date.now();
  const from = parseBoundary(options.from, 'from');
  const to = options.to === undefined ? now : parseBoundary(options.to, 'to');
  if (to < from) throw new Error('Voice incident end must be after its start.');

  const home = homedir();
  const runtimeCwd = options.runtimeCwd ?? join(home, '.codebuddy', 'bot-cwd');
  const conversationPath = options.conversationPath
    ?? join(home, '.codebuddy', 'conversations', 'lisa.jsonl');
  const perceptsPath = options.perceptsPath
    ?? join(runtimeCwd, '.codebuddy', 'companion', 'percepts.jsonl');
  const guidancePath = options.guidancePath
    ?? join(home, '.codebuddy', 'companion', 'voice-guidance.json');
  const relationshipStatePath = options.relationshipStatePath
    ?? join(home, '.codebuddy', 'companion', 'relationship-state.json');
  const improvementStatePath = options.improvementStatePath
    ?? join(home, '.codebuddy', 'companion', 'voice-improvement-state.json');
  const conversationQualityStatePath = options.conversationQualityStatePath
    ?? join(home, '.codebuddy', 'companion', 'conversation-quality-state.json');
  const userModelPath = options.userModelPath
    ?? join(runtimeCwd, '.codebuddy', 'user-model.json');

  const conversation = partitionJsonl(
    conversationPath,
    (record) => record.origin === 'voice' && inWindow(record, from, to),
  );
  const percepts = partitionJsonl(
    perceptsPath,
    (record) => record.modality === 'hearing' && inWindow(record, from, to),
  );
  const guidanceCleared = countGuidance(guidancePath);
  const relationship = loadRelationshipState(relationshipStatePath);
  const relationshipReset = relationship.mood !== undefined || relationship.traits !== undefined;
  const userModel = readJson(userModelPath);
  const discarded = discardPendingObservations(userModel, from, to, now);
  const backups: string[] = [];
  const quarantines: string[] = [];

  if (options.apply) {
    const stamp = compactStamp(now);
    for (const filePath of [
      conversationPath,
      perceptsPath,
      guidancePath,
      relationshipStatePath,
      improvementStatePath,
      conversationQualityStatePath,
      userModelPath,
    ]) {
      backup(filePath, stamp, backups);
    }

    if (conversation.quarantined.length > 0) {
      const quarantinePath = `${conversationPath}.voice-incident-${stamp}.quarantine.jsonl`;
      atomicWrite(quarantinePath, jsonl(conversation.quarantined));
      quarantines.push(quarantinePath);
    }
    if (percepts.quarantined.length > 0) {
      const quarantinePath = `${perceptsPath}.voice-incident-${stamp}.quarantine.jsonl`;
      atomicWrite(quarantinePath, jsonl(percepts.quarantined));
      quarantines.push(quarantinePath);
    }

    atomicWrite(conversationPath, conversation.afterRaw);
    atomicWrite(perceptsPath, percepts.afterRaw);
    atomicWrite(guidancePath, '[]\n');
    atomicWrite(
      relationshipStatePath,
      `${JSON.stringify({
        ...relationship,
        mood: MOOD_BASELINE,
        traits: DEFAULT_TRAITS,
      }, null, 2)}\n`,
    );
    atomicWrite(improvementStatePath, '{}\n');
    atomicWrite(conversationQualityStatePath, '{"issueStreaks":{}}\n');
    if (discarded.next) atomicWrite(userModelPath, `${JSON.stringify(discarded.next, null, 2)}\n`);
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    conversation: {
      total: conversation.total,
      quarantined: conversation.quarantined.length,
      retained: conversation.retained.length,
      beforeHash: sha256(conversation.beforeRaw),
      afterHash: sha256(conversation.afterRaw),
    },
    percepts: {
      total: percepts.total,
      quarantined: percepts.quarantined.length,
      retained: percepts.retained.length,
      beforeHash: sha256(percepts.beforeRaw),
      afterHash: sha256(percepts.afterRaw),
    },
    guidanceCleared,
    relationshipReset,
    pendingObservationsDiscarded: discarded.count,
    stateCursorsReset: 2,
    backups,
    quarantines,
  };
}
