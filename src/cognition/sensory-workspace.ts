import { createHash, randomBytes } from 'node:crypto';
import { getGlobalEventBus } from '../events/event-bus.js';
import type { BaseEvent } from '../events/types.js';
import { perceptionOf } from '../sensory/reactions.js';
import {
  normalizeVisionDescription,
  redactVisionDescriptionForEgress,
} from '../sensory/vision-description-safety.js';
import { CognitiveMesh } from './cognitive-mesh.js';
import { GlobalWorkspace } from './global-workspace.js';
import type { WorkspaceDraft, WorkspaceItem, WorkspacePrivacy } from './types.js';
import {
  WorldModel,
  type WorldEntity,
  type WorldObservation,
  type WorldObservation2D,
} from './world-model.js';

export interface SafeSensoryPercept {
  modality: string;
  kind: string;
  observedAt: number;
  sensorId: string;
  confidence: number;
  trackerId?: string;
  occupancyCount?: number;
  departureConfirmed?: boolean;
  observation2d?: WorldObservation2D;
  sceneSummary?: string;
}

const TRACKER_SCOPE = randomBytes(16).toString('hex');

export interface EmbodiedCognitionHandle {
  workspace: GlobalWorkspace;
  mesh: CognitiveMesh;
  worldModel: WorldModel;
  snapshotWorld(now?: number): readonly WorldEntity[];
  sweepWorld(now?: number): readonly WorldEntity[];
  close(): void;
}

function safeSensorId(value: unknown): string {
  if (typeof value !== 'string') return 'primary';
  const safe = value.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 40);
  return safe || 'primary';
}

function safeConfidence(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

function safeTrackerId(value: unknown, sensorId: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const bounded = value.trim().slice(0, 128);
  if (!bounded) return undefined;
  return `track-${createHash('sha256')
    .update(`${TRACKER_SCOPE}\0${sensorId}\0${bounded}`)
    .digest('hex')
    .slice(0, 20)}`;
}

function safeObservation2D(value: unknown, sensorId: string): WorldObservation2D | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  const { x, y, width, height } = candidate;
  if (
    typeof x !== 'number' || !Number.isFinite(x) ||
    typeof y !== 'number' || !Number.isFinite(y) ||
    typeof width !== 'number' || !Number.isFinite(width) ||
    typeof height !== 'number' || !Number.isFinite(height)
  ) {
    return undefined;
  }
  if (
    x < 0 || y < 0 || width <= 0 || height <= 0 ||
    x > 1 || y > 1 || width > 1 || height > 1 ||
    x + width > 1 || y + height > 1
  ) {
    return undefined;
  }
  return { sensorId, x, y, width, height };
}

function visionContextPrivacy(): WorkspacePrivacy {
  const configured = process.env.CODEBUDDY_VISION_CONTEXT_PRIVACY;
  return configured === 'cloud-ok' || configured === 'trusted-lan'
    ? configured
    : 'local-only';
}

function plausibleObservedAt(sensorTimestamp: number | undefined, receivedAt: number): number {
  const epoch2000 = 946_684_800_000;
  return sensorTimestamp !== undefined &&
    Number.isFinite(sensorTimestamp) &&
    sensorTimestamp >= epoch2000 &&
    sensorTimestamp <= receivedAt + 30_000
    ? sensorTimestamp
    : receivedAt;
}

export interface UntrustedSensoryPercept {
  modality: unknown;
  kind: unknown;
  observedAt?: unknown;
  sensorId?: unknown;
  confidence?: unknown;
  presenceEpisodeId?: unknown;
  occupancyCount?: unknown;
  departureConfirmed?: unknown;
  box2d?: unknown;
}

/**
 * Canonical trust boundary for embodied percept metadata.
 *
 * It deliberately rebuilds the payload from an allowlist. Detector-owned IDs
 * are scoped and hashed here; raw IDs, images, paths, landmarks and arbitrary
 * renderer fields therefore cannot enter the cognitive workspace.
 */
