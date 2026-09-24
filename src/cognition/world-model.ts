export type EntityVisibility = 'visible' | 'absent' | 'unknown';

export interface WorldProvenance {
  source: string;
  kind: string;
  eventId: string;
  observedAt: number;
  receivedAt: number;
}

export interface ObservationCursor {
  observedAt: number;
  transitionRank: number;
  eventId: string;
}

/**
 * Where a face is relative to the robot — an ESTIMATE from one monocular camera
 * (field of view + mean interpupillary distance), never a measurement. Azimuth
 * > 0 is the robot's right, elevation > 0 above its camera axis.
 */
export interface WorldSpatialEstimate {
  basis: 'estimate-ipd-v1';
  azimuthDeg: number;
  elevationDeg: number;
  distanceM: number;
  facing?: boolean;
}

/** A camera-relative observation. No identity; depth only as a labelled estimate. */
export interface WorldObservation2D {
  sensorId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  spatial?: WorldSpatialEstimate;
}

export function safeSpatialEstimate(value: unknown): WorldSpatialEstimate | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.basis !== 'estimate-ipd-v1') return undefined;
  const { azimuthDeg, elevationDeg, distanceM, facing } = candidate;
  if (
    typeof azimuthDeg !== 'number' || !Number.isFinite(azimuthDeg) || Math.abs(azimuthDeg) > 90 ||
    typeof elevationDeg !== 'number' || !Number.isFinite(elevationDeg) || Math.abs(elevationDeg) > 90 ||
    typeof distanceM !== 'number' || !Number.isFinite(distanceM) || distanceM <= 0 || distanceM > 20
  ) {
    return undefined;
  }
  return {
    basis: 'estimate-ipd-v1',
    azimuthDeg,
    elevationDeg,
    distanceM,
    ...(typeof facing === 'boolean' ? { facing } : {}),
  };
}

export interface WorldEntityObservation2D extends WorldObservation2D {
  space: 'image-normalized-v1';
  observedAt: number;
}

export interface WorldObservation {
  eventId: string;
  entityId: string;
  entityType: string;
  visibility: EntityVisibility;
  observedAt: number;
  receivedAt: number;
  confidence: number;
  source: string;
  kind: string;
  ttlMs: number;
  /** Ephemeral anonymous tracker, never a biometric or durable person id. */
  trackerId?: string;
  observation2d?: WorldObservation2D;
  attributes?: Record<string, string | number | boolean>;
}

export interface WorldEntity {
  id: string;
  type: string;
  visibility: EntityVisibility;
  firstSeen: number | null;
  lastSeen: number | null;
  lastObservedAt: number;
  lastUpdatedAt: number;
  expiresAt: number | null;
  confidence: number;
  trackerId: string | null;
  observation2d: Readonly<WorldEntityObservation2D> | null;
  attributes: Readonly<Record<string, string | number | boolean>>;
  provenance: readonly WorldProvenance[];
  observationCursor: Readonly<ObservationCursor>;
  revision: number;
}

export type WorldObservationResult =
  | { applied: true; entity: WorldEntity }
  | { applied: false; reason: 'duplicate' | 'stale' | 'invalid' };

export interface WorldModelOptions {
  capacity?: number;
  eventCapacity?: number;
  maxFutureSkewMs?: number;
  maxObservationAgeMs?: number;
}

function immutableEntity(entity: WorldEntity): WorldEntity {
  return Object.freeze({
    ...entity,
    observation2d: entity.observation2d
      ? Object.freeze({ ...entity.observation2d })
      : null,
    attributes: Object.freeze({ ...entity.attributes }),
    provenance: Object.freeze(entity.provenance.map((item) => Object.freeze({ ...item }))),
    observationCursor: Object.freeze({ ...entity.observationCursor }),
  });
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function validSafeId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value);
}

function validObservation2D(value: WorldObservation2D): boolean {
  return Boolean(
    validSafeId(value.sensorId) &&
      [value.x, value.y, value.width, value.height].every(Number.isFinite) &&
      value.x >= 0 &&
      value.y >= 0 &&
      value.width > 0 &&
      value.height > 0 &&
      value.x <= 1 &&
      value.y <= 1 &&
      value.width <= 1 &&
      value.height <= 1 &&
      value.x + value.width <= 1 &&
      value.y + value.height <= 1
  );
}

