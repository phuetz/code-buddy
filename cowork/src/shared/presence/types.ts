/**
 * Presence types — face memory + future voice memory.
 *
 * "Presence" = who is physically in front of the camera/microphone right
 * now. Distinct from `cowork/src/main/identity/` which holds the *Claude*
 * persona (SOUL.md, USER.md, AGENTS.md, persona/*.md). Identity = the AI.
 * Presence = the human.
 *
 * Adapted from Lisa `packages/vision-engine` (MediaPipe BlazeFace) for the
 * detection layer; recognition layer (FaceRecognizer + PresenceStore) is
 * net-new for Code Buddy V0.
 *
 * @module cowork/main/presence/types
 */

// ─── Detection (what MediaPipe BlazeFace gives us) ──────────────────

/** A face's bounding box in image-pixel coordinates. */
export interface FaceBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One detected face in a frame. BlazeFace returns 6 keypoints (eyes, nose,
 * mouth, ears) — we keep them in case the recognizer wants to use them for
 * alignment (improves embedding quality).
 */
export interface FaceDetection {
  boundingBox: FaceBoundingBox;
  keypoints: Array<{ x: number; y: number }>;
  /** Detection confidence, 0..1. */
  confidence: number;
}

// ─── Recognition (who is it?) ───────────────────────────────────────

/**
 * A face encoded as a fixed-length vector. Buffalo_S (ArcFace) produces
 * 512-dim L2-normalised embeddings. FaceNet would be 128-dim — same shape,
 * different length.
 */
export type FaceEmbedding = Float32Array;

/**
 * One sample taken during enrollment or runtime confirmation. Multiple
 * samples per person are averaged into `PersonIdentity.faceEmbeddingAvg` to
 * smooth out lighting/angle variance.
 */
export interface FaceSample {
  embedding: FaceEmbedding;
  /** Optional snapshot path for later visual review. */
  snapshotPath?: string;
  capturedAt: number;
}

/**
 * Persistent identity record — what we know about one human. The store
 * holds many of these. Aliases let the LLM pick the right register
 * (a name vs "mon chéri") based on context.
 */
export interface PersonIdentity {
  /** Stable id (uuid). */
  id: string;
  /** Canonical display name (configured name). */
  name: string;
  /**
   * Affectionate / contextual aliases the LLM can use as alternative
   * greetings ("mon chéri", "patron", "boss"). The agent loop chooses
   * which register to use based on conversation history; this list is
   * just the menu.
   */
  aliases: string[];
  /** Mean of all face samples (kept up-to-date as samples accumulate). */
  faceEmbeddingAvg: FaceEmbedding;
  /** Number of samples folded into the average — used for incremental update. */
  faceSampleCount: number;
  /** Optional voice embedding for V1 speaker verification. */
  voiceEmbeddingAvg?: Float32Array;
  voiceSampleCount?: number;
  /** Snapshots kept for audit / re-training (paths). */
  snapshotPaths: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Result of matching a live face embedding against the store.
 * `confidence` here is cosine similarity in [-1, 1]; values > 0.5 are a
 * decent match for ArcFace, > 0.7 is high confidence.
 */
export interface PresenceMatch {
  personId: string;
  name: string;
  aliases: string[];
  confidence: number;
  matchedAt: number;
}

// ─── Events emitted to the renderer + Code Buddy core ───────────────

export type PresenceEventType =
  | 'detected'      // a known person is in front of the camera
  | 'unknown'       // a face is detected but doesn't match any identity
  | 'left'          // the previously detected person is no longer visible
  | 'enrolled';     // a new identity was added to the store

export interface PresenceEvent {
  type: PresenceEventType;
  match?: PresenceMatch;
  /** Raw detection, useful for the renderer to draw an overlay. */
  detection?: FaceDetection;
  timestamp: number;
}

// ─── Configuration ──────────────────────────────────────────────────

export interface PresenceConfig {
  /**
   * Cosine similarity threshold below which a face is considered "unknown"
   * even if it has a closest match in the store. ArcFace default: 0.5.
   */
  matchThreshold: number;
  /**
   * Minimum detection confidence to bother running the recognizer. Saves
   * inference cost on low-quality detections.
   */
  detectionConfidenceFloor: number;
  /**
   * Frames per second for the presence detection loop. 1-2 fps is plenty
   * for greeting purposes; higher rates burn CPU for no UX gain.
   */
  fps: number;
  /** Number of samples to take during enrollment. */
  enrollmentSampleCount: number;
}

export const DEFAULT_PRESENCE_CONFIG: PresenceConfig = {
  matchThreshold: 0.5,
  detectionConfidenceFloor: 0.5,
  fps: 1,
  enrollmentSampleCount: 5,
};
