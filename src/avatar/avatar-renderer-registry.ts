import { AVATAR_PROTOCOL_VERSION } from './avatar-protocol.js';

export type AvatarRendererPhase =
  | 'ready'
  | 'buffering'
  | 'playing'
  | 'interrupted'
  | 'unavailable'
  | 'error';

export interface AvatarRendererCapabilities {
  audioDrivenAnimation: boolean;
  wavStream: boolean;
  affect: boolean;
  gestures: boolean;
  gaze: boolean;
  interruptionAck: boolean;
}

export interface AvatarRendererSnapshot {
  rendererId: string;
  displayName?: string;
  protocolVersion: number;
  runtime: 'unreal' | 'simulator' | 'other';
  runtimeVersion?: string;
  project?: string;
  capabilities: AvatarRendererCapabilities;
  phase: AvatarRendererPhase;
  activeTurnId?: string;
  lastSequence: number;
  fps?: number;
  audioBufferMs?: number;
  mouthLatencyMs?: number;
  droppedAudioChunks: number;
  connected: boolean;
  connectedAt: string;
  lastSeenAt: string;
  disconnectedAt?: string;
  reason?: string;
}

export type AvatarRendererRegistryResult =
  | { ok: true; renderer: AvatarRendererSnapshot }
  | { ok: false; error: string };

interface StoredRenderer extends AvatarRendererSnapshot {
  connectionId: string;
}

const PHASES = new Set<AvatarRendererPhase>([
  'ready',
  'buffering',
  'playing',
  'interrupted',
  'unavailable',
  'error',
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim();
  return clean && clean.length <= max ? clean : undefined;
}

function boundedNumber(
  value: unknown,
  min: number,
  max: number,
  integer = false
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return undefined;
  }
  return integer ? Math.round(value) : value;
}

function capabilities(value: unknown): AvatarRendererCapabilities {
  const input = record(value);
  const enabled = (key: keyof AvatarRendererCapabilities): boolean => input?.[key] === true;
  return {
    audioDrivenAnimation: enabled('audioDrivenAnimation'),
    wavStream: enabled('wavStream'),
    affect: enabled('affect'),
    gestures: enabled('gestures'),
    gaze: enabled('gaze'),
    interruptionAck: enabled('interruptionAck'),
  };
}

function publicSnapshot(renderer: StoredRenderer, now: Date): AvatarRendererSnapshot {
  const stale = now.getTime() - Date.parse(renderer.lastSeenAt) > 45_000;
  const { connectionId: _connectionId, ...snapshot } = renderer;
  return { ...snapshot, connected: renderer.connected && !stale };
}

/** In-memory renderer presence and playback feedback. No conversation text is stored. */
export class AvatarRendererRegistry {
  private readonly renderers = new Map<string, StoredRenderer>();

  constructor(private readonly maxRenderers = 16) {}

  register(connectionId: string, payload: unknown, now = new Date()): AvatarRendererRegistryResult {
    const input = record(payload);
    if (!input) return { ok: false, error: 'renderer hello payload must be an object' };
    const rendererId = boundedString(input.rendererId, 80);
    if (!rendererId || !/^[a-zA-Z0-9._:-]+$/.test(rendererId)) {
      return { ok: false, error: 'rendererId must use 1–80 safe identifier characters' };
    }
    if (input.protocolVersion !== AVATAR_PROTOCOL_VERSION) {
      return {
        ok: false,
        error: `unsupported avatar protocol version (expected ${AVATAR_PROTOCOL_VERSION})`,
      };
    }
    const runtime = input.runtime === 'unreal' || input.runtime === 'simulator'
      ? input.runtime
      : 'other';
    const timestamp = now.toISOString();
    const previous = this.renderers.get(rendererId);
    if (!previous && this.renderers.size >= Math.max(1, this.maxRenderers)) this.evictOne();
    const renderer: StoredRenderer = {
      rendererId,
      ...(boundedString(input.displayName, 100) ? { displayName: boundedString(input.displayName, 100) } : {}),
      protocolVersion: AVATAR_PROTOCOL_VERSION,
      runtime,
      ...(boundedString(input.runtimeVersion, 40) ? { runtimeVersion: boundedString(input.runtimeVersion, 40) } : {}),
      ...(boundedString(input.project, 160) ? { project: boundedString(input.project, 160) } : {}),
      capabilities: capabilities(input.capabilities),
      phase: 'ready',
      lastSequence: -1,
      droppedAudioChunks: 0,
      connected: true,
      connectedAt: previous?.connectedAt ?? timestamp,
      lastSeenAt: timestamp,
      connectionId,
    };
    this.renderers.set(rendererId, renderer);
    return { ok: true, renderer: publicSnapshot(renderer, now) };
  }