function withoutEphemeralAttributes(
  attributes: Readonly<Record<string, string | number | boolean>>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(attributes).filter(([key]) => key !== 'count'));
}

/**
 * Deterministic, bounded operational model of the observed physical world.
 * LLMs may publish hypotheses elsewhere, but only validated observations enter
 * this reducer and change factual entity state.
 */
export class WorldModel {
  private readonly entities = new Map<string, WorldEntity>();
  private readonly seenEvents = new Map<string, number>();
  private readonly capacity: number;
  private readonly eventCapacity: number;
  private readonly maxFutureSkewMs: number;
  private readonly maxObservationAgeMs: number;
  private revision = 0;

  constructor(options: WorldModelOptions = {}) {
    this.capacity = Math.max(1, Math.floor(options.capacity ?? 128));
    this.eventCapacity = Math.max(1, Math.floor(options.eventCapacity ?? 2048));
    this.maxFutureSkewMs = Math.max(0, Math.floor(options.maxFutureSkewMs ?? 30_000));
    this.maxObservationAgeMs = Math.max(1, Math.floor(options.maxObservationAgeMs ?? 86_400_000));
  }

  observe(observation: WorldObservation): WorldObservationResult {
    if (!this.validObservation(observation)) return { applied: false, reason: 'invalid' };
    if (this.seenEvents.has(observation.eventId)) return { applied: false, reason: 'duplicate' };

    const previous = this.entities.get(observation.entityId);
    if (previous && (
      previous.type !== observation.entityType ||
      previous.trackerId !== (observation.trackerId ?? null)
    )) {
      return { applied: false, reason: 'invalid' };
    }
    this.rememberEvent(observation.eventId, observation.receivedAt);
    const cursor: ObservationCursor = {
      observedAt: observation.observedAt,
      transitionRank: observation.visibility === 'absent'
        ? 3
        : observation.visibility === 'unknown'
          ? 2
          : 1,
      eventId: observation.eventId,
    };
    if (previous && this.compareCursor(cursor, previous.observationCursor) <= 0) {
      // A delayed visible sample can widen historical firstSeen without
      // changing the newer current belief. Delayed absence never does.
      if (
        observation.visibility === 'visible' &&
        (previous.firstSeen === null || observation.observedAt < previous.firstSeen)
      ) {
        const widened = immutableEntity({
          ...previous,
          firstSeen: observation.observedAt,
          provenance: [
            ...previous.provenance.slice(-7),
            {
              source: observation.source,
              kind: observation.kind,
              eventId: observation.eventId,
              observedAt: observation.observedAt,
              receivedAt: observation.receivedAt,
            },
          ],
          revision: ++this.revision,
        });
        this.entities.set(widened.id, widened);
        return { applied: true, entity: widened };
      }
      return { applied: false, reason: 'stale' };
    }

    if (!previous && this.entities.size >= this.capacity) this.evictOne();
    const provenance: WorldProvenance = {
      source: observation.source,
      kind: observation.kind,
      eventId: observation.eventId,
      observedAt: observation.observedAt,
      receivedAt: observation.receivedAt,
    };
    const entity = immutableEntity({
      id: observation.entityId,
      type: observation.entityType,
      visibility: observation.visibility,
      firstSeen: observation.visibility === 'visible'
        ? Math.min(previous?.firstSeen ?? observation.observedAt, observation.observedAt)
        : previous?.firstSeen ?? null,
      lastSeen: observation.visibility === 'visible'
        ? Math.max(previous?.lastSeen ?? observation.observedAt, observation.observedAt)
        : previous?.lastSeen ?? null,
      lastObservedAt: observation.observedAt,
      lastUpdatedAt: observation.receivedAt,
      expiresAt: observation.visibility === 'unknown'
        ? null
        : observation.receivedAt + observation.ttlMs,
      confidence: observation.visibility === 'unknown' ? 0 : clamp01(observation.confidence),
      trackerId: observation.trackerId ?? previous?.trackerId ?? null,
      observation2d: observation.visibility === 'visible'
        ? observation.observation2d
          ? {
              space: 'image-normalized-v1',
              sensorId: observation.observation2d.sensorId,
              x: observation.observation2d.x,
              y: observation.observation2d.y,
              width: observation.observation2d.width,
              height: observation.observation2d.height,
              ...(safeSpatialEstimate(observation.observation2d.spatial)
                ? { spatial: safeSpatialEstimate(observation.observation2d.spatial) }
                : {}),
              observedAt: observation.observedAt,
            }
          : null
        : null,
      attributes: observation.visibility === 'unknown'
        ? withoutEphemeralAttributes(previous?.attributes ?? {})
        : {
            ...(previous?.attributes ?? {}),
            ...(observation.attributes ?? {}),
          },
      provenance: [...(previous?.provenance ?? []).slice(-7), provenance],
      observationCursor: cursor,
      revision: ++this.revision,
    });
    this.entities.set(entity.id, entity);
    return { applied: true, entity };
  }

