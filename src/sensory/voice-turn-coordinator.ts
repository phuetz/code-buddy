/**
 * Raw-free source of truth for the resident voice loop.
 *
 * Capture, STT, response policy, cognition, TTS and the avatar all report to the
 * same correlated turn. The bounded snapshot is safe for Cowork diagnostics: it
 * deliberately contains metrics and categorical reasons, never transcripts or
 * generated speech.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { logger } from '../utils/logger.js';

export type VoiceTurnPhase =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'deciding'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'suppressed'
  | 'completed'
  | 'failed';

export type VoiceSceneClass =
  | 'near_speech'
  | 'broadcast'
  | 'assistant_playback'
  | 'noise'
  | 'unknown';

export interface VoiceTurnTransitionDetails {
  decisionReason?: string;
  suppressionReason?: string;
  scene?: VoiceSceneClass;
  sceneConfidence?: number;
  captureMs?: number;
  sttMs?: number;
  decisionMs?: number;
  firstAudioMs?: number;
  totalMs?: number;
  wordCount?: number;
  /** One-based phrase that was active when a spoken turn was interrupted. */
  interruptedAtSentence?: number;
  spoke?: boolean;
  aecActive?: boolean;
  errorCategory?: 'capture' | 'stt' | 'decision' | 'generation' | 'synthesis' | 'playback' | 'unknown';
}

export interface VoiceTurnTransition extends VoiceTurnTransitionDetails {
  sequence: number;
  at: string;
  turnId: string;
  phase: VoiceTurnPhase;
}

export interface VoiceTurnCounters {
  captured: number;
  accepted: number;
  spoken: number;
  suppressed: number;
  interrupted: number;
  failed: number;
}

export interface VoiceTurnRuntimeSnapshot {
  version: 1;
  updatedAt: string;
  phase: VoiceTurnPhase;
  activeTurnId?: string;
  attention?: VoiceAttentionSnapshot;
  counters: VoiceTurnCounters;
  recent: VoiceTurnTransition[];
}

export interface VoiceAttentionSnapshot {
  engaged: boolean;
  source?: 'addressed' | 'greeting' | 'arrival';
  remainingMs: number;
  dialogueAgeMs: number;
  closeReason?: string;
}

export interface VoiceTurnCoordinatorOptions {
  now?: () => number;
  runtimeFile?: string;
  persist?: boolean;
  maxRecent?: number;
}

export const VOICE_RUNTIME_FILE_ENV = 'CODEBUDDY_VOICE_RUNTIME_FILE';

export function resolveVoiceRuntimeFile(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[VOICE_RUNTIME_FILE_ENV]?.trim();
  return resolve(configured || join(homedir(), '.codebuddy', 'companion', 'voice-runtime.json'));
}

const PHASES = new Set<VoiceTurnPhase>([
  'idle', 'listening', 'transcribing', 'deciding', 'thinking', 'speaking',
  'interrupted', 'suppressed', 'completed', 'failed',
]);

/** Read only allowlisted, raw-free fields written by the coordinator. */
export function readVoiceRuntimeSnapshot(
  path = resolveVoiceRuntimeFile(),
): VoiceTurnRuntimeSnapshot | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as VoiceTurnRuntimeSnapshot;
    if (parsed.version !== 1 || !PHASES.has(parsed.phase) || !parsed.counters) return null;
    const recent = Array.isArray(parsed.recent)
      ? parsed.recent.slice(-200).flatMap((item) => {
          if (!item || !PHASES.has(item.phase) || typeof item.turnId !== 'string') return [];
          return [{
            sequence: finiteNonNegative(item.sequence) ?? 0,
            at: typeof item.at === 'string' ? item.at.slice(0, 40) : '',
            turnId: item.turnId.slice(0, 128),
            phase: item.phase,
            ...sanitizeDetails(item),
          }];
        })
      : [];
    const counter = (value: number): number => finiteNonNegative(value) ?? 0;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt.slice(0, 40) : '',
      phase: parsed.phase,
      ...(typeof parsed.activeTurnId === 'string'
        ? { activeTurnId: parsed.activeTurnId.slice(0, 128) }
        : {}),
      ...(parsed.attention
        ? {
            attention: {
              engaged: parsed.attention.engaged === true,
              ...(parsed.attention.source ? { source: parsed.attention.source } : {}),
              remainingMs: counter(parsed.attention.remainingMs),
              dialogueAgeMs: counter(parsed.attention.dialogueAgeMs),
              ...(safeReason(parsed.attention.closeReason)
                ? { closeReason: safeReason(parsed.attention.closeReason) }
                : {}),
            },
          }
        : {}),
      counters: {
        captured: counter(parsed.counters.captured),
        accepted: counter(parsed.counters.accepted),
        spoken: counter(parsed.counters.spoken),
        suppressed: counter(parsed.counters.suppressed),
        interrupted: counter(parsed.counters.interrupted),
        failed: counter(parsed.counters.failed),
      },
      recent,
    };
  } catch {
    return null;
  }
}

