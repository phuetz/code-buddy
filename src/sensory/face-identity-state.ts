/**
 * Face identity state — in-memory, non-persisted state for facial recognition.
 * Tracks whether the configured owner's face is currently recognized by the
 * semantic vision system.
 *
 * This state is used to track owner presence for potential future integration
 * with identity resolution, but does NOT grant any additional rights in the
 * current implementation (mission L1 constraint: no role elevation via face).
 *
 * @module sensory/face-identity-state
 */

/**
 * State holder for face identity recognition.
 * Injectables via constructor for testability.
 */
export class FaceIdentityState {
  private recognizedOwnerPresent: boolean = false;
  private lastRecognitionTime: number | null = null;
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Set the recognized owner presence state.
   * Called by semantic-vision-reaction's onIdentityChange callback.
   */
  setRecognized(present: boolean): void {
    this.recognizedOwnerPresent = present;
    this.lastRecognitionTime = present ? this.now() : null;
  }

  /**
   * Get whether the configured owner's face is currently recognized.
   */
  getRecognized(): boolean {
    return this.recognizedOwnerPresent;
  }

  /**
   * Get the timestamp of the last recognition event (null if never recognized or lost).
   */
  getLastRecognitionTime(): number | null {
    return this.lastRecognitionTime;
  }

  /**
   * Get milliseconds since the last recognition (or null if never recognized).
   */
  getTimeSinceRecognition(): number | null {
    if (this.lastRecognitionTime === null) {
      return null;
    }
    return this.now() - this.lastRecognitionTime;
  }

  /**
   * Reset the state (useful for tests).
   */
  reset(): void {
    this.recognizedOwnerPresent = false;
    this.lastRecognitionTime = null;
  }

  /**
   * Get a snapshot of the current state for debugging/logging.
   */
  snapshot() {
    return {
      recognizedOwnerPresent: this.recognizedOwnerPresent,
      lastRecognitionTime: this.lastRecognitionTime,
      timeSinceRecognition: this.getTimeSinceRecognition(),
    };
  }
}

/**
 * Shared default instance for convenience.
 * Can be overridden via setFaceIdentityState for tests or custom wiring.
 */
let sharedFaceIdentityState: FaceIdentityState | undefined;

/**
 * Get the shared face identity state instance.
 */
export function getFaceIdentityState(): FaceIdentityState {
  if (!sharedFaceIdentityState) {
    sharedFaceIdentityState = new FaceIdentityState();
  }
  return sharedFaceIdentityState;
}

/**
 * Set the shared face identity state instance (for tests or injection).
 */
export function setFaceIdentityState(state: FaceIdentityState | undefined): void {
  sharedFaceIdentityState = state;
}

/**
 * Create a new face identity state instance.
 * Useful for isolated tests or per-session state.
 */
export function createFaceIdentityState(options: { now?: () => number } = {}): FaceIdentityState {
  return new FaceIdentityState(options);
}
