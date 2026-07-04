/**
 * auto-barge-in — energy-based Voice Activity Detection (VAD) for automatic
 * barge-in, the FastRTC "ReplyOnPause" analogue for Cowork's voice loop.
 *
 * While the agent's TTS is playing, we listen to the microphone and detect the
 * ONSET of the user speaking. When speech is detected we fire `onBargeIn` so the
 * caller can interrupt playback (and cancel the running agent turn) without the
 * user having to click anything.
 *
 * Design goals:
 *  - **Deterministic & testable**: the RMS math (`computeRms`) is a pure
 *    function; the detector accepts an injectable `sampleBytes` sampler so unit
 *    tests can feed scripted audio frames without any real Web Audio API.
 *  - **Echo-safe**: callers open the mic with browser AEC/NS/AGC enabled so the
 *    HP's own TTS is cancelled and the VAD does not trigger on the agent's voice.
 *  - **never-throws**: all teardown is guarded; a failing AudioContext/AnalyserNode
 *    degrades gracefully (the manual push-to-talk path stays available).
 *
 * @module renderer/utils/auto-barge-in
 */

export interface AutoBargeInConfig {
  /**
   * RMS threshold on the normalised [-1, 1] sample scale. Silence sits near 0;
   * conversational speech is ~0.05–0.3. Default 0.05.
   */
  rmsThreshold: number;
  /**
   * Number of CONSECUTIVE frames above threshold before we declare a speech
   * onset (debounce against transient clicks / a single loud sample). Default 3.
   */
  onsetFrames: number;
  /** Polling interval in ms for the analyser loop. Default 50 (≈20 fps). */
  frameMs: number;
}

export const DEFAULT_BARGE_IN_CONFIG: AutoBargeInConfig = {
  rmsThreshold: 0.05,
  onsetFrames: 3,
  frameMs: 50,
};

/**
 * Root-mean-square of a byte time-domain buffer (as produced by
 * `AnalyserNode.getByteTimeDomainData`, centred at 128). Returns a value on the
 * normalised [0, 1] scale (0 = silence). Pure — safe to unit-test directly.
 */
export function computeRms(bytes: Uint8Array): number {
  if (!bytes || bytes.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < bytes.length; i++) {
    // Byte samples are unsigned 0..255 centred on 128 → normalise to [-1, 1].
    const normalised = (bytes[i]! - 128) / 128;
    sumSquares += normalised * normalised;
  }
  return Math.sqrt(sumSquares / bytes.length);
}

/** Minimal Web Audio surface we depend on — keeps the detector mockable. */
interface AnalyserLike {
  fftSize: number;
  readonly frequencyBinCount: number;
  getByteTimeDomainData(array: Uint8Array): void;
  disconnect(): void;
}
interface AudioContextLike {
  createAnalyser(): AnalyserLike;
  createMediaStreamSource(stream: MediaStream): { connect(node: AnalyserLike): void; disconnect(): void };
  close(): Promise<void>;
  readonly state: string;
}

export interface AutoBargeInOptions {
  /** An already-constructed AudioContext (the hook owns its lifecycle). */
  audioContext: AudioContextLike;
  /** The live microphone stream (opened with echoCancellation for echo safety). */
  mediaStream: MediaStream;
  /**
   * Gate: only fire a barge-in while this returns true (i.e. the assistant is
   * actually speaking). Prevents cancelling a turn when nobody is talking over it.
   */
  isSpeaking: () => boolean;
  /** Fired ONCE per speech episode when an onset is detected during playback. */
  onBargeIn: () => void;
  config?: Partial<AutoBargeInConfig>;
  /**
   * Test seam: override how a frame of time-domain bytes is sampled. Defaults to
   * reading the AnalyserNode. Injecting this lets tests script the audio energy.
   */
  sampleBytes?: () => Uint8Array;
}

/**
 * Energy-VAD detector. Poll `tick()` (via `start()`'s interval, or manually in
 * tests); it computes the frame RMS, debounces onsets, and fires `onBargeIn`
 * once per speech episode while `isSpeaking()` holds.
 */
export class AutoBargeInDetector {
  private readonly audioContext: AudioContextLike;
  private readonly analyser: AnalyserLike | null;
  private readonly source: { connect(node: AnalyserLike): void; disconnect(): void } | null;
  private readonly buffer: Uint8Array;
  private readonly isSpeaking: () => boolean;
  private readonly onBargeIn: () => void;
  private readonly sampleBytes: () => Uint8Array;
  private readonly cfg: AutoBargeInConfig;

  private timer: ReturnType<typeof setInterval> | null = null;
  private consecutive = 0;
  /** Refractory latch: don't re-fire until the mic goes quiet again. */
  private fired = false;
  private disposed = false;

  constructor(opts: AutoBargeInOptions) {
    this.audioContext = opts.audioContext;
    this.isSpeaking = opts.isSpeaking;
    this.onBargeIn = opts.onBargeIn;
    this.cfg = { ...DEFAULT_BARGE_IN_CONFIG, ...(opts.config ?? {}) };

    let analyser: AnalyserLike | null = null;
    let source: { connect(node: AnalyserLike): void; disconnect(): void } | null = null;
    try {
      analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source = this.audioContext.createMediaStreamSource(opts.mediaStream);
      source.connect(analyser);
    } catch {
      // Degrade: without an analyser we simply never fire (manual PTT still works).
      analyser = null;
      source = null;
    }
    this.analyser = analyser;
    this.source = source;
    this.buffer = new Uint8Array(analyser ? analyser.frequencyBinCount : 0);

    this.sampleBytes =
      opts.sampleBytes ??
      (() => {
        if (!this.analyser) return new Uint8Array(0);
        this.analyser.getByteTimeDomainData(this.buffer);
        return this.buffer;
      });
  }

  /** Begin the polling loop. Idempotent; never-throws. */
  start(): void {
    if (this.disposed || this.timer) return;
    try {
      this.timer = setInterval(() => this.tick(), this.cfg.frameMs);
    } catch {
      /* ignore — degrade to no-op */
    }
  }

  /**
   * Sample one frame and update the onset state machine. Public so tests can
   * pump frames deterministically without timers.
   */
  tick(): void {
    if (this.disposed) return;
    let rms = 0;
    try {
      rms = computeRms(this.sampleBytes());
    } catch {
      return;
    }
    if (rms >= this.cfg.rmsThreshold) {
      this.consecutive++;
      if (this.consecutive >= this.cfg.onsetFrames && !this.fired) {
        // Only barge in while the assistant is actually speaking.
        if (this.isSpeaking()) {
          this.fired = true;
          try {
            this.onBargeIn();
          } catch {
            /* never-throws — a bad callback must not kill the loop */
          }
        }
      }
    } else {
      // Silence resets the debounce AND clears the refractory latch so the next
      // utterance can barge in again within the same playback.
      this.consecutive = 0;
      this.fired = false;
    }
  }

  /** Stop the loop and release the audio graph. Idempotent; never-throws. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) {
      try {
        clearInterval(this.timer);
      } catch {
        /* ignore */
      }
      this.timer = null;
    }
    try {
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.analyser?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      // AudioContext.close() returns a promise; swallow rejection.
      void Promise.resolve(this.audioContext.close()).catch(() => undefined);
    } catch {
      /* ignore */
    }
  }
}
