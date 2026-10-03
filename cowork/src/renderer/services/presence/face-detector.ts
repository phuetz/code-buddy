/**
 * Face Detector — MediaPipe BlazeFace.
 *
 * **Renderer-side only.** MediaPipe Tasks Vision relies on
 * `HTMLVideoElement` / WebGL / `tasks-vision-wasm` which only exist in
 * the Chromium renderer process, not in the Node main process. The
 * recognition step (encoding the cropped face into an embedding) lives
 * in the main process via `face-recognizer.ts` and `onnxruntime-node`.
 *
 * Adapted from Lisa `packages/vision-engine/src/FaceDetector.ts` (MIT,
 * original implementation). Adaptations vs Lisa version:
 * - Lazy-loads `@mediapipe/tasks-vision` so the bundle stays light when
 *   presence detection isn't enabled.
 * - Allows passing a local WASM path (Cowork ships offline; defaulting to
 *   the CDN works for dev but isn't acceptable for a packaged Electron app).
 * - Allows passing a local model path (same reason).
 * - Returns the shared `FaceDetection` type from `cowork/shared/presence/types`.
 *
 * @module cowork/renderer/services/presence/face-detector
 */

import type { FaceDetection } from '../../../shared/presence/types';

/**
 * Default MediaPipe assets URLs. Acceptable for `npm run dev` but at
 * package time we should mirror these locally and override via config.
 *
 * Tracked separately because they're network-dependent and a packaged
 * Cowork must not fail offline.
 */
const DEFAULT_WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const DEFAULT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

export interface FaceDetectorOptions {
  /** Min confidence to keep a detection. Default 0.5 (BlazeFace recommends ≥0.5). */
  minConfidence?: number;
  /** Max number of faces to return per frame. Default 5. */
  maxResults?: number;
  /** 'IMAGE' | 'VIDEO' — VIDEO uses tracking which is what we want for streams. */
  runningMode?: 'IMAGE' | 'VIDEO';
  /** GPU is dramatically faster but falls back gracefully on unsupported HW. */
  delegate?: 'CPU' | 'GPU';
  /** Override WASM base URL — for offline builds. */
  wasmBaseUrl?: string;
  /** Override model URL — for offline builds. */
  modelUrl?: string;
}

const DEFAULT_OPTIONS: Required<Omit<FaceDetectorOptions, 'wasmBaseUrl' | 'modelUrl'>> = {
  minConfidence: 0.5,
  maxResults: 5,
  runningMode: 'VIDEO',
  delegate: 'GPU',
};

interface MPFaceDetectorInstance {
  detect: (
    img: unknown,
    timestampMs?: number,
  ) => {
    detections: Array<{
      boundingBox: { originX: number; originY: number; width: number; height: number };
      keypoints: Array<{ x: number; y: number }>;
      categories: Array<{ score: number }>;
    }>;
  };
  close: () => void;
}

export class FaceDetector {
  private detector: MPFaceDetectorInstance | null = null;
  private readonly options: FaceDetectorOptions & typeof DEFAULT_OPTIONS;

  constructor(options: FaceDetectorOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Loads the MediaPipe runtime + the BlazeFace model. Idempotent — calling
   * twice is a no-op. Throws if the runtime can't be loaded (network error
   * + no local override).
   */
  async initialize(): Promise<void> {
    if (this.detector !== null) return;

    // Dynamic import keeps the renderer cold-start fast when presence is off.
    const mp = await import('@mediapipe/tasks-vision');
    const wasmBase = this.options.wasmBaseUrl ?? DEFAULT_WASM_BASE;
    const modelUrl = this.options.modelUrl ?? DEFAULT_MODEL_URL;

    const vision = await mp.FilesetResolver.forVisionTasks(wasmBase);

    this.detector = (await mp.FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: modelUrl,
        delegate: this.options.delegate,
      },
      runningMode: this.options.runningMode,
      minDetectionConfidence: this.options.minConfidence,
    })) as unknown as MPFaceDetectorInstance;
  }

  /**
   * Detect faces in one frame. The frame can be a `<video>`, `<image>`, or
   * `<canvas>` element — anything MediaPipe accepts. Returns at most
   * `options.maxResults` detections, all above `options.minConfidence`.
   */
  async detect(
    frame: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  ): Promise<FaceDetection[]> {
    if (this.detector === null) {
      throw new Error('FaceDetector not initialized. Call initialize() first.');
    }

    const result = this.detector.detect(frame, performance.now());

    return result.detections
      .slice(0, this.options.maxResults)
      .map((d) => ({
        boundingBox: {
          x: d.boundingBox.originX,
          y: d.boundingBox.originY,
          width: d.boundingBox.width,
          height: d.boundingBox.height,
        },
        keypoints: d.keypoints.map((kp) => ({ x: kp.x, y: kp.y })),
        confidence: d.categories[0]?.score ?? 0,
      }));
  }

  /** Free the GPU/CPU resources. Call this when presence detection is disabled. */
  close(): void {
    if (this.detector !== null) {
      this.detector.close();
      this.detector = null;
    }
  }
}

export function createFaceDetector(options?: FaceDetectorOptions): FaceDetector {
  return new FaceDetector(options);
}
