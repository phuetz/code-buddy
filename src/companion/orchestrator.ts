/**
 * Companion conductor — the single arbiter of who gets to speak.
 *
 * The companion has several surfaces that each decide, independently, to speak: the camera arrival
 * greeting, the presence-loop "moments", and the proactive ritual engine. Each has its own cooldown,
 * but nothing coordinated ACROSS them — so a greeting, a presence moment and a proactive line could
 * all land within the same minute (the mouth serializes the audio, but three back-to-back utterances
 * still feel like a chatterbox). This is the conductor: at most ONE companion-initiated utterance per
 * global gap, so the surfaces take turns. Reminders are safety-critical — they always speak and reset
 * the floor so a chatty moment doesn't immediately follow a dose reminder.
 *
 * Pure + deterministic (injectable clock) so it's unit-tested with no timers. Best-effort by nature:
 * a surface that is denied simply stays silent this round and retries next tick.
 *
 * @module companion/orchestrator
 */

export type CompanionSurface =
  | 'arrival'
  | 'presence'
  | 'proactive'
  | 'reminder'
  | 'error-watch';

export interface Conductor {
  /** May `surface` speak now? Records the grant (so the next claimant waits out the gap). */
  claim(surface: CompanionSurface): boolean;
}

export class CompanionConductor implements Conductor {
  private lastSpokeAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly gapMs: number = Number(process.env.CODEBUDDY_COMPANION_MIN_GAP_MS) || 45_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  claim(surface: CompanionSurface): boolean {
    const t = this.now();
    // Reminders (health safety) always speak, and reset the floor.
    if (surface === 'reminder') {
      this.lastSpokeAt = t;
      return true;
    }
    if (t - this.lastSpokeAt < this.gapMs) return false; // another surface has the floor
    this.lastSpokeAt = t;
    return true;
  }
}

let singleton: CompanionConductor | undefined;

/** The shared conductor every companion surface consults before speaking. */
export function getCompanionConductor(): CompanionConductor {
  if (!singleton) singleton = new CompanionConductor();
  return singleton;
}

/** Test seam. */
export function _resetConductorForTests(): void {
  singleton = undefined;
}