  /** Expired observations become unknown; lack of observation is not proof of absence. */
  expire(now: number): WorldEntity[] {
    if (!Number.isFinite(now)) return [];
    const changed: WorldEntity[] = [];
    for (const [id, entity] of this.entities) {
      if (entity.visibility === 'unknown' || entity.expiresAt === null || entity.expiresAt > now) {
        continue;
      }
      const unknown = immutableEntity({
        ...entity,
        visibility: 'unknown',
        lastUpdatedAt: now,
        expiresAt: null,
        confidence: 0,
        observation2d: null,
        attributes: withoutEphemeralAttributes(entity.attributes),
        revision: ++this.revision,
      });
      this.entities.set(id, unknown);
      changed.push(unknown);
    }
    return changed;
  }

  get(entityId: string, now?: number): WorldEntity | undefined {
    if (now !== undefined) this.expire(now);
    const entity = this.entities.get(entityId);
    return entity ? immutableEntity(entity) : undefined;
  }

  snapshot(now?: number): readonly WorldEntity[] {
    if (now !== undefined) this.expire(now);
    return [...this.entities.values()]
      .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
      .map(immutableEntity);
  }

  private validObservation(observation: WorldObservation): boolean {
    return Boolean(
      observation.eventId &&
        observation.entityId &&
        observation.entityType &&
        observation.source &&
        observation.kind &&
        Number.isFinite(observation.observedAt) &&
        Number.isFinite(observation.receivedAt) &&
        Number.isFinite(observation.confidence) &&
        Number.isFinite(observation.ttlMs) &&
        observation.ttlMs > 0 &&
        observation.observedAt >= 0 &&
        observation.receivedAt >= 0 &&
        observation.observedAt <= observation.receivedAt + this.maxFutureSkewMs &&
        observation.observedAt >= observation.receivedAt - this.maxObservationAgeMs &&
        (!observation.trackerId || validSafeId(observation.trackerId)) &&
        (!observation.observation2d || validObservation2D(observation.observation2d))
    );
  }

  private compareCursor(a: ObservationCursor, b: ObservationCursor): number {
    if (a.observedAt !== b.observedAt) return a.observedAt - b.observedAt;
    if (a.transitionRank !== b.transitionRank) return a.transitionRank - b.transitionRank;
    return a.eventId.localeCompare(b.eventId);
  }

  private rememberEvent(eventId: string, receivedAt: number): void {
    this.seenEvents.set(eventId, receivedAt);
    if (this.seenEvents.size <= this.eventCapacity) return;
    const oldest = this.seenEvents.keys().next().value as string | undefined;
    if (oldest) this.seenEvents.delete(oldest);
  }

  private evictOne(): void {
    const victim = [...this.entities.values()].sort(
      (a, b) =>
        (a.visibility === 'unknown' ? 0 : 1) - (b.visibility === 'unknown' ? 0 : 1) ||
        a.lastUpdatedAt - b.lastUpdatedAt,
    )[0];
    if (victim) this.entities.delete(victim.id);
  }
}