export function sanitizeSensoryPercept(
  input: UntrustedSensoryPercept,
  options: { receivedAt?: number; fallbackConfidence?: number } = {},
): SafeSensoryPercept | null {
  if (typeof input.modality !== 'string' || typeof input.kind !== 'string') return null;
  const modality = input.modality.trim().slice(0, 64);
  const kind = input.kind.trim().slice(0, 64);
  if (!modality || !kind) return null;
  const receivedAt = options.receivedAt ?? Date.now();
  const sensorId = safeSensorId(input.sensorId);
  const trackerId = safeTrackerId(input.presenceEpisodeId, sensorId);
  const occupancyCount = typeof input.occupancyCount === 'number' &&
    Number.isInteger(input.occupancyCount) &&
    input.occupancyCount >= 0 &&
    input.occupancyCount <= 100
    ? input.occupancyCount
    : undefined;
  const observation2d = safeObservation2D(input.box2d, sensorId);
  const confidence = safeConfidence(input.confidence, options.fallbackConfidence ?? 0.8);
  return {
    modality,
    kind,
    observedAt: plausibleObservedAt(
      typeof input.observedAt === 'number' ? input.observedAt : undefined,
      receivedAt,
    ),
    sensorId,
    confidence,
    ...(trackerId ? { trackerId } : {}),
    ...(occupancyCount !== undefined ? { occupancyCount } : {}),
    ...(input.departureConfirmed === true ? { departureConfirmed: true } : {}),
    ...(observation2d ? { observation2d } : {}),
  };
}

function observationId(percept: SafeSensoryPercept, entityId: string): string {
  return createHash('sha256')
    .update(
      `${percept.sensorId}\0${percept.modality}\0${percept.kind}\0${percept.observedAt}\0${entityId}`,
    )
    .digest('hex');
}

function observationsOf(
  trigger: WorkspaceItem<SafeSensoryPercept>,
): WorldObservation[] {
  if (trigger.payload.modality !== 'vision') return [];
  const {
    sensorId,
    trackerId,
    occupancyCount,
    departureConfirmed,
    observation2d,
  } = trigger.payload;
  if (trigger.payload.kind === 'people_observed' && occupancyCount !== undefined) {
    const entityId = `person-occupancy:${sensorId}`;
    const visibility = occupancyCount > 0 ? 'visible' : 'unknown';
    return [{
      eventId: observationId(trigger.payload, entityId),
      entityId,
      entityType: 'person-occupancy',
      visibility,
      observedAt: trigger.payload.observedAt,
      receivedAt: trigger.createdAt,
      confidence: trigger.payload.confidence,
      source: trigger.provenance.source,
      kind: trigger.payload.kind,
      ttlMs: visibility === 'visible' ? 15_000 : 5_000,
      ...(occupancyCount > 0 ? { attributes: { count: occupancyCount } } : {}),
    }];
  }
  const cameraVisibility = trigger.payload.kind === 'camera_alive'
    ? 'visible'
    : trigger.payload.kind === 'camera_unavailable'
      ? 'absent'
      : null;
  if (cameraVisibility) {
    const entityId = `camera-stream:${sensorId}`;
    return [{
      eventId: observationId(trigger.payload, entityId),
      entityId,
      entityType: 'camera-stream',
      visibility: cameraVisibility,
      observedAt: trigger.payload.observedAt,
      receivedAt: trigger.createdAt,
      confidence: trigger.payload.confidence,
      source: trigger.provenance.source,
      kind: trigger.payload.kind,
      ttlMs: 15_000,
    }];
  }
  const confirmedDeparture = trigger.payload.kind === 'person_left' && departureConfirmed === true;
  const visibility = trigger.payload.kind === 'person_entered' ||
    trigger.payload.kind === 'person_observed'
    ? 'visible'
    : trigger.payload.kind === 'person_lost' ||
      trigger.payload.kind === 'person_track_lost' ||
      (trigger.payload.kind === 'person_left' && !confirmedDeparture)
      ? 'unknown'
    : confirmedDeparture
      ? 'absent'
      : null;
  if (!visibility) return [];
  const observations: WorldObservation[] = [];
  // A tracked departure cannot imply an empty room when other tracks may be
  // active. Only an explicit aggregate count, or a legacy untracked detector,
  // is authoritative for occupancy.
  if (
    !trackerId ||
    visibility === 'visible' ||
    visibility === 'unknown' ||
    occupancyCount !== undefined
  ) {
    const occupancyId = `person-occupancy:${sensorId}`;
    const occupancyVisibility = occupancyCount !== undefined && occupancyCount > 0
      ? 'visible'
      : visibility === 'unknown'
        ? 'unknown'
        : occupancyCount !== undefined
          ? 'absent'
          : visibility;
    observations.push({
      eventId: observationId(trigger.payload, occupancyId),
      entityId: occupancyId,
      entityType: 'person-occupancy',
      visibility: occupancyVisibility,
      observedAt: trigger.payload.observedAt,
      receivedAt: trigger.createdAt,
      confidence: trigger.payload.confidence,
      source: trigger.provenance.source,
      kind: trigger.payload.kind,
      ttlMs: occupancyVisibility === 'visible' ? 15_000 : 5_000,
      ...(occupancyCount !== undefined ? { attributes: { count: occupancyCount } } : {}),
    });
  }
  if (trackerId) {
    const entityId = `person-track:${sensorId}:${trackerId}`;
    observations.push({
      eventId: observationId(trigger.payload, entityId),
      entityId,
      entityType: 'person-track',
      visibility,
      observedAt: trigger.payload.observedAt,
      receivedAt: trigger.createdAt,
      confidence: trigger.payload.confidence,
      source: trigger.provenance.source,
      kind: trigger.payload.kind,
      ttlMs: visibility === 'visible' ? 15_000 : 5_000,
      trackerId,
      ...(observation2d ? { observation2d } : {}),
    });
  }
  return observations;
}