function finiteNonNegative(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

function boundedConfidence(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value)
    ? Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000
    : undefined;
}

function safeReason(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 64);
}

function sanitizeDetails(details: VoiceTurnTransitionDetails): VoiceTurnTransitionDetails {
  return {
    ...(safeReason(details.decisionReason)
      ? { decisionReason: safeReason(details.decisionReason) }
      : {}),
    ...(safeReason(details.suppressionReason)
      ? { suppressionReason: safeReason(details.suppressionReason) }
      : {}),
    ...(details.scene ? { scene: details.scene } : {}),
    ...(boundedConfidence(details.sceneConfidence) !== undefined
      ? { sceneConfidence: boundedConfidence(details.sceneConfidence) }
      : {}),
    ...(finiteNonNegative(details.captureMs) !== undefined
      ? { captureMs: finiteNonNegative(details.captureMs) }
      : {}),
    ...(finiteNonNegative(details.sttMs) !== undefined ? { sttMs: finiteNonNegative(details.sttMs) } : {}),
    ...(finiteNonNegative(details.decisionMs) !== undefined
      ? { decisionMs: finiteNonNegative(details.decisionMs) }
      : {}),
    ...(finiteNonNegative(details.firstAudioMs) !== undefined
      ? { firstAudioMs: finiteNonNegative(details.firstAudioMs) }
      : {}),
    ...(finiteNonNegative(details.totalMs) !== undefined
      ? { totalMs: finiteNonNegative(details.totalMs) }
      : {}),
    ...(finiteNonNegative(details.wordCount) !== undefined
      ? { wordCount: finiteNonNegative(details.wordCount) }
      : {}),
    ...(finiteNonNegative(details.interruptedAtSentence) !== undefined
      ? { interruptedAtSentence: finiteNonNegative(details.interruptedAtSentence) }
      : {}),
    ...(details.spoke !== undefined ? { spoke: details.spoke } : {}),
    ...(details.aecActive !== undefined ? { aecActive: details.aecActive } : {}),
    ...(details.errorCategory ? { errorCategory: details.errorCategory } : {}),
  };
}

export class VoiceTurnCoordinator {
  private readonly now: () => number;
  private readonly runtimeFile: string;
  private readonly persistEnabled: boolean;
  private readonly maxRecent: number;
  private sequence = 0;
  private phase: VoiceTurnPhase = 'idle';
  private activeTurnId: string | undefined;
  private readonly activeTurns = new Map<string, VoiceTurnPhase>();
  private recent: VoiceTurnTransition[] = [];
  private attention: VoiceAttentionSnapshot | undefined;
  private counters: VoiceTurnCounters = {
    captured: 0,
    accepted: 0,
    spoken: 0,
    suppressed: 0,
    interrupted: 0,
    failed: 0,
  };

  constructor(options: VoiceTurnCoordinatorOptions = {}) {
    this.now = options.now ?? Date.now;
    this.runtimeFile = options.runtimeFile ?? resolveVoiceRuntimeFile();
    this.persistEnabled = options.persist
      ?? (process.env.NODE_ENV !== 'test' && process.env.CODEBUDDY_VOICE_RUNTIME !== 'false');
    this.maxRecent = Math.max(8, Math.min(200, options.maxRecent ?? 48));
  }

