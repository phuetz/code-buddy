/**
 * Ephemeral two-turn consent for one-shot camera grounding.
 *
 * The pending request exists only in memory, for one immediate reply and a
 * short bounded interval. This lets a person answer a natural confirmation
 * question with “oui, vas-y” while preserving the concrete object mentioned
 * in the preceding turn. It never opens the camera on an unrelated later
 * “oui”.
 */

export const DEFAULT_VISUAL_CONSENT_TTL_MS = 45_000;
const MAX_PENDING_VISUAL_UTTERANCE_CHARS = 600;

export type VisualConsentResolution =
  | { decision: 'none' }
  | { decision: 'confirmed'; utterance: string }
  | { decision: 'declined' }
  | { decision: 'expired' }
  | { decision: 'unrelated' };

interface PendingVisualConsent {
  id: number;
  utterance: string;
  expiresAt: number;
}

function normalizeReply(value: string): string {
  return value
    .toLocaleLowerCase('fr')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[’']/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DECLINE =
  /^(?:non|nan|nope)\b|\b(?:n ouvre pas|ne l ouvre pas|laisse tomber|annule|pas maintenant|finalement non)\b/u;
const CONFIRM =
  /^(?:oui|ouais|yes|d accord|bien sur|vas y|tu peux|fais le|ouvre la|ouvre le|prends la photo|regarde)(?:\b|$)/u;

export function isVisualConsentConfirmation(value: string): boolean {
  const normalized = normalizeReply(value);
  return Boolean(normalized && !DECLINE.test(normalized) && CONFIRM.test(normalized));
}

export function isVisualConsentDecline(value: string): boolean {
  const normalized = normalizeReply(value);
  return Boolean(normalized && DECLINE.test(normalized));
}

export class VisualConsentGate {
  private pending: PendingVisualConsent | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 0;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs: number = DEFAULT_VISUAL_CONSENT_TTL_MS,
  ) {}

  request(utterance: string): number | undefined {
    const bounded = utterance.trim().slice(0, MAX_PENDING_VISUAL_UTTERANCE_CHARS);
    if (!bounded) {
      this.cancel();
      return undefined;
    }
    const ttl = Number.isFinite(this.ttlMs)
      ? Math.max(1_000, Math.min(120_000, Math.floor(this.ttlMs)))
      : DEFAULT_VISUAL_CONSENT_TTL_MS;
    this.cancel();
    const pending = {
      id: ++this.nextId,
      utterance: bounded,
      expiresAt: this.now() + ttl,
    };
    this.pending = pending;
    this.expiryTimer = setTimeout(() => {
      if (this.pending === pending) {
        this.pending = null;
        this.expiryTimer = null;
      }
    }, ttl);
    this.expiryTimer.unref?.();
    return pending.id;
  }

  cancel(requestId?: number): void {
    if (requestId !== undefined && this.pending?.id !== requestId) return;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.pending = null;
  }

  /**
   * Consume at most the immediately following turn. An unrelated reply clears
   * the pending request so a later affirmative cannot unexpectedly open the
   * camera.
   */
  consume(reply: string): VisualConsentResolution {
    const pending = this.pending;
    if (!pending) return { decision: 'none' };
    this.cancel(pending.id);

    if (this.now() >= pending.expiresAt) {
      return isVisualConsentConfirmation(reply)
        ? { decision: 'expired' }
        : { decision: 'none' };
    }
    if (isVisualConsentDecline(reply)) return { decision: 'declined' };
    if (isVisualConsentConfirmation(reply)) {
      return { decision: 'confirmed', utterance: pending.utterance };
    }
    return { decision: 'unrelated' };
  }
}
