/**
 * Lightweight semantic end-of-turn guard for the local voice pipeline.
 *
 * Energy VAD should close quickly. If the resulting French/English transcript
 * clearly ends on a connector, however, the speaker probably paused inside a
 * thought. Hold that fragment briefly and join the next final instead of making
 * the assistant interrupt. This mirrors the VAD + semantic detector pattern
 * used by mature realtime voice frameworks while remaining local and free.
 */

export const DEFAULT_INCOMPLETE_TURN_HOLD_MS = 900;

export function resolveIncompleteTurnHoldMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.CODEBUDDY_VOICE_INCOMPLETE_HOLD_MS);
  if (!Number.isFinite(configured)) return DEFAULT_INCOMPLETE_TURN_HOLD_MS;
  return Math.max(0, Math.min(3_000, Math.floor(configured)));
}

export function isLikelyIncompleteVoiceTurn(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  // Explicit sentence closure is authoritative. A comma/ellipsis is not.
  if (/[.!?][)”»'’\]]*$/.test(raw) && !/\.{2,}[)”»'’\]]*$/.test(raw)) return false;
  if (/[,;:]\s*$|\.{2,}\s*$|[-–—]\s*$/.test(raw)) return true;

  const normalized = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;

  return /(?:^|\s)(?:et|mais|ou|donc|car|avec|sans|pour|par|de|du|des|a|au|aux|chez|vers|sur|sous|entre|si|quand|lorsque|parce que|afin de|alors que|pendant que|qui|que|dont|comme|puis|and|but|or|because|with|without|for|to|from|if|when|while)$/.test(
    normalized,
  );
}

export function joinVoiceTurnFragments(first: string, second: string): string {
  return `${first.trim()} ${second.trim()}`.replace(/\s+/g, ' ').trim();
}