  report(connectionId: string, payload: unknown, now = new Date()): AvatarRendererRegistryResult {
    const input = record(payload);
    if (!input) return { ok: false, error: 'renderer status payload must be an object' };
    const rendererId = boundedString(input.rendererId, 80);
    if (!rendererId) return { ok: false, error: 'rendererId is required' };
    const renderer = this.renderers.get(rendererId);
    if (!renderer || renderer.connectionId !== connectionId || !renderer.connected) {
      return { ok: false, error: 'renderer must send avatar.renderer.hello on this connection' };
    }
    const phase = typeof input.phase === 'string' && PHASES.has(input.phase as AvatarRendererPhase)
      ? input.phase as AvatarRendererPhase
      : undefined;
    if (!phase) return { ok: false, error: 'invalid renderer phase' };
    const activeTurnId = boundedString(input.activeTurnId, 100);
    const lastSequence = boundedNumber(input.lastSequence, -1, Number.MAX_SAFE_INTEGER, true);
    const fps = boundedNumber(input.fps, 0, 360);
    const audioBufferMs = boundedNumber(input.audioBufferMs, 0, 60_000, true);
    const mouthLatencyMs = boundedNumber(input.mouthLatencyMs, 0, 60_000, true);
    const droppedAudioChunks = boundedNumber(input.droppedAudioChunks, 0, 1_000_000, true);
    const reason = boundedString(input.reason, 240);
    const updated: StoredRenderer = {
      ...renderer,
      phase,
      ...(activeTurnId ? { activeTurnId } : {}),
      ...(!activeTurnId ? { activeTurnId: undefined } : {}),
      ...(lastSequence !== undefined ? { lastSequence } : {}),
      ...(fps !== undefined ? { fps } : {}),
      ...(audioBufferMs !== undefined ? { audioBufferMs } : {}),
      ...(mouthLatencyMs !== undefined ? { mouthLatencyMs } : {}),
      ...(droppedAudioChunks !== undefined ? { droppedAudioChunks } : {}),
      ...(reason ? { reason } : {}),
      ...(!reason ? { reason: undefined } : {}),
      connected: true,
      lastSeenAt: now.toISOString(),
      disconnectedAt: undefined,
    };
    this.renderers.set(rendererId, updated);
    return { ok: true, renderer: publicSnapshot(updated, now) };
  }

  disconnectConnection(connectionId: string, now = new Date()): void {
    const timestamp = now.toISOString();
    for (const [rendererId, renderer] of this.renderers) {
      if (renderer.connectionId !== connectionId || !renderer.connected) continue;
      this.renderers.set(rendererId, {
        ...renderer,
        connected: false,
        phase: 'unavailable',
        activeTurnId: undefined,
        lastSeenAt: timestamp,
        disconnectedAt: timestamp,
        reason: 'gateway_disconnected',
      });
    }
  }

  list(now = new Date()): AvatarRendererSnapshot[] {
    return [...this.renderers.values()]
      .map((renderer) => publicSnapshot(renderer, now))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  reset(): void {
    this.renderers.clear();
  }

  private evictOne(): void {
    const candidates = [...this.renderers.values()].sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? 1 : -1;
      return a.lastSeenAt.localeCompare(b.lastSeenAt);
    });
    const selected = candidates[0];
    if (selected) this.renderers.delete(selected.rendererId);
  }
}

let registry: AvatarRendererRegistry | undefined;

export function getAvatarRendererRegistry(): AvatarRendererRegistry {
  registry ??= new AvatarRendererRegistry();
  return registry;
}

export function resetAvatarRendererRegistry(): void {
  registry?.reset();
  registry = undefined;
}

/**
 * Audio is automatic only when a live renderer explicitly advertises the WAV
 * path. `true` and `false` remain hard operator overrides.
 */
export function shouldStreamAvatarAudio(
  env: NodeJS.ProcessEnv = process.env,
  renderers: AvatarRendererSnapshot[] = getAvatarRendererRegistry().list()
): boolean {
  const configured = env.CODEBUDDY_AVATAR_STREAM_AUDIO?.trim().toLowerCase();
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return renderers.some(
    (renderer) =>
      renderer.connected &&
      renderer.capabilities.wavStream &&
      renderer.capabilities.audioDrivenAnimation
  );
}