function factOf(entity: WorldEntity): WorkspaceDraft {
  const isEpistemicCorrection = entity.visibility === 'unknown';
  return {
    kind: 'fact',
    producerId: 'world-model',
    correlationId: `world:${entity.id}`,
    salience: isEpistemicCorrection ? 0.45 : 0.8,
    confidence: isEpistemicCorrection ? 1 : entity.confidence,
    privacy: 'local-only',
    provenance: { source: 'deterministic-world-reducer' },
    ttlMs: 30_000,
    dedupeKey: `entity:${entity.id}`,
    payload: entity,
  };
}

/**
 * Shadow-mode adapter: mirrors safe sensory metadata into the cognitive mesh.
 * Raw audio, transcripts, image data, local paths and arbitrary payload fields
 * intentionally never cross this boundary.
 */
export function wireSensoryWorkspace(options: {
  workspace?: GlobalWorkspace;
  mesh?: CognitiveMesh;
  worldModel?: WorldModel;
  now?: () => number;
  worldSweepMs?: number;
} = {}): EmbodiedCognitionHandle {
  const workspace = options.workspace ?? new GlobalWorkspace();
  const mesh = options.mesh ?? new CognitiveMesh(workspace);
  const worldModel = options.worldModel ?? new WorldModel();
  const now = options.now ?? Date.now;
  const publishWorldChanges = (entities: readonly WorldEntity[]): void => {
    for (const entity of entities) mesh.publish(factOf(entity));
  };
  mesh.register({
    id: 'world-model',
    role: 'deterministic embodied state reducer',
    subscriptions: ['percept'],
    privacyClearance: 'local-only',
    mailboxCapacity: 32,
    overflow: 'coalesce-latest',
    activate: async ({ trigger }) => {
      const sensoryTrigger = trigger as WorkspaceItem<SafeSensoryPercept>;
      const drafts = worldModel.expire(trigger.createdAt).map((entity) =>
        factOf(entity),
      );
      for (const observation of observationsOf(sensoryTrigger)) {
        const result = worldModel.observe(observation);
        if (result.applied) drafts.push(factOf(result.entity));
      }
      return drafts;
    },
  });

  let sequence = 0;
  const listenerId = getGlobalEventBus().on('sensory:perception', (event: BaseEvent) => {
    const perception = perceptionOf(event);
    if (!perception.modality || !perception.kind) return;
    const receivedAt = perception.receivedAt ?? event.timestamp;
    const rawPayload =
      perception.payload && typeof perception.payload === 'object'
        ? perception.payload as Record<string, unknown>
        : {};
    const semanticConfidence = perception.kind === 'person_entered' || perception.kind === 'person_left'
      ? 0.95
      : 0.8;
    const safePercept = sanitizeSensoryPercept({
      modality: perception.modality,
      kind: perception.kind,
      observedAt: perception.tsMs,
      sensorId: rawPayload.camera ?? rawPayload.sensorId,
      confidence: rawPayload.confidence,
      presenceEpisodeId:
        rawPayload.presenceEpisodeId ?? rawPayload.trackerId ?? rawPayload.trackId,
      occupancyCount: rawPayload.occupancyCount,
      departureConfirmed: rawPayload.departureConfirmed,
      box2d: rawPayload.box2d,
    }, { receivedAt, fallbackConfidence: semanticConfidence });
    if (!safePercept) return;
    const rawSceneDescription = perception.kind === 'scene_described' &&
      typeof rawPayload.description === 'string'
      ? rawPayload.description
      : undefined;
    const sceneSummary = perception.kind === 'scene_described'
      ? normalizeVisionDescription(rawSceneDescription)
      : undefined;
    const scenePrivacy = sceneSummary ? visionContextPrivacy() : 'local-only';
    const projectedSceneSummary = sceneSummary && scenePrivacy !== 'local-only'
      ? redactVisionDescriptionForEgress(rawSceneDescription ?? '')
      : sceneSummary;
    const correlationId = `sensory:${event.timestamp}:${++sequence}`;
    mesh.publish<SafeSensoryPercept>({
      kind: 'percept',
      producerId: `sense:${perception.modality}`,
      correlationId,
      salience: Math.max(0, Math.min(1, (perception.salience ?? 0) / 255)),
      confidence: safePercept.confidence,
      privacy: 'local-only',
      provenance: { source: 'sensory-bridge' },
      ttlMs: 10_000,
      payload: sceneSummary ? { ...safePercept, sceneSummary } : safePercept,
    });
    if (projectedSceneSummary) {
      mesh.publish({
        kind: 'hypothesis',
        producerId: 'sense:vision-vlm',
        correlationId,
        salience: Math.max(0.5, Math.min(1, (perception.salience ?? 0) / 255)),
        confidence: safeConfidence(rawPayload.confidence, 0.7),
        privacy: scenePrivacy,
        provenance: { source: 'local-vision-description' },
        ttlMs: 45_000,
        dedupeKey: scenePrivacy === 'local-only' ? `scene:${safePercept.sensorId}` : 'scene:egress',
        payload: {
          summary: scenePrivacy === 'local-only'
            ? `Description visuelle non vérifiée (${safePercept.sensorId}) : ${projectedSceneSummary}`
            : `Description visuelle non vérifiée (caméra locale) : ${projectedSceneSummary}`,
        },
      });
    }
  });

  const configuredSweep = Math.floor(options.worldSweepMs ?? 1_000);
  const sweepTimer = configuredSweep > 0
    ? setInterval(() => publishWorldChanges(worldModel.expire(now())), configuredSweep)
    : undefined;
  sweepTimer?.unref();

  return {
    workspace,
    mesh,
    worldModel,
    snapshotWorld: (at) => worldModel.snapshot(at),
    sweepWorld: (at = now()) => {
      const changed = worldModel.expire(at);
      publishWorldChanges(changed);
      return changed;
    },
    close: () => {
      getGlobalEventBus().off(listenerId);
      if (sweepTimer) clearInterval(sweepTimer);
      mesh.stop();
    },
  };
}