  transition(
    turnId: string,
    phase: VoiceTurnPhase,
    details: VoiceTurnTransitionDetails = {},
  ): VoiceTurnRuntimeSnapshot {
    const normalizedTurnId = turnId.trim().slice(0, 128) || `voice_${this.now()}`;
    const transition: VoiceTurnTransition = {
      sequence: ++this.sequence,
      at: new Date(this.now()).toISOString(),
      turnId: normalizedTurnId,
      phase,
      ...sanitizeDetails(details),
    };
    const firstPhaseForTurn = !this.recent.some(
      item => item.turnId === normalizedTurnId && item.phase === phase,
    );
    const terminal = ['interrupted', 'suppressed', 'completed', 'failed', 'idle'].includes(phase);
    if (terminal) {
      this.activeTurns.delete(normalizedTurnId);
      const nextActive = [...this.activeTurns.entries()].at(-1);
      this.phase = nextActive?.[1] ?? phase;
      this.activeTurnId = nextActive?.[0];
    } else {
      this.activeTurns.delete(normalizedTurnId);
      this.activeTurns.set(normalizedTurnId, phase);
      this.phase = phase;
      this.activeTurnId = normalizedTurnId;
    }
    if (firstPhaseForTurn && phase === 'listening') this.counters.captured++;
    if (firstPhaseForTurn && phase === 'thinking') this.counters.accepted++;
    if (firstPhaseForTurn && phase === 'speaking') this.counters.spoken++;
    if (firstPhaseForTurn && phase === 'suppressed') this.counters.suppressed++;
    if (firstPhaseForTurn && phase === 'interrupted') this.counters.interrupted++;
    if (firstPhaseForTurn && phase === 'failed') this.counters.failed++;
    this.recent.push(transition);
    if (this.recent.length > this.maxRecent) this.recent.splice(0, this.recent.length - this.maxRecent);
    const snapshot = this.snapshot();
    this.persist(snapshot);
    return snapshot;
  }

  snapshot(): VoiceTurnRuntimeSnapshot {
    const latestAt = this.recent.at(-1)?.at ?? new Date(this.now()).toISOString();
    return {
      version: 1,
      updatedAt: latestAt,
      phase: this.phase,
      ...(this.activeTurnId ? { activeTurnId: this.activeTurnId } : {}),
      ...(this.attention ? { attention: { ...this.attention } } : {}),
      counters: { ...this.counters },
      recent: this.recent.map(item => ({ ...item })),
    };
  }

  updateAttention(attention: VoiceAttentionSnapshot): void {
    this.attention = {
      engaged: attention.engaged,
      ...(attention.source ? { source: attention.source } : {}),
      remainingMs: Math.max(0, Math.round(attention.remainingMs)),
      dialogueAgeMs: Math.max(0, Math.round(attention.dialogueAgeMs)),
      ...(attention.closeReason ? { closeReason: safeReason(attention.closeReason) } : {}),
    };
    this.persist(this.snapshot());
  }

  reset(): void {
    this.sequence = 0;
    this.phase = 'idle';
    this.activeTurnId = undefined;
    this.activeTurns.clear();
    this.recent = [];
    this.attention = undefined;
    this.counters = {
      captured: 0,
      accepted: 0,
      spoken: 0,
      suppressed: 0,
      interrupted: 0,
      failed: 0,
    };
    this.persist(this.snapshot());
  }

  private persist(snapshot: VoiceTurnRuntimeSnapshot): void {
    if (!this.persistEnabled) return;
    const temporary = `${this.runtimeFile}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(this.runtimeFile), { recursive: true });
      writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporary, this.runtimeFile);
    } catch (error) {
      logger.debug('[voice-turn] runtime snapshot write skipped', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

let globalCoordinator: VoiceTurnCoordinator | undefined;

export function getVoiceTurnCoordinator(): VoiceTurnCoordinator {
  globalCoordinator ??= new VoiceTurnCoordinator();
  return globalCoordinator;
}

export function resetVoiceTurnCoordinatorForTests(): void {
  globalCoordinator = undefined;
}
